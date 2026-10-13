#!/usr/bin/env python3
"""
打包 MD Writer.app 的「组装」部分：
建目录、拷 Info.plist / 图标 / 前端资源、ad-hoc 签名。
（编译二进制由调用方用 swiftc 单独完成，因为沙箱会拦 mkdir。）
"""
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "native" / "MDWriter.app"
CONTENTS = APP / "Contents"
MACOS = CONTENTS / "MacOS"
RES = CONTENTS / "Resources"


def run(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


def has_developer_id():
    """钥匙串里已有 Developer ID 证书时，不要先用 ad-hoc 签一遍。
    正式签名在 build/notarize.py 里做，这里跳过可避免重复签名。"""
    r = run("security find-identity -v -p codesigning")
    if r.returncode != 0:
        return False
    return "Developer ID Application:" in r.stdout


def main():
    for d in (MACOS, RES, RES / "web"):
        d.mkdir(parents=True, exist_ok=True)

    # Info.plist
    src_plist = ROOT / "native" / "Info.plist"
    if src_plist.exists():
        shutil.copy2(src_plist, CONTENTS / "Info.plist")

    # 注入版本号：CI 通过 MDWRITER_VERSION 环境变量传入（值形如 "v1.1.1"，
    # 兼容地剥掉前导 v），本地回退读 build/VERSION。
    # 单一真源，避免 Info.plist 写死导致 App 报告版本和 cask 不一致
    version = os.environ.get("MDWRITER_VERSION", "").strip()
    if version.startswith("v"):
        version = version[1:]
    if not version:
        version_file = ROOT / "build" / "VERSION"
        if version_file.exists():
            version = version_file.read_text().strip()
    if version:
        r = run(f'plutil -replace CFBundleShortVersionString '
                f'-string "{version}" "{CONTENTS}/Info.plist"')
        if r.returncode == 0:
            print(f"[pack] 版本号已注入: {version}")
        else:
            print(f"[pack] ⚠️  版本号注入失败: {(r.stderr or '').strip()[:120]}")

    # 图标
    icon = ROOT / "native" / "AppIcon.icns"
    if icon.exists():
        shutil.copy2(icon, RES / "AppIcon.icns")

    # 前端资源
    web_src = ROOT / "native" / "MDWriter.app" / "Contents" / "Resources" / "web"
    if web_src.exists() and web_src.resolve() != (RES / "web").resolve():
        shutil.copytree(web_src, RES / "web", dirs_exist_ok=True)

    # 二进制
    binary = MACOS / "MDWriter"
    if not binary.exists():
        alt = ROOT / "build" / "MDWriter"
        if alt.exists():
            shutil.copy2(alt, binary)
        else:
            print("❌ 未找到已编译的二进制，请先运行 swiftc")
            return 1
    os.chmod(binary, 0o755)

    # 签名
    if has_developer_id():
        print("[pack] 检测到 Developer ID 证书，跳过 ad-hoc")
        print("[pack]    正式签名请运行：make sign（或 make notarize）")
    else:
        r = run(f'codesign --force --deep --sign - "{APP}"')
        if r.returncode == 0:
            print("[pack] ✅ ad-hoc 签名完成（仅本地可用）")
        else:
            print("[pack] ⚠️  签名跳过（不影响本地运行）:",
                  (r.stderr or "").strip()[:120])

    # 校验
    total = sum(f.stat().st_size for f in APP.rglob("*") if f.is_file())
    print(f"[pack] ✅ {APP}")
    print(f"[pack]    大小 {total/1024/1024:.1f} MB")

    v = run(f'plutil -lint "{CONTENTS / "Info.plist"}"')
    print("[pack]    Info.plist:", "OK" if v.returncode == 0 else "异常")
    return 0


if __name__ == "__main__":
    sys.exit(main())