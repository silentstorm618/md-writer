#!/usr/bin/env python3
"""
组装 .icns（不依赖 iconutil，避免临时目录写入限制）。

icns 格式：8 字节头('icns' + 总长度) + 若干块，每块 = 4 字节 OSType + 4 字节长度(含头) + PNG 数据。
macOS 接受块内直接放 PNG。
"""
import struct
import sys
import pathlib

SET = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

# OSType -> 该块应包含的尺寸文件
ENTRIES = [
    ("icp4", "icon_16x16.png"),# 16x16
    ("icp5", "icon_32x32.png"),      # 32x32
    ("ic11", "icon_32x32@2x.png"),   # 32x32@2x = 64
    ("ic09", "icon_128x128.png"),    # 128
    ("ic10", "icon_256x256.png"),    # 256
    ("ic12", "icon_256x256@2x.png"), # 512
    ("ic13", "icon_512x512@2x.png"), # 1024
]

chunks = []
for ostype, name in ENTRIES:
    path = SET / name
    if not path.exists():
        print(f"[icns] 跳过缺失 {name}")
        continue
    data = path.read_bytes()
    chunks.append(ostype.encode("ascii") + struct.pack(">I", len(data) + 8) + data)

body = b"".join(chunks)
OUT.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)

print(f"[icns] ✅ {len(chunks)} 个块 → {OUT} ({OUT.stat().st_size} 字节)")