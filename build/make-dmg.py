#!/usr/bin/env python3
"""
生成 MD Writer.dmg 分发镜像（UDZO 压缩、只读）。

用法
    python3 build/make-dmg.py

产物
    dist/MDWriter-<version>.dmg

说明
    hdiutil 是 macOS 系统自带，无需任何账号或额外工具。
    生成的 dmg 未签名；若要签名公证，请改跑 `python3 build/notarize.py --dmg`。
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "native" / "MDWriter.app"
DIST = ROOT / "dist"


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def version():
    """从已打包的 Info.plist 读版本号，读不到则回退 1.0.0。"""
    r = run(f'/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" '
            f'"{APP}/Contents/Info.plist"')
    v = r.stdout.strip()
    return v if v else "1.0.0"


def main():
    if not (APP / "Contents" / "MacOS" / "MDWriter").exists():
        print("[dmg] ❌ 未找到已打包的 MDWriter.app，请先运行 make app")
        return 1

    ver = version()
    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / f"MDWriter-{ver}.dmg"
    if out.exists():
        out.unlink()

    # UDZO = zlib 压缩的只读镜像，兼容性最好
    r = run(f'hdiutil create -volname "MD Writer" -srcfolder "{APP}" '
            f'-ov -format UDZO "{out}"')
    if r.returncode != 0:
        print("[dmg] ❌ hdiutil 失败")
        print((r.stderr or "").strip()[:600])
        return 1

    print(f"[dmg] ✅ {out}  ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
