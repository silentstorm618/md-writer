// 让正在运行的 MDWriter 自己截图（沙箱下 screencapture 不可用）
// 用法: 由 make-screenshot.swift 通过 URL Scheme 或直接内嵌调用
import Cocoa

// 这里作为一个独立小工具：对指定窗口截图
let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("用法: shot <png路径>\n".data(using: .utf8)!)
    exit(1)
}
let out = args[1]

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// 找到 MDWriter 进程里的窗口
guard let target = NSRunningApplication.runningApplications(withBundleIdentifier: "com.mdwriter.app").first,
      let pid = target.processIdentifier else {
    print("MDWriter 未在运行")
    exit(2)
}

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
guard let win = list.first(where: { ($0[kCGWindowOwnerName as String] as? String)?.contains("MDWriter") == true }) else {
    print("未找到 MDWriter 窗口")
    exit(3)
}

guard let wid = win[kCGWindowNumber as String] as? CGWindowID else { exit(4) }

let img = CGWindowListCreateImage(.null, .optionIncludingWindow, wid, [.boundsIgnoreFraming, .bestResolution])
guard let cgImage = img else {
    print("截图失败")
    exit(5)
}

let rep = NSBitmapImageRep(cgImage: cgImage)
guard let data = rep.representation(using: .png, properties: [:]) else { exit(6) }
try? data.write(to: URL(fileURLWithPath: out))
print("已保存 \(out)")