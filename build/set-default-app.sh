#!/usr/bin/env bash
# 把 MD Writer 注册为 Markdown 文档的默认打开程序。
#
# 用法：bash build/set-default-app.sh
#
# 原理：
#   1. lsregister 把 App 注册进 LaunchServices
#   2. LSSetDefaultRoleHandlerForContentType 设置默认处理器（Apple 唯一公开 API）
#
# 踩坑记录：
#   - 必须装在 /Applications，否则拖文件/发邮件时系统找不到
#   - Info.plist 的 LSHandlerRank 必须是 Owner，否则会被系统既有优先级压过
#   - 开发副本（native/MDWriter.app）与安装版 bundle id 相同，
#     会被系统按路径优先匹配，必须显式 -u 注销，否则 open .md 打开的是开发目录那份

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_APP="$ROOT/native/MDWriter.app"
APP="/Applications/MDWriter.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUNDLE_ID="com.mdwriter.app"
UTI="net.daringfireball.markdown"

echo "==> 构建 .app"
[ -d "$SRC_APP" ] || { echo "未找到 $SRC_APP，请先执行 make app"; exit 1; }

echo "==> 移除下载标记（绕过 Gatekeeper）"
xattr -dr com.apple.quarantine "$SRC_APP" 2>/dev/null || true

echo "==> 安装到 $APP"
rm -rf "$APP"
cp -R "$SRC_APP" "$APP"
echo "    ✅ 已安装"

echo "==> 注销开发副本（否则默认打开的是工作区那份）"
"$LSREG" -u "$SRC_APP" 2>/dev/null || true

echo "==> 注册到 LaunchServices"
"$LSREG" -f "$APP"

echo "==> 设置默认处理器"
swift "$ROOT/build/set-default.swift" "$BUNDLE_ID" "$UTI"

echo "==> 验证"
VERIFY=$(swift -e "
import AppKit
let probe = URL(fileURLWithPath: \"/tmp/mdwriter-probe.md\")
try? FileManager.default.createFile(atPath: \"/tmp/mdwriter-probe.md\", contents: Data(\"# probe\".utf8))
print(NSWorkspace.shared.urlForApplication(toOpen: probe)?.path ?? \"none\")
" 2>/dev/null | tail -1)

rm -f /tmp/mdwriter-probe.md 2>/dev/null || true

if [[ "$VERIFY" == "$APP" ]]; then
  echo "    ✅ .md 默认用 $APP 打开"
else
  echo "    ⚠️  实际指向: $VERIFY"
  echo "    若被其他应用抢占，可在「系统设置 → 通用 → 默认应用」里手动选 MD Writer"
  exit 1
fi