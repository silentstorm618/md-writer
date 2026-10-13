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
#   例：echo "已有 ${APP}，属主是 $OWNER" 会炸
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
    # 备份轮转：只保留最近 KEEP_BAKS 个。
    # 不清理的话每跑一次 make default-app 就多一个 7 MB 的副本，
    # 排查问题时反复重装，几轮下来能堆到几十个（实测 30 个 / 200+ MB）。
    # 注意：macOS 自带 bash 3.2，没有 mapfile，用 for + 计数实现。
    KEEP_BAKS=2
    OLD_LIST="$(ls -1dt "${DEST_APP}".old.* 2>/dev/null || true)"
    n=0
    for old in $OLD_LIST; do
      n=$((n + 1))
      if [ "$n" -gt "$KEEP_BAKS" ]; then
        rm -rf "$old" 2>/dev/null \
          || echo "    [注意] 旧备份需手动清理（属主 $(stat -f '%Su' "$old" 2>/dev/null)）：${old##*/}"
      fi
    done
    if [ "$n" -gt "$KEEP_BAKS" ]; then
      echo "    已清理 $((n - KEEP_BAKS)) 个历史备份（保留最近 ${KEEP_BAKS} 个）"
    fi
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

# 开发副本用 com.mdwriter.dev（见 pack-app.py），装到 /Applications 前改回正式 id。
# 若不还原，LaunchServices 里的处理器身份与已注册的默认处理者不一致，
# 设置的默认关联会失效。
python3 - "$DEST_APP" <<'PYEOF'
import plistlib, pathlib, sys
p = pathlib.Path(sys.argv[1]) / "Contents" / "Info.plist"
with open(p, "rb") as f:
    info = plistlib.load(f)
if info.get("CFBundleIdentifier") != "com.mdwriter.app":
    info["CFBundleIdentifier"] = "com.mdwriter.app"
    with open(p, "wb") as f:
        plistlib.dump(info, f)
    print("    bundle id 已还原为 com.mdwriter.app")
PYEOF

# 关键：改完 Info.plist 必须重新签名。
# 签名里记录的是旧的 bundle id（com.mdwriter.dev），plist 改成
# com.mdwriter.app 之后两者不一致，签名即失效 ——
# spctl 报 "invalid Info.plist (plist or signature have been modified)"。
# macOS 会拒绝向签名无效的 App 派发 open 事件，
# 症状就是「双击 .md 只启动 App 却不打开文件」。
codesign --force --deep --sign - "$DEST_APP" 2>/dev/null \
  && echo "    已重新签名"

echo "    已安装（属主 $(stat -f '%Su' "$DEST_APP")）"

echo "==> 注销开发副本与陈旧记录"
# 必须清掉以下几处，否则 open .md 打开的仍是错的东西：
#   1) 开发副本（bundle id 与安装版相同，系统按路径优先匹配开发目录）
#   2) ~/Library/WebKit/<bundleid> —— WebKit 容器，会被注册成 App 声明来源
#   3) 上次注册留下的记录（LS 是累积的，-f 只是追加）
#   4) **WKWebView 运行时缓存目录**（$TMPDIR/<bundleid>、~/.Trash/<bundleid>）
#      这些目录只含 WebKit/ 子目录、没有 Info.plist 也没有二进制，
#      但因为以 bundle id 命名，LaunchServices 会把它们误认成 App 副本并注册。
#      实测：macOS 会把 open 事件派发给 ~/.Trash 里那个空壳，
#      表现为「双击 .md 只启动 App 却不打开文件」——排查了很久才定位到。
"$LSREG" -u "$SRC_APP" 2>/dev/null || true
"$LSREG" -u "$DEST_APP" 2>/dev/null || true
"$LSREG" -u "$DEST_APP.bak" 2>/dev/null || true
"$LSREG" -u "$HOME/Library/WebKit/$BUNDLE_ID" 2>/dev/null || true
# WKWebView / AppKit 运行时缓存：命名与 bundle id 相同，会被 LS 误注册。
# 这些目录没有 Info.plist、没有二进制，但 LS 只看路径就可能当成 App 副本。
# 实测踩过：~/.Trash/com.mdwriter.app 被派发 open 事件，
# 表现为「双击 .md 只启动 App 却不打开文件」。
for d in "$HOME/Library/WebKit/$BUNDLE_ID" \
         "$HOME/Library/Caches/$BUNDLE_ID" \
         "$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)/$BUNDLE_ID" \
         "$HOME/.Trash/$BUNDLE_ID"; do
  [ -e "$d" ] || continue
  "$LSREG" -u "$d" 2>/dev/null || true
  echo "    已注销缓存诱饵: ${d/#$HOME/~}"
done
# 清理历次改名留下的备份（.old.* ）
for old in "$DEST_APP".old.* "$DEST_APP".bak; do
  [ -e "$old" ] && "$LSREG" -u "$old" 2>/dev/null || true
done
sleep 1

echo "==> 注册到 LaunchServices"
"$LSREG" -f "$DEST_APP"
sleep 1

echo "==> 设置默认处理器"
swift "$ROOT/build/set-default.swift" "$BUNDLE_ID" "$UTI_STD" "$UTI_FALLBACK"

echo "==> 验证"

# 签名有效性：这是「只启动不打开」的隐形杀手。
# 签名无效时 macOS 会拒绝派发 open 事件，且没有任何提示。
if ! codesign --verify --deep "$DEST_APP" 2>/dev/null; then
  echo "    签名无效，重新签名..."
  codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true
fi
# plist 与签名里的 bundle id 必须一致
PLIST_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
            "$DEST_APP/Contents/Info.plist" 2>/dev/null || echo '?')"
SIGN_ID="$(codesign -dv "$DEST_APP" 2>&1 | sed -n 's/^Identifier=//p')"
if [ "$PLIST_ID" != "$SIGN_ID" ]; then
  echo "    bundle id 不一致: plist=$PLIST_ID 签名=$SIGN_ID"
  codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true
  SIGN_ID="$(codesign -dv "$DEST_APP" 2>&1 | sed -n 's/^Identifier=//p')"
fi
[ "$PLIST_ID" = "$SIGN_ID" ] \
  && echo "    签名有效（${SIGN_ID}）" \
  || echo "    [注意] 签名仍异常: plist=$PLIST_ID 签名=$SIGN_ID"
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

# 硬校验 + 循环清理诱饵。
#
# WKWebView 每次运行都会重建 $TMPDIR/<bundleid> 并被 LS 重新注册，
# 所以必须**反复清理直到干净** —— 单次清理会在几秒内失效。
# 另外 lsregister -dump 的路径里可能带 "(0x...)" 后缀，
# 解析不当会导致注销失败，用 Python 正则精确提取。
# 硬校验 + 循环清理诱饵。
# WKWebView 会反复重建 $TMPDIR/<bundleid> 并被 LS 重新注册，
# 单次清理几秒内即失效，必须循环到干净为止。
python3 "$ROOT/build/clean-decoy-registrations.py" "$DEST_APP"

PROBE="/tmp/mdwriter-probe.md"
printf '# probe' > "$PROBE" 2>/dev/null || true
# 用独立的 swift 文件而不是 swift -e，避免多层引号转义出错
SWIFT_TMP="$(mktemp -t mdwriter-verify).swift"
cat > "$SWIFT_TMP" <<'SWEOF'
import AppKit
let u = URL(fileURLWithPath: CommandLine.arguments[1])
print(NSWorkspace.shared.urlForApplication(toOpen: u)?.path ?? "none")
SWEOF
VERIFY="$(swift "$SWIFT_TMP" "$PROBE" 2>/dev/null | tail -1)"
rm -f "$PROBE" "$SWIFT_TMP" 2>/dev/null || true

if [ "$VERIFY" = "$DEST_APP" ]; then
  echo "    .md 默认用 $DEST_APP 打开"
else
  echo "    [注意] 实际指向: $VERIFY"
  echo "    若被其他应用抢占，可在「系统设置 → 通用 → 默认应用」里手动选 MD Writer"
  exit 1
fi