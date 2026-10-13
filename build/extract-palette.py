#!/usr/bin/env python3
"""从截图里提取实际配色，生成精确的调色板。"""
import pathlib
import struct
import zlib

SRC = pathlib.Path("/Users/hkwang9/.workbuddy/blobs/0f/0f641d5c86f65a5c327be49128efb5c286c7fa90db4a4ab6ce5d1095712adcf7.png")


def read_png(path):
    """最小 PNG 解码（只处理 8bit RGB/RGBA，非隔行）。"""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos = 8
    idat = b""
    w = h = bitdepth = colortype = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bitdepth, colortype = struct.unpack(">IIBB", chunk[:10])
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    bpp = channels * bitdepth // 8
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        ft = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if ft == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x - bpp]) & 255
        elif ft == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, channels, bytes(out)


w, h, ch, px = read_png(SRC)
print(f"图片尺寸 {w}x{h}, 通道 {ch}")


def at(x, y):
    o = (y * w + x) * ch
    return px[o], px[o + 1], px[o + 2]


def hexs(rgb):
    return "#%02x%02x%02x" % rgb


# 图片是 Retina 截图，逻辑坐标需乘以 scale 才能对上采样点
scale = w / 1080.0

# 采样点：按截图的界面结构选取（逻辑坐标 1080x702）
LOGICAL = {
    "工具栏底":          (600, 18),
    "侧边栏底":          (60, 200),
    "侧边栏tab选中底":   (40, 71),
    "侧边栏tab未选底":   (130, 71),
    "编辑区底":          (600, 300),
    "编辑区底2":         (1000, 690),
    "状态栏":            (600, 700),
    "标题文字":          (232, 139),
    "正文文字":          (252, 181),
    "正文浅色文字":      (252, 195),
    "标题分隔线":        (500, 158),
    "强调蓝选中tab":     (35, 41),
    "引用块底":          (500, 322),
    "引用文字":          (205, 328),
    "表格边框":          (700, 452),
    "表格头文字":        (210, 426),
    "TOC选中底":         (30, 71),
    "TOC文字":           (48, 103),
}

print("\n=== 采样结果（逻辑坐标）===")
for name, (lx, ly) in LOGICAL.items():
    x, y = int(lx * scale), int(ly * scale)
    if 0 <= x < w and 0 <= y < h:
        r, g, b = at(x, y)
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        print(f"  {name:16s} ({lx:4d},{ly:4d})  {hexs((r,g,b))}  亮度 {lum:5.1f}")

# 统计主色（量化后取频次最高）
print("\n=== 主色分布（量化到16级）===")
from collections import Counter
cnt = Counter()
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b = at(x, y)
        if abs(r - g) < 12 and abs(g - b) < 12:   # 灰色系单独统计
            cnt[("gray", (r // 16) * 16)] += 1
        else:
            cnt[("color", (r // 32 * 32, g // 32 * 32, b // 32 * 32))] += 1

grays = [(c, n) for (k, c), n in cnt.items() if k == "gray"]
colors = [(c, n) for (k, c), n in cnt.items() if k == "color"]
grays.sort(key=lambda x: -x[1])
colors.sort(key=lambda x: -x[1])

print("  灰色系 Top8：")
for c, n in grays[:8]:
    v = c if isinstance(c, int) else c[0]
    print(f"    #{v:02x}{v:02x}{v:02x}  ({n})")
print("  彩色系 Top8：")
for c, n in colors[:8]:
    print(f"    #{c[0]:02x}{c[1]:02x}{c[2]:02x}  ({n})")