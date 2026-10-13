#!/usr/bin/env python3
"""
用 pkgbuild 生成 MD Writer.pkg 安装包（双击进安装器，自动装到 /Applications）。

用法
    python3 build/make-pkg.py

产物
    dist/MDWriter-<version>.pkg

为什么不带 --sign
    pkg 签名需要 "Developer ID Installer" 证书，和 App 用的
    "Developer ID Application" 不是同一张，且同样要求 Apple Developer
    Program 会员（$99/年）。无账号时产物未签名，仍可正常安装，
    分发交给 Homebrew Cask 处理（安装时自动清除 quarantine 标记）。

    有了证书之后，改跑 `python3 build/notarize.py --pkg` 会自动
    用 productsign 补签并提交公证。

说明
    pkgbuild 随 Xcode Command Line Tools 提供，完全免费。
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "native" / "MDWriter.app"
DIST = ROOT / "dist"

IDENTIFIER = "com.mdwriter.app"
INSTALL_LOCATION = "/Applications"


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def version():
    r = run(f'/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" '
            f'"{APP}/Contents/Info.plist"')
    v = r.stdout.strip()
    return v if v else "1.0.0"


def make_pkg(ver):
    """执行 pkgbuild，返回产物路径；失败返回 None。"""
    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / f"MDWriter-{ver}.pkg"
    if out.exists():
        out.unlink()

    # --component 会自动分析 bundle 结构并保留可执行文件的权限位
    cmd = (
        f"pkgbuild"
        f" --identifier {IDENTIFIER}"
        f" --version {ver}"
        f" --install-location {INSTALL_LOCATION}"
        f' --component "{APP}"'
        f' "{out}"'
    )
    r = run(cmd)
    if r.returncode != 0:
        print("[pkg] ❌ pkgbuild 失败")
        print((r.stderr or "").strip()[:800])
        return None
    return out


def main():
    if not (APP / "Contents" / "MacOS" / "MDWriter").exists():
        print("[pkg] ❌ 未找到已打包的 MDWriter.app，请先运行 make app")
        return 1

    ver = version()
    out = make_pkg(ver)
    if not out:
        return 1

    print(f"[pkg] ✅ {out}  ({out.stat().st_size / 1024 / 1024:.1f} MB)")

    # 回读 Bill of Materials，确认安装位置正确
    bom = run(f'pkgutil --payload-files "{out}" 2>/dev/null | head -5')
    lines = [l for l in bom.stdout.strip().splitlines() if l.strip()]
    if lines:
        print("[pkg]    安装内容预览:")
        for line in lines:
            print(f"[pkg]      {line}")

    print(f"\n[pkg] 本机验证：  pkgutil --pkgs | grep mdwriter")
    print(f"[pkg] 卸载：      sudo pkgutil --forget {IDENTIFIER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
