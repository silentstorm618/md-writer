#!/usr/bin/env bash
# 把 MD Writer 注册为 Markdown 文档的默认打开程序。
#
# 用法：bash build/set-default-app.sh
#
# 原理：
#   1. lsregister 把 App 注册进 LaunchServices
#   2. LSSetDefaultRoleHandlerForContentType 设置默认处理器（Apple 唯一公开 API）
#
# 踩坑记录（每条都实际踩过）：
#   - 必须装在 /Applications，否则拖文件/发邮件时系统找不到
#   - Info.plist 的 LSHandlerRank 必须是 Owner，否则会被系统既有优先级压过
#   - 开发副本 native/MDWriter.app 与安装版 bundle id 相同，
#     会被系统按路径优先匹配，必须显式 -u 注销，否则 open .md 打开的是开发目录那份
#   - ~/Library/WebKit/<bundleid> 也会被注册成声明来源，必须一并注销
#   - 必须同时设置 net.daringfireball.markdown 和 com.unknown.md：
#     前者是标准 Markdown 类型，后者是扩展名未登记时的动态兜底类型。
#     只设前者会出现「API 返回成功，但双击 .md 打开的还是别的 App」。
#   - 旧版本可能是 root 属主，普通用户删不掉，此时直接报错提示手动移除，
#     不要硬删后留个半成品
#   - 但改名（mv 成 .bak）是 SIP 允许的，比 rm 可靠，
#     所以脚本优先用 mv，mv 失败才提示用户手动处理。
#
# Bash 的一个坑（在本项目实际踩到）：
#   set -u 下，"$VAR" 后面紧跟中文字符时，bash 会把中文的 UTF-8 字节
#   当成变量名的一部分，报 "$VAR?: unbound variable"。
#   例：echo "已有 $APP，属主是 $OWNER" 会炸
#   解法：一律写成 ${APP}，用花括号显式界定边界。
#   下面所有紧跟中文的变量都用了 ${...}，改脚本时请保持这个写法。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_APP="$ROOT/native/MDWriter.app"
DEST_APP="/Applications/MDWriter.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUNDLE_ID="com.mdwriter.app"
UTI_STD="net.daringfireball.markdown"
UTI_FALLBACK="com.unknown.md"

echo "==> 构建 .app"
if [ ! -d "$SRC_APP" ]; then
  echo "    未找到 ${SRC_APP}，请先执行 make app"
  exit 1
fi

echo "==> 安装到 $DEST_APP"
# 旧版本可能是 root 属主（曾用 sudo 装过），此时 rm 会被 SIP 挡掉，
# 连 `do shell script with administrator privileges` 也删不掉。
# 但**改名是允许的** —— mv 成 .bak 再 cp 新版，比 rm 可靠。
# 若 mv 也失败，则说明权限确实不足，明确报错让用户手动处理。
if [ -e "$DEST_APP" ]; then
  # 用时间戳备份名：固定的 .bak 可能已被 root 属主的残留占住，
  # 且那个残留普通用户删不掉，导致 mv 因目标名冲突而失败。
  BAK="${DEST_APP}.old.$(date +%s)"
  if mv "$DEST_APP" "$BAK" 2>/dev/null; then
    echo "    旧版本已改名为 ${BAK##*/}"
  else
    echo "    [注意] 已有 ${DEST_APP}，但无法改名（属主 $(stat -f '%Su' "$DEST_APP" 2>/dev/null || echo '?')）。"
    echo "    请在「访达」里把它移到废纸篓，或执行："
    echo "        sudo rm -rf $DEST_APP"
    echo "    移除后重跑本脚本即可。"
    exit 1
  fi
fi

xattr -cr "$SRC_APP" 2>/dev/null || true
cp -R "$SRC_APP" "$DEST_APP"
echo "    已安装（属主 $(stat -f '%Su' "$DEST_APP")）"

echo "==> 注销开发副本与陈旧记录"
# 必须清掉三处，否则 open .md 打开的仍是旧路径那份：
#   1) 开发副本（bundle id 与安装版相同，系统按路径优先匹配开发目录）
#   2) ~/Library/WebKit/<bundleid> —— WebKit 容器，会被注册成 App 声明来源
#   3) 上次注册留下的记录（LS 是累积的，-f 只是追加）
#
# 特别注意：开发副本很容易被重新注册回来 ——
# 只要有人直接运行 ./native/MDWriter.app/Contents/MacOS/MDWriter，
# 或者从该路径 open，LS 就会把它记进去。
# 两份 bundle id 相同会导致「App 开着时双击 .md 打不开」：
# 事件被路由到开发目录那份，而它的窗口/状态与实际显示的 App 不一致。
# 所以开发期跑完 App 后，重跑一次本脚本清理即可。
"$LSREG" -u "$SRC_APP" 2>/dev/null || true
"$LSREG" -u "$DEST_APP" 2>/dev/null || true
# 清理历次改名留下的备份（.old.* ）
for old in "$DEST_APP".old.* "$DEST_APP".bak; do
  [ -e "$old" ] && "$LSREG" -u "$old" 2>/dev/null || true
done
"$LSREG" -u "$HOME/Library/WebKit/$BUNDLE_ID" 2>/dev/null || true
sleep 1

echo "==> 注册到 LaunchServices"
"$LSREG" -f "$DEST_APP"
sleep 1

echo "==> 设置默认处理器"
swift "$ROOT/build/set-default.swift" "$BUNDLE_ID" "$UTI_STD" "$UTI_FALLBACK"

echo "==> 验证"
# 检查开发副本是否又混进来。
# 注意 make app 里的 pack/finalize 可能触发扫描，把 native/ 那份也记进 LS，
# 所以注销必须放在构建之后 —— 也就是这个位置。
DEV_IN_LS=0
for p in "$SRC_APP" "$HOME/Library/WebKit/$BUNDLE_ID"; do
  [ -e "$p" ] || continue
  if "$LSREG" -dump 2>/dev/null | grep -qF "$p"; then
    "$LSREG" -u "$p" 2>/dev/null || true
    DEV_IN_LS=1
  fi
done
if [ "$DEV_IN_LS" = "1" ]; then
  sleep 1
  "$LSREG" -f "$DEST_APP"
  sleep 1
  echo "    （已清除构建过程重新登记的开发副本）"
fi

PROBE="/tmp/mdwriter-probe.md"
printf '# probe' > "$PROBE" 2>/dev/null || true
VERIFY="$(swift -e "
import AppKit
let u = URL(fileURLWithPath: \"$PROBE\")
print(NSWorkspace.shared.urlForApplication(toOpen: u)?.path ?? \"none\")
" 2>/dev/null | tail -1)"
rm -f "$PROBE" 2>/dev/null || true

if [ "$VERIFY" = "$DEST_APP" ]; then
  echo "    .md 默认用 $DEST_APP 打开"
else
  echo "    [注意] 实际指向: $VERIFY"
  echo "    若被其他应用抢占，可在「系统设置 → 通用 → 默认应用」里手动选 MD Writer"
  exit 1
fi