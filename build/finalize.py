#!/usr/bin/env python3
"""清理打包残留，并对最终产物做完整校验。"""
import pathlib
import plistlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "native" / "MDWriter.app"
CONTENTS = APP / "Contents"


def cleanup():
    removed = 0
    for p in CONTENTS.rglob("*.cstemp*"):
        try:
            if p.is_file():
                p.unlink()
                removed += 1
        except OSError:
            pass
    # 残留的 CodeSignature 若对应不上就清掉，避免 codesign 报replacing existing signature
    sig = CONTENTS / "_CodeSignature"
    if sig.exists() and not (CONTENTS / "MacOS" / "MDWriter").exists():
        shutil.rmtree(sig, ignore_errors=True)
    return removed


def verify():
    ok = True
    print("\n=== 产物校验 ===")

    # 1. 目录结构
    need = [
        CONTENTS / "Info.plist",
        CONTENTS / "MacOS" / "MDWriter",
        CONTENTS / "Resources" / "web" / "index.html",
        CONTENTS / "Resources" / "web" / "app.js",
    ]
    for f in need:
        exists = f.exists()
        size = f.stat().st_size if exists else 0
        mark = "✅" if exists and size > 0 else "❌"
        print(f"  {mark} {f.relative_to(APP)}  ({size/1024:.0f} KB)" if exists else f"  {mark} {f.relative_to(APP)} 缺失")
        if not (exists and size > 0):
            ok = False

    # 2. 图标
    icon = CONTENTS / "Resources" / "AppIcon.icns"
    if icon.exists():
        print(f"  ✅ AppIcon.icns ({icon.stat().st_size/1024:.0f} KB)")
    else:
        print("  ⚠️  图标缺失（不影响运行）")

    # 3. Info.plist 内容
    try:
        with open(CONTENTS / "Info.plist", "rb") as f:
            pl = plistlib.load(f)
        print(f"  ✅ 名称: {pl.get('CFBundleName')}  版本: {pl.get('CFBundleShortVersionString')}")
        dt = pl.get("CFBundleDocumentTypes", [])
        exts = set()
        for d in dt:
            exts.update(d.get("CFBundleTypeExtensions", []))
        print(f"  ✅ 关联扩展名: {', '.join(sorted(exts))}")
        if "md" not in exts:
            print("  ❌ 未关联 .md")
            ok = False
    except Exception as e:
        print(f"  ❌ Info.plist 解析失败: {e}")
        ok = False

    # 4. 二进制架构
    r = subprocess.run(["file", str(CONTENTS / "MacOS" / "MDWriter")],
                       capture_output=True, text=True)
    line = r.stdout.strip()
    if "Mach-O 64-bit executable arm64" in line:
        print("  ✅ arm64 原生二进制")
    else:
        print(f"  ⚠️  {line}")
    if "x86_64" in line:
        print("  ✅ 同时兼容 Intel")

    # 5. 前端 bundle 完整性
    appjs = CONTENTS / "Resources" / "web" / "app.js"
    if appjs.exists():
        txt = appjs.read_text(errors="ignore")
        checks = {
            "marked 渲染器": "marked" in txt or "parse" in txt,
            "KaTeX": "katex" in txt.lower(),
            "mermaid": "mermaid" in txt.lower(),
            "docx": "Packer" in txt or "docx" in txt.lower(),
            "DOMPurify": "sanitize" in txt,
            "highlight.js": "hljs" in txt,
            "html2canvas": "html2canvas" in txt,
        }
        for name, present in checks.items():
            print(f"  {'✅' if present else '❌'} {name}")
            if not present:
                ok = False

    # 6. 体积
    total = sum(f.stat().st_size for f in APP.rglob("*") if f.is_file())
    print(f"\n  总大小: {total/1024/1024:.1f} MB")
    return ok


def main():
    n = cleanup()
    if n:
        print(f"[clean] 清理 {n} 个 cstemp 残留")
    ok = verify()
    print("\n" + ("✅ 全部校验通过" if ok else "❌ 存在问题，见上"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())