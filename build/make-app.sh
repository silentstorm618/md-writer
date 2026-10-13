#!/bin/bash
# 一键构建 MD Writer.app
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APP="$ROOT/native/MDWriter.app"

echo "==> 1/4 构建前端"
node build/build.mjs

echo "==> 2/4 编译原生外壳"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/MDWriter" native/main.swift

echo "==> 3/4 拷贝资源"
cp native/Info.plist "$APP/Contents/Info.plist"
if [ -f native/AppIcon.icns ]; then
  cp native/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi
# web 资源已由 build.mjs 输出到 Resources/web

echo "==> 4/4 签名（ad-hoc）"
# ad-hoc 签名让 macOS 允许运行，且保留真实身份信息
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  （签名跳过，不影响本地运行）"

echo ""
echo "✅ 构建完成：$APP"
echo ""
echo "运行： open \"$APP\""
echo "安装： cp -R \"$APP\" /Applications/"