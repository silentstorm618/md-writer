// 诊断 .md 关联：分别看 UTI 真值、LS 数据库、NSWorkspace 视图
import Foundation
import CoreServices
import AppKit
import UniformTypeIdentifiers

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/probe.md"
let url = URL(fileURLWithPath: path)

print("=== 1. 文件实际 UTI ===")
if let t = try? url.resourceValues(forKeys: [.contentTypeKey]).contentType {
    print("   \(t.identifier)")
}

print("\n=== 2. LaunchServices 数据库（真值）===")
for uti in ["net.daringfireball.markdown", "public.markdown", "public.plain-text"] {
    if let h = LSCopyDefaultRoleHandlerForContentType(uti as CFString, .all)?.takeRetainedValue() {
        let s = h as String
        print("   \(uti) → \(s)\(s == "com.mdwriter.app" ? " ✅" : "")")
    }
}

print("\n=== 3. App 本身是否被系统接受 ===")
if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.mdwriter.app") {
    print("   com.mdwriter.app 路径: \(appURL.path)")
} else {
    print("   ❌ NSWorkspace 找不到 com.mdwriter.app")
}
// 该 App 自称能处理哪些 UTI
let app = URL(fileURLWithPath: "/Applications/MDWriter.app")
if let b = Bundle(url: app) {
    print("   Bundle 可读: \(b.bundleIdentifier ?? "?")")
    let types = b.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]] ?? []
    for t in types {
        let name = t["CFBundleTypeName"] as? String ?? "?"
        let utis = t["LSItemContentTypes"] as? [String] ?? []
        let exts = t["CFBundleTypeExtensions"] as? [String] ?? []
        let rank = t["LSHandlerRank"] as? String ?? "Default"
        print("   声明「\(name)」 rank=\(rank) uti=\(utis) ext=\(exts)")
    }
}
// NSWorkspace 能否列出它的关联
let bundleExtensions = NSWorkspace.shared.urlsForApplications(toOpen: url)
    .filter { $0.lastPathComponent == "MDWriter.app" }
    .map { _ in "见候选列表" }
if !bundleExtensions.isEmpty {
    print("   系统认为它能打开 .md ✅")
} else {
    print("   ❌ 系统不认为它能打开 .md")
}

print("\n=== 4. NSWorkspace 视图（可能有缓存）===")
print("   默认: \(NSWorkspace.shared.urlForApplication(toOpen: url)?.path ?? "none")")

print("\n=== 5. 谁能打开这个文件 ===")
let all = NSWorkspace.shared.urlsForApplications(toOpen: url)
print("   候选数: \(all.count)")
let hasMD = all.contains { $0.lastPathComponent.contains("MDWriter") }
print("   含 MDWriter: \(hasMD)")
if hasMD {
    print("   →", all.filter { $0.lastPathComponent.contains("MDWriter") }.map { $0.path }.joined(separator: "\n     "))
}