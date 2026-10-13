#!/usr/bin/env python3
"""
MD Writer 签名 + 公证（Notarization）流水线。

设计原则：**永远能跑通**。
    有 Developer ID 证书  → Hardened Runtime 签名
    有公证凭据            → notarytool 提交 + stapler 钉票
    都没有（当前状态）     → 降级 ad-hoc 签名，正常产出 dmg / pkg，退出码 0

用法
    python3 build/notarize.py                 # 自动探测，按环境能走多远走多远
    python3 build/notarize.py --dmg           # 额外产出并公证 dmg
    python3 build/notarize.py --pkg           # 额外产出并公证 pkg
    python3 build/notarize.py --dmg --pkg     # 两者都要（发布时推荐）
    python3 build/notarize.py --check         # 只体检，不修改任何东西

准备工作（只有真要对外签名公证时才需要）

    1) 加入 Apple Developer Program（$99/年）
    2) Xcode → Settings → Accounts → 下载两张证书：
         - Developer ID Application   （签 .app / .dmg）
         - Developer ID Installer     （签 .pkg）
    3) 二选一配置公证凭据：

       a) keychain profile（本地最简单）
          xcrun notarytool store-credentials "MDWriter" \
            --apple-id you@example.com --team-id TEAMID \
            --password xxxx-xxxx-xxxx-xxxx
          export NOTARY_PROFILE=MDWriter

       b) App Store Connect API Key（CI 友好，不受双因素认证影响）
          export NOTARY_KEY_ID=XXXXXXXXXX
          export NOTARY_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
          export NOTARY_KEY_PATH=~/AuthKey_XXXXXXXXXX.p8

可选环境变量
    SIGN_IDENTITY      覆盖自动探测到的 Developer ID Application 证书
    NOTARY_TEAM_ID     团队 ID（多团队账号时需要）
    NOTARY_PROFILE     keychain profile 名称
"""
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "native" / "MDWriter.app"
BUILD = ROOT / "build"
DIST = ROOT / "dist"
ENTITLEMENTS = BUILD / "entitlements.plist"
BUNDLE_ID = "com.mdwriter.app"


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------

def run(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


# 全部 flush=True：本脚本会用 subprocess 调起 make-dmg.py / make-pkg.py，
# 若不实时 flush，父进程的缓冲输出会晚于子进程，终端上顺序就乱了。
def ok(msg):   print(f"  ✅ {msg}", flush=True)
def warn(msg): print(f"  ⚠️  {msg}", flush=True)
def bad(msg):  print(f"  ❌ {msg}", flush=True)
def step(msg): print(f"\n▶ {msg}", flush=True)


def version():
    r = run(f'/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" '
            f'"{APP}/Contents/Info.plist"')
    v = r.stdout.strip()
    return v if v else "1.0.0"


def latest(suffix):
    """返回 dist/ 下最新的指定后缀产物。"""
    if not DIST.exists():
        return None
    cands = sorted(DIST.glob(f"*{suffix}"), key=lambda p: p.stat().st_mtime, reverse=True)
    return cands[0] if cands else None


# --------------------------------------------------------------------------
# 环境探测
# --------------------------------------------------------------------------

def find_identity(kind):
    """在钥匙串里找指定类型的 Developer ID 证书。
    kind: "Developer ID Application" 或 "Developer ID Installer"
    """
    if kind.endswith("Application"):
        override = os.environ.get("SIGN_IDENTITY")
        if override:
            return override

    r = run("security find-identity -v -p codesigning")
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        m = re.search(rf'"({kind}:[^"]+)"', line)
        if not m:
            continue
        if "valid identities found" in line:
            continue
        # 跳过已过期 / 被吊销的
        if "expired" in line.lower() or "revoked" in line.lower():
            continue
        if "CSSMERR" in line:
            continue
        return m.group(1)
    return None


def notary_args():
    """拼 notarytool 的认证参数；返回 None 表示没配凭据。"""
    profile = os.environ.get("NOTARY_PROFILE")
    if profile:
        return ["--keychain-profile", profile]

    key_id = os.environ.get("NOTARY_KEY_ID")
    issuer = os.environ.get("NOTARY_ISSUER")
    key_path = os.environ.get("NOTARY_KEY_PATH")
    if key_id and issuer and key_path:
        p = pathlib.Path(key_path).expanduser()
        if p.exists():
            return ["--key", str(p), "--key-id", key_id, "--issuer", issuer]
        warn(f"NOTARY_KEY_PATH 指向的文件不存在: {key_path}")
    return None


# --------------------------------------------------------------------------
# 签名
# --------------------------------------------------------------------------

def codesign_app(identity):
    """Hardened Runtime 签名 + 安全时间戳。
    --timestamp 很关键：没有它，证书过期当天所有已发出的 App 集体变「已损坏」。
    不用 --deep：Apple 官方不推荐生产环境使用，会掩盖真实的签名错误。
    """
    cmd = (f'codesign --force --options runtime --timestamp '
           f'--sign "{identity}" --identifier {BUNDLE_ID} ')
    if ENTITLEMENTS.exists():
        cmd += f'--entitlements "{ENTITLEMENTS}" '
    cmd += f'"{APP}"'

    r = run(cmd)
    if r.returncode != 0:
        bad("codesign 失败")
        print((r.stderr or "").strip()[:800])
        return False

    v = run(f'codesign --verify --strict --verbose=2 "{APP}"')
    if v.returncode != 0:
        bad("签名校验失败")
        print((v.stderr or "").strip()[:800])
        return False

    ok(f"Hardened Runtime 签名完成")
    print(f"      证书: {identity}")
    return True


def adhoc():
    """无证书时的降级签名：只保证完整性校验，不证明身份。"""
    r = run(f'codesign --force --deep --sign - "{APP}"')
    if r.returncode == 0:
        ok("ad-hoc 签名完成（仅保证完整性，无法对外分发）")
    else:
        warn("ad-hoc 签名失败，不影响本地运行")


def sign_dmg(identity, dmg):
    r = run(f'codesign --force --timestamp --sign "{identity}" "{dmg}"')
    if r.returncode != 0:
        warn(f"dmg 签名失败: {(r.stderr or '').strip()[:200]}")
        return False
    ok(f"dmg 已签名 → {pathlib.Path(str(dmg)).name}")
    return True


def sign_pkg(installer, pkg):
    """pkg 用 productsign + Developer ID Installer 证书。"""
    out = pathlib.Path(str(pkg)).with_name(pathlib.Path(str(pkg)).stem + "-signed.pkg")
    r = run(f'productsign --sign "{installer}" "{pkg}" "{out}"')
    if r.returncode != 0:
        warn("pkg 签名失败（需要 Developer ID Installer 证书，不是 Application 那张）")
        return pkg

    pathlib.Path(str(pkg)).unlink()
    out.rename(pkg)
    ok(f"pkg 已签名 → {pathlib.Path(str(pkg)).name}")
    return pkg


# --------------------------------------------------------------------------
# 产物生成
# --------------------------------------------------------------------------

def build_artifact(script):
    """调用 build/ 下的产物脚本。输出直接透传给终端，方便看到产物路径。"""
    r = subprocess.run(f'python3 "{BUILD / script}"', shell=True)
    if r.returncode != 0:
        bad(f"{script} 执行失败")
        return False
    return True


# --------------------------------------------------------------------------
# 公证
# --------------------------------------------------------------------------

def notarize(artifact, auth):
    """提交公证，--wait 阻塞到 Apple 出结果（通常 1-5 分钟）。"""
    cmd = f'xcrun notarytool submit "{artifact}" ' + " ".join(auth)
    team = os.environ.get("NOTARY_TEAM_ID")
    if team:
        cmd += f" --team-id {team}"
    cmd += " --wait"

    try:
        r = run(cmd, timeout=1800)
    except subprocess.TimeoutExpired:
        bad(f"公证超时（30 分钟）→ {pathlib.Path(str(artifact)).name}")
        return False

    out = (r.stdout or "") + (r.stderr or "")

    if r.returncode == 0 and "status: Accepted" in out:
        ok(f"公证通过 → {pathlib.Path(str(artifact)).name}")
        return True

    bad(f"公证未通过 → {pathlib.Path(str(artifact)).name}")
    print(out.strip()[:1500])

    # 尝试拉取 Apple 返回的问题清单
    m = re.search(r"id:\s*([0-9a-fA-F-]{36})", out)
    if m and auth:
        log = run(f'xcrun notarytool log {m.group(1)} ' + " ".join(auth))
        body = (log.stdout or "").strip()
        if body:
            print("\n--- Apple 返回的问题清单 ---")
            print(body[:2500])
    return False


def staple(target):
    """把票据嵌进产物：没有这一步，用户断网打开时依然会被拦。"""
    r = run(f'xcrun stapler staple "{target}"')
    if r.returncode == 0:
        ok(f"票据已钉入 → {pathlib.Path(str(target)).name}")
        return True
    warn(f"staple 失败 → {pathlib.Path(str(target)).name}"
         f"（联网可用，断网会被拦）")
    return False


# --------------------------------------------------------------------------
# 验证
# --------------------------------------------------------------------------

def verify():
    print("\n=== 分发前验证 ===")
    good = True

    r = run(f'spctl --assess --type exec --verbose=4 "{APP}"')
    if r.returncode == 0:
        ok("Gatekeeper 评估：accepted")
    else:
        msg = (r.stderr or r.stdout or "").strip()
        # ad-hoc 签名没有 TeamIdentifier，被拒是预期状态，不该误报成"被拦截"
        probe = run(f'codesign -dv --verbose=4 "{APP}" 2>&1 | grep TeamIdentifier')
        if "not set" in probe.stdout or "No usable signature" in msg:
            warn("Gatekeeper：无法评估（ad-hoc 签名，仅本地可用）")
        else:
            bad("Gatekeeper 仍会拦截")
            print(msg[:400])
            good = False

    r = run(f'xcrun stapler validate "{APP}"')
    if r.returncode == 0:
        ok("票据有效（断网也能打开）")
    else:
        warn("未检测到票据")

    r = run(f'codesign -dv --verbose=4 "{APP}" 2>&1')
    info = r.stdout + r.stderr
    if "Timestamp" in info:
        ok("含安全时间戳（证书过期后签名仍有效）")
    else:
        warn("缺少安全时间戳")

    team = re.search(r"TeamIdentifier=([A-Z0-9]{10})", info)
    if team and team.group(1) != "not set":
        ok(f"TeamIdentifier: {team.group(1)}")
    else:
        warn("无 TeamIdentifier（ad-hoc 签名，无法对外分发）")
        good = False

    return good


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def main():
    argv = sys.argv[1:]
    want_dmg = "--dmg" in argv
    want_pkg = "--pkg" in argv
    check_only = "--check" in argv

    step("环境体检")
    identity = find_identity("Developer ID Application")
    installer = find_identity("Developer ID Installer")
    auth = notary_args()

    if identity:
        ok(f"Developer ID Application: {identity}")
    else:
        warn("未找到 Developer ID Application 证书")

    if installer:
        ok(f"Developer ID Installer:   {installer}")
    else:
        warn("未找到 Developer ID Installer 证书（pkg 签名需要它）")

    if auth:
        ok("公证凭据已配置")
    else:
        warn("未配置公证凭据（NOTARY_PROFILE 或 NOTARY_KEY_ID/ISSUER/PATH）")

    if not (APP / "Contents" / "MacOS" / "MDWriter").exists():
        bad("未找到已打包的 MDWriter.app，请先运行 make app")
        return 1

    if check_only:
        good = verify()
        if not good:
            print("\n结论：当前产物**不可**对外分发（退出码 1 是预期结果）。",
                  flush=True)
            print("补齐 Developer ID 证书后重跑本命令即可，",
                  "完整步骤见 docs/NOTARIZATION.md", flush=True)
        return 0 if good else 1

    # --- 1. 签名 ---
    if identity:
        step("Hardened Runtime 签名")
        if not codesign_app(identity):
            return 1
    else:
        step("降级：ad-hoc 签名")
        adhoc()

    ver = version()

    # --- 2. 生成产物 ---
    artifacts = []
    if want_dmg:
        step("生成 dmg")
        if build_artifact("make-dmg.py"):
            dmg = latest(".dmg")
            if dmg:
                artifacts.append(("dmg", dmg))

    if want_pkg:
        step("生成 pkg")
        if build_artifact("make-pkg.py"):
            pkg = latest(".pkg")
            if pkg:
                artifacts.append(("pkg", pkg))

    # 没指定产物类型时，至少把 app 本身作为公证对象
    if not artifacts:
        artifacts.append(("app", APP))

    # --- 3. 产物签名 ---
    if identity:
        for kind, path in artifacts:
            if kind == "dmg":
                sign_dmg(identity, path)
            elif kind == "pkg" and installer:
                sign_pkg(installer, path)

    # --- 4. 公证 ---
    if not auth:
        print("\n" + "=" * 60)
        print("产物已生成，但**未公证**。对外分发时用户会被 Gatekeeper 拦下。")
        print("补上凭据后重跑本命令即可完成公证，无需改动任何代码：")
        print("")
        print("  xcrun notarytool store-credentials MDWriter \\")
        print("    --apple-id you@example.com --team-id TEAMID \\")
        print("    --password xxxx-xxxx-xxxx-xxxx")
        print("  export NOTARY_PROFILE=MDWriter")
        print(f"  python3 build/notarize.py {' '.join(argv) or '--dmg --pkg'}")
        print("=" * 60)
        return 0

    step("提交公证")
    notarized = []
    for kind, path in artifacts:
        if notarize(path, auth):
            notarized.append((kind, path))

    if not notarized:
        bad("没有任何产物通过公证")
        return 1

    # --- 5. 钉票 ---
    step("钉入票据（staple）")
    staple(APP)
    for kind, path in notarized:
        if kind != "app":
            staple(path)

    # --- 6. 最终验证 ---
    good = verify()
    print("\n" + ("✅ 可以对外分发了" if good else "❌ 见上方问题"))
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
