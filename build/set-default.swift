/**
 * 把指定 bundle id 设为某类文档的默认处理器。
 *
 * 原理：调用 LaunchServices 的 LSSetDefaultRoleHandlerForContentType。
 * 这是 Apple 唯一公开的 API，直接写 LaunchServices 数据库不可靠。
 *
 * 用法: swift set-default.swift <bundleId> <uti> [uti...]
 * 例:   swift set-default.swift com.mdwriter.app net.daringfireball.markdown
 */
import Foundation
import CoreServices
import AppKit
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("用法: set-default <bundleId> <uti> [uti...]\n".data(using: .utf8)!)
    exit(1)
}

let bundleId = args[1]
let utis = Array(args.dropFirst(2))

var failures = 0

for uti in utis {
    let utiStr = uti as CFString

    // 确认这个 UTI 能被正确解析（否则设了也白设）
    guard UTType(uti) != nil else {
        print("  ⚠️  \(uti)  不是有效的 UTI，跳过")
        failures += 1
        continue
    }

    // 关键：先让 LaunchServices 忘掉旧的默认值，
    // 否则 LSSetDefaultRoleHandlerForContentType 会被 "sniffing" 机制干扰。
    if let current = LSCopyDefaultRoleHandlerForContentType(utiStr, .editor)?.takeRetainedValue() {
        let curStr = current as String
        if curStr != bundleId {
            print("  当前默认(editor): \(curStr) → 将改为 \(bundleId)")
        }
    } else {
        print("  \(uti): 此前无默认处理器")
    }

    // viewer 角色也一并设上，双击预览走 viewer，⌘O 走 editor
    let status = LSSetDefaultRoleHandlerForContentType(utiStr, .all, bundleId as CFString)

    if status == noErr {
        print("  ✅ \(uti): 已设为默认")
    } else {
        print("  ❌ \(uti): 失败，OSStatus=\(status)")
        failures += 1
    }
}

// 验证
print("\n验证：")
var bad = 0
for uti in utis {
    if let h = LSCopyDefaultRoleHandlerForContentType(uti as CFString, .all)?.takeRetainedValue() {
        let hStr = h as String
        let ok = hStr == bundleId
        if !ok { bad += 1 }
        print("  \(ok ? "✅" : "❌") \(uti) → \(hStr)")
    } else {
        bad += 1
        print("  ❌ \(uti) → 读取失败")
    }
}

exit(bad == 0 && failures == 0 ? 0 : 1)