// 查 .md 扩展名在 LS 数据库里到底绑到哪个 UTI，以及谁声明了它
import Foundation
import CoreServices

let ext = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "md"

print("=== 1. LS 数据库中 .\(ext) 的绑定 ===")
if let uti = UTTypeCreatePreferredIdentifierForTag(kUTTagClassFilenameExtension, ext as CFString, nil)?.takeRetainedValue() {
    print("   首选 UTI: \(uti as String)")
} else {
    print("   ❌ 查不到")
}

print("\n=== 2. md 相关候选 UTI 的默认处理者 ===")
let candidates = [
    "net.daringfireball.markdown",
    "public.markdown",
    "com.unknown.md",
    "dyn.ah62d4rv4ge8043d2",   // 常见的动态 md 类型
]
for c in candidates {
    if let h = LSCopyDefaultRoleHandlerForContentType(c as CFString, .all)?.takeRetainedValue() {
        print("   \(c) → \(h as String)")
    }
}

print("\n=== 3. 谁声明了 com.unknown.md ===")
// 通过 dump 找线索：查 com.unknown.md 的 claim
print("   （需要 lsregister -dump 交叉验证）")

print("\n=== 4. 各 UTI 的 conformance ===")
import UniformTypeIdentifiers
let mdType = UTType("net.daringfireball.markdown")
for c in candidates {
    if let t = UTType(c) {
        let conforms = mdType.map { t.conforms(to: $0) } ?? false
        print("   \(c): conformsToMarkdown=\(conforms)")
    }
}