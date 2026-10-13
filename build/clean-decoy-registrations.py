#!/usr/bin/env python3
"""清理 LaunchServices 中被误注册的「诱饵」条目。

WKWebView / AppKit 会生成以 bundle id 命名的运行时数据目录
（$TMPDIR/<id>、~/Library/Caches/<id>、~/Library/WebKit/<id>）。
这些目录没有 Contents/Info.plist，但 LaunchServices 会把它们注册成
kLSBundleClassApplication，open 事件随之被派发给这些空壳 ——

症状：双击 .md 只启动 App，却不打开文件。

因为 WKWebView 会在运行期间反复重建 $TMPDIR 下的目录，
单次清理几秒内就会失效，所以必须循环清理到干净为止。

用法：python3 clean-decoy-registrations.py /Applications/MDWriter.app
"""
import os
import re
import subprocess
import sys
import time

LSREG = ("/System/Library/Frameworks/CoreServices.framework/"
         "Frameworks/LaunchServices.framework/Support/lsregister")

# lsregister -dump 每行形如：
#   path:    /Applications/MDWriter.app (0x42a8)
# 路径本身可能含空格与括号，正则要精确吃掉结尾的 (0x...) 才不会截断。
PAT = re.compile(r"^path:\s+(.+?)\s+\(0x[0-9a-f]+\)\s*$")

MAX_ROUNDS = 6
SLEEP = 2.0


def registered_paths(keyword="mdwriter"):
    """列出 LaunchServices 里所有包含 keyword 的注册路径。"""
    r = subprocess.run([LSREG, "-dump"], capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        m = PAT.match(line)
        if m and keyword in m.group(1).lower():
            out.append(m.group(1))
    return out


def is_real_app(path):
    """判据：有 Contents/Info.plist 才是真 App，否则是缓存/空壳目录。"""
    return os.path.isfile(os.path.join(path, "Contents", "Info.plist"))


def main():
    if len(sys.argv) < 2:
        print("用法: clean-decoy-registrations.py <真实 App 路径>", file=sys.stderr)
        return 1

    real = os.path.realpath(sys.argv[1])
    home = os.path.expanduser("~")

    for rnd in range(MAX_ROUNDS):
        bad = [p for p in registered_paths() if os.path.realpath(p) != real]
        if not bad:
            print(f"[第{rnd}轮] 注册表干净")
            return 0

        for p in bad:
            kind = "另一份 App" if is_real_app(p) else "诱饵(缓存目录)"
            shown = p.replace(home, "~")
            print(f"已注销{kind}: {shown}")
            subprocess.run([LSREG, "-u", p], capture_output=True)
        time.sleep(SLEEP)

    remaining = [p for p in registered_paths() if os.path.realpath(p) != real]
    if remaining:
        print("警告：清理后仍有残留，请手动检查：")
        for p in remaining:
            print(f"  - {p.replace(home, '~')}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
