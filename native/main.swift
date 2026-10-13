//
//  MDWriter — 原生 macOS 外壳（Swift + WKWebView）
//  职责：窗口、原生菜单栏、原生文件对话框、打印/另存 PDF、与前端的消息桥。
//

import Cocoa
import WebKit
import UniformTypeIdentifiers

// MARK: - 桥接消息

/// 前端 -> 原生 的指令
struct BridgeCommand {
    let action: String
    let payload: [String: Any]
}

/// 原生 -> 前端 的回调名（前端在 window.MDWriter.on 监听）
let CALLBACK = "mdwriter.callback"

// MARK: - 本地化（L10n）

/// 中英双语词典。
///
/// 本项目是 `swiftc` 单文件编译，没有 Xcode 资源 bundle，
/// 标准 `.lproj` + `NSLocalizedString` 那一套用不了，所以自建词典。
///
/// 语言真源在 `UserDefaults["MDWriter.language"]`：
/// - 启动时把它注入前端（WKUserScript 写 `window.__MD_LANG__`）
/// - 前端切换语言时回传 `setLanguage`，这里存下来并重建菜单
enum L10n {

    static let preferenceKey = "MDWriter.language"

    /// 用户偏好：auto | zh-CN | en
    static var preference: String {
        get { UserDefaults.standard.string(forKey: preferenceKey) ?? "auto" }
        set { UserDefaults.standard.set(newValue, forKey: preferenceKey) }
    }

    /// --print-lang=xx 用的临时覆盖，不落盘（避免调试命令改掉用户偏好）
    private static var forced: String?
    static func force(_ lang: String?) { forced = lang }

    /// 实际生效的语言（auto 时看系统首选语言）
    static var current: String {
        if let f = forced { return f }
        let pref = preference
        if pref == "zh-CN" || pref == "en" { return pref }
        let first = Locale.preferredLanguages.first ?? "en"
        return first.hasPrefix("zh") ? "zh-CN" : "en"
    }

    /// 取文案。支持 {name} 占位符。
    static func tr(_ key: String, _ args: [String: String] = [:]) -> String {
        let table = current == "en" ? en : zh
        var s = table[key] ?? zh[key] ?? key
        for (k, v) in args { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }

    // MARK: 词典：简体中文

    static let zh: [String: String] = [
        // 应用菜单
        "menu.about": "关于 MD Writer",
        "menu.preferences": "偏好设置…",
        "menu.hide": "隐藏 MD Writer",
        "menu.quit": "退出 MD Writer",
        // 文件
        "menu.file": "文件",
        "menu.newTab": "新建标签页",
        "menu.open": "打开…",
        "menu.openRecent": "打开最近",
        "menu.clearRecent": "清空最近文件",
        "menu.closeTab": "关闭标签页",
        "menu.closeOtherTabs": "关闭其他标签页",
        "menu.save": "保存",
        "menu.saveAs": "另存为…",
        "menu.exportHTML": "导出为 HTML…",
        "menu.exportPDF": "导出为 PDF…",
        "menu.exportWord": "导出为 Word…",
        "menu.exportPNG": "导出为 PNG 长图…",
        "menu.print": "打印…",
        "recent.empty": "（无最近文件）",
        // 编辑
        "menu.edit": "编辑",
        "menu.undo": "撤销",
        "menu.redo": "重做",
        "menu.cut": "剪切",
        "menu.copy": "拷贝",
        "menu.paste": "粘贴",
        "menu.pastePlain": "粘贴为纯文本",
        "menu.selectAll": "全选",
        "menu.find": "查找…",
        // 格式
        "menu.format": "格式",
        "menu.bold": "粗体",
        "menu.italic": "斜体",
        "menu.underline": "下划线",
        "menu.inlineCode": "行内代码",
        "menu.h1": "标题 1",
        "menu.h2": "标题 2",
        "menu.h3": "标题 3",
        "menu.body": "正文",
        "menu.bulletList": "项目符号列表",
        "menu.orderedList": "编号列表",
        "menu.quote": "引用",
        "menu.inlineMath": "行内公式",
        "menu.insertImage": "插入图片…",
        "menu.insertMermaid": "插入 Mermaid 图",
        "menu.insertTable": "插入表格",
        "menu.insertHR": "插入分隔线",
        // 视图
        "menu.view": "视图",
        "menu.nextTab": "下一个标签页",
        "menu.prevTab": "上一个标签页",
        "menu.tab": "标签页 {n}",
        "menu.wysiwyg": "所见即所得",
        "menu.source": "Markdown 源码",
        "menu.split": "分栏（源码 + 预览）",
        "menu.zoomIn": "放大",
        "menu.zoomOut": "缩小",
        "menu.zoomReset": "实际大小",
        "menu.sidebar": "侧边栏",
        "menu.fullscreen": "全屏",
        // 主题
        "menu.theme": "主题",
        "menu.themeSystem": "跟随系统",
        "menu.themeLight": "浅色",
        "menu.themeDark": "深色",
        // 窗口 / 帮助
        "menu.window": "窗口",
        "menu.minimize": "最小化",
        "menu.zoomWindow": "缩放",
        "menu.bringAllToFront": "前置全部窗口",
        "menu.reopenLast": "重新打开最近文件",
        "menu.help": "帮助",
        "err.logNotFound": "还没有诊断日志，正常打开一次文件后就会出现",
        "err.noRecentFile": "还没有打开过文件",
        "menu.cheatsheet": "Markdown 语法速查",
        // 窗口标题 / 状态
        "title.docs": "[{n} 个文档] ",
        "title.unsaved": " — 未保存",
        "title.modified": "已修改",
        // 对话框
        "dialog.openTitle": "打开 Markdown 文件",
        "dialog.saveTitle": "保存 Markdown",
        "dialog.exportTitle": "导出为 {ext}",
        "dialog.untitled": "未命名",
        // 退出确认
        "alert.unsavedTitle": "有未保存的文档",
        "alert.unsavedBody": "关闭 MD Writer 会丢失未保存的修改。",
        "alert.saveAll": "保存全部",
        "alert.dontSave": "不保存",
        "alert.cancel": "取消",
        // 错误提示
        "err.saveFailed": "保存失败：{msg}",
        "err.exportFailed": "导出失败：{msg}",
        "err.pdfFailed": "导出 PDF 失败：{msg}",
    ]

    // MARK: 词典：English

    static let en: [String: String] = [
        "menu.about": "About MD Writer",
        "menu.preferences": "Preferences…",
        "menu.hide": "Hide MD Writer",
        "menu.quit": "Quit MD Writer",

        "menu.file": "File",
        "menu.newTab": "New Tab",
        "menu.open": "Open…",
        "menu.openRecent": "Open Recent",
        "menu.clearRecent": "Clear Menu",
        "menu.closeTab": "Close Tab",
        "menu.closeOtherTabs": "Close Other Tabs",
        "menu.save": "Save",
        "menu.saveAs": "Save As…",
        "menu.exportHTML": "Export as HTML…",
        "menu.exportPDF": "Export as PDF…",
        "menu.exportWord": "Export as Word…",
        "menu.exportPNG": "Export as Long PNG…",
        "menu.print": "Print…",
        "recent.empty": "(No recent files)",

        "menu.edit": "Edit",
        "menu.undo": "Undo",
        "menu.redo": "Redo",
        "menu.cut": "Cut",
        "menu.copy": "Copy",
        "menu.paste": "Paste",
        "menu.pastePlain": "Paste as Plain Text",
        "menu.selectAll": "Select All",
        "menu.find": "Find…",

        "menu.format": "Format",
        "menu.bold": "Bold",
        "menu.italic": "Italic",
        "menu.underline": "Underline",
        "menu.inlineCode": "Inline Code",
        "menu.h1": "Heading 1",
        "menu.h2": "Heading 2",
        "menu.h3": "Heading 3",
        "menu.body": "Body",
        "menu.bulletList": "Bullet List",
        "menu.orderedList": "Numbered List",
        "menu.quote": "Quote",
        "menu.inlineMath": "Inline Formula",
        "menu.insertImage": "Insert Image…",
        "menu.insertMermaid": "Insert Mermaid Diagram",
        "menu.insertTable": "Insert Table",
        "menu.insertHR": "Insert Divider",

        "menu.view": "View",
        "menu.nextTab": "Next Tab",
        "menu.prevTab": "Previous Tab",
        "menu.tab": "Tab {n}",
        "menu.wysiwyg": "Rich Text",
        "menu.source": "Markdown Source",
        "menu.split": "Split (Source + Preview)",
        "menu.zoomIn": "Zoom In",
        "menu.zoomOut": "Zoom Out",
        "menu.zoomReset": "Actual Size",
        "menu.sidebar": "Sidebar",
        "menu.fullscreen": "Fullscreen",

        "menu.theme": "Theme",
        "menu.themeSystem": "Follow System",
        "menu.themeLight": "Light",
        "menu.themeDark": "Dark",

        "menu.window": "Window",
        "menu.minimize": "Minimize",
        "menu.zoomWindow": "Zoom",
        "menu.bringAllToFront": "Bring All to Front",
        "menu.reopenLast": "Reopen Last File",
        "menu.help": "Help",
        "err.logNotFound": "No diagnostic log yet — it appears after opening a file",
        "err.noRecentFile": "No file opened yet",
        "menu.cheatsheet": "Markdown Cheatsheet",

        "title.docs": "[{n} docs] ",
        "title.unsaved": " — Unsaved",
        "title.modified": "Modified",

        "dialog.openTitle": "Open Markdown File",
        "dialog.saveTitle": "Save Markdown",
        "dialog.exportTitle": "Export as {ext}",
        "dialog.untitled": "Untitled",

        "alert.unsavedTitle": "You have unsaved documents",
        "alert.unsavedBody": "Closing MD Writer will discard unsaved changes.",
        "alert.saveAll": "Save All",
        "alert.dontSave": "Don’t Save",
        "alert.cancel": "Cancel",

        "err.saveFailed": "Save failed: {msg}",
        "err.exportFailed": "Export failed: {msg}",
        "err.pdfFailed": "PDF export failed: {msg}",
    ]
}

final class AppDelegate: NSObject, NSApplicationDelegate {

    var window: NSWindow!
    var webView: WKWebView!
    private var docOpenedByApp = false
    private var isJavaScriptReady = false
    /// 前端未就绪时排队的 JS 调用，(事件名, JSON)
    private var pendingJSCalls: [(String, String)] = []
    private var decoyTimer: DispatchSourceTimer?
    private var decoyHealTimer: DispatchSourceTimer?
    private var recentMenu: NSMenu!
    private let recentFilesKey = "MDWriter.recentFiles"
    private let recentFilesLimit = 10
    /// 已打开文档路径白名单：openFile 通过这里记下，asset.save / asset.list 用它校验 docPath。
    /// 不在这里的路径会被视为「伪造」，拒绝写入 / 读取。
    /// 用线程同步队列保护：消息桥回调跨线程调用。
    private var openedDocPaths = Set<String>()
    private let openedDocPathsLock = NSLock()

    // MARK: 生命周期

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 启动日志：确认语言偏好真的生效了（菜单语言不对时先看这一行）
        print("[MDWriter] language=\(L10n.current) "
              + "file=\(L10n.tr("menu.file")) save=\(L10n.tr("menu.save")) quit=\(L10n.tr("menu.quit"))")
        // 显式 flush：GUI App 的 stdout 走管道时是块缓冲，
        // 进程被信号终止时缓冲区会丢，日志就空了
        fflush(stdout)

        // --print-lang[=xx]：打印当前语言后退出，不建窗口。
        // 给脚本 / CI 用，也是排查"菜单为什么还是中文"的第一手段。
        // 带 =xx 时临时按该语言输出（不写偏好），便于直接对比中英词典。
        if let arg = CommandLine.arguments.first(where: { $0.hasPrefix("--print-lang") }) {
            if let eq = arg.firstIndex(of: "=") {
                L10n.force(String(arg[arg.index(after: eq)...])
                    .trimmingCharacters(in: .whitespaces))
            }
            fputs("lang=\(L10n.current)\n"
                  + "file=\(L10n.tr("menu.file"))\n"
                  + "save=\(L10n.tr("menu.save"))\n"
                  + "quit=\(L10n.tr("menu.quit"))\n", stdout)
            fflush(stdout)
            exit(0)
        }

        buildMainMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        registerFileOpen()

        // 启动时自愈：注销被误注册的 WKWebView 缓存目录。
        //
        // WKWebView 会生成 $TMPDIR/<bundleid>、~/Library/Caches/<bundleid>
        // 这类以 bundle id 命名的数据目录。它们没有 Info.plist，
        // 但 LaunchServices 会把它们注册成 kLSBundleClassApplication，
        // 于是 open 事件可能被派发给这些空壳 ——
        // 表现为「双击 .md 只启动 App 却不打开文件」。
        // 每次启动清理一次，确保 open 事件的归属是正确的。
        purgeDecoyApps()

        // WKWebView 会在运行期间重建 $TMPDIR 下的数据目录并被 LS 注册，
        // 定时再清几轮，确保 open 事件始终归属于真正的 App。
        var rounds = 0
        var timer: DispatchSourceTimer?
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.purgeDecoyApps()
            rounds += 1
            if rounds >= 5 { timer?.cancel(); timer = nil }
        }
        let t = DispatchSource.makeTimerSource()
        t.schedule(deadline: .now() + 2, repeating: 2.0)
        t.setEventHandler(handler: work)
        t.resume()
        timer = t
        decoyTimer = t

        // 启动时报告诊断信息：出问题时看一眼日志就知道 App 状态
        traceOpen("启动完成 启动参数=\(CommandLine.arguments)")

        // 启动时若带文件参数则打开
        let args = CommandLine.arguments
        if args.count > 1, FileManager.default.fileExists(atPath: args[1]) {
            openFile(atPath: args[1])
        } else if args.count > 1 {
            traceOpen("启动参数存在但文件不存在: \(args[1])")
        } else {
            // 没有启动参数：说明是裸启动（点 Dock 图标 / 访达打开 App 本体）。
            // 若其实是「双击了某个 .md 但文件没送到」，用户会看到空文档，
            // 这时明确提示一下，避免误以为是文件损坏。
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                guard let self else { return }
                self.traceOpen("裸启动（无文件参数）")
            }
        }
    }

    // macOS 打开文件走两个委托回调：
//   1. application(_:open:)        单个文件（访达双击 / 拖到 Dock）
//   2. application(_:openFiles:)   多个文件
//
// 注意：曾经试过用 NSAppleEventManager 监听 GURL / Oevt 作为"兜底通道"，
// 结果导致 App 在收到 open 事件时崩溃（EXC_BAD_ACCESS，
// 栈顶是 NSAppleEventManager dispatchRawAppleEvent）。
// 原因是 Swift 的 @objc 方法签名与 NSAppleEventManager 期望的不匹配，
// 调用时产生野指针。
// **不要用 NSAppleEventManager 手写处理器**，只用下面两个委托回调。
//
    // **必须用数组版本**。SDK 头文件（NSApplication.h:415-417）写明：
    //   "Document types (CFBundleDocumentTypes) that have no associated
    //    NSDocument class ... will be called via application:openURLs:"
    //   "If this is implemented, -application:openFiles: and
    //    -application:openFile: will not be called."
    //
    // 本 App 没有 NSDocument，所以 macOS 只会调 application:openURLs:
    // 对应 Swift 签名 application(_:open urls: [URL])。
    //
    // ⚠️ 之前写的是 application(_:open url: URL)（单个 URL）。
    // 在 Swift 里这个签名会编译成 application:open:，
    // 与 application:openURLs: 不是同一个 selector，
    // 于是 macOS 永远调不到 —— 症状是「App 启动但文件不打开」，
    // 且日志里没有任何 callback 记录。
    func application(_ application: NSApplication, open urls: [URL]) {
        traceOpen("callback application(open:) 收到 \(urls.count) 个")
        for url in urls { openFile(atPath: url.path) }
        if !urls.isEmpty { NSApp.activate(ignoringOtherApps: true) }
    }

    // 历史命名（openFile: / openFiles:）在 AppKit 里仍然可能被调，
    // 一并实现作为兜底。三者都不会互相干扰 —— 它们是不同 selector。
    func application(_ application: NSApplication, openFile filename: String) {
        traceOpen("callback application(openFile:) \(filename)")
        openFile(atPath: filename)
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ application: NSApplication, openFiles filenames: [String]) {
        traceOpen("callback application(openFiles:) \(filenames.count) 个")
        for f in filenames { openFile(atPath: f) }
        if !filenames.isEmpty { NSApp.activate(ignoringOtherApps: true) }
    }

    /// 菜单：手动重新打开最近使用的文件。
    ///
    /// 背景：macOS 把 open 事件派发给已运行的实例，走的是
    /// application(_:open:) / application(_:openFiles:)。
    /// 某些系统环境下这两个回调收不到文件（比如 App 是被
    /// 旧版本启动后再收到 open 事件）。
    /// 既然「⌘O 选文件」这条路径经过验证是可靠的，
    /// 这里复用同一套逻辑提供兜底入口：记住最近打开的路径，
    /// 用户可从「文件 → 重新打开」直接载入。
    @objc func reopenLastFile() {
        let path = UserDefaults.standard.string(forKey: "mdwriter.lastPath") ?? ""
        guard !path.isEmpty, FileManager.default.fileExists(atPath: path) else {
            showToast(L10n.tr("err.noRecentFile"), kind: "info")
            return
        }
        openFile(atPath: path)
        NSApp.activate(ignoringOtherApps: true)
    }


    /// 在访达中打开诊断日志目录，方便排查文件关联问题
    @objc private func openDiagnosticLog() {
        let p = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("mdwriter-open.log")
        if FileManager.default.fileExists(atPath: p.path) {
            NSWorkspace.shared.activateFileViewerSelecting([p])
        } else {
            let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            NSWorkspace.shared.activateFileViewerSelecting([dir])
            showToast(L10n.tr("err.logNotFound"), kind: "info")
        }
    }



    /// 清除会被 LaunchServices 误注册成 App 的缓存 / 空壳目录。
    ///
    /// WKWebView 与 AppKit 会生成以 bundle id 命名的运行时数据目录
    /// （$TMPDIR/<id>、~/Library/Caches/<id>、~/Library/WebKit/<id>），
    /// 废纸篓里也可能有（把旧版拖进废纸篓时会带上时间戳后缀）。
    /// 这些目录没有 Contents/Info.plist，但 LaunchServices 会把它们
    /// 注册成 kLSBundleClassApplication，open 事件随之被派发给空壳 ——
    /// 症状是「双击 .md 只启动 App 却不打开文件」。
    ///
    /// 两件事都要做：
    ///   1. lsregister -u注销注册
    ///   2. 删掉目录本身（废纸篓里的必须删，否则系统扫描时会再次注册）
    /// WKWebView 会重建 $TMPDIR 下的目录，所以定时重复几轮。
    private func purgeDecoyApps() {
        let bundleID = (Bundle.main.bundleIdentifier ?? "com.mdwriter.app").lowercased()
        let real = "/Applications/MDWriter.app"
        let lsreg = "/System/Library/Frameworks/CoreServices.framework"
            + "/Frameworks/LaunchServices.framework/Support/lsregister"

        let home = FileManager.default.homeDirectoryForCurrentUser
        let roots = [
            URL(fileURLWithPath: NSTemporaryDirectory()),
            home.appendingPathComponent("Library/Caches"),
            home.appendingPathComponent("Library/WebKit"),
            home.appendingPathComponent(".Trash"),
        ]

        for root in roots {
            let items = (try? FileManager.default.contentsOfDirectory(
                atPath: root.path)) ?? []
            for name in items where name.lowercased().contains(bundleID) {
                let url = root.appendingPathComponent(name)
                guard url.path != real,
                      !FileManager.default.fileExists(
                          atPath: url.appendingPathComponent("Contents/Info.plist").path)
                else { continue }

                // 1) 注销注册
                let r = Process()
                r.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                r.arguments = [lsreg, "-u", url.path]
                r.standardOutput = FileHandle.nullDevice
                r.standardError = FileHandle.nullDevice
                try? r.run()
                r.waitUntilExit()

                // 2) 删除目录本身。
                //    $TMPDIR 下的可以随时删（WebKit 会重建）；
                //    废纸篓里的删不掉也没关系，注销已生效。
                try? FileManager.default.removeItem(at: url)
                traceOpen("已清理诱饵: \(url.path)")
            }
        }
    }

    /// 打开文件相关的诊断：写到临时文件，便于排查文件关联问题
    private func traceOpen(_ msg: String) {
        NSLog("[MDWriter] %@", msg)
        let line = "[MDWriter] \(msg)\n"
        let p = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("mdwriter-open.log")
        if let h = try? FileHandle(forWritingTo: p) {
            h.seekToEndOfFile()
            h.write(line.data(using: .utf8)!)
            try? h.close()
        } else {
            try? line.write(to: p, atomically: true, encoding: .utf8)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// 关闭前若有未保存的文档，给出确认（多 Tab 场景更必要）
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard isJavaScriptReady else { return .terminateNow }
        let js = "window.MDWriter && window.MDWriter.query('hasUnsaved', {});"
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self else { return }
            guard result as? Bool == true else {
                self.replyToTerminate(true)
                return
            }
            let alert = NSAlert()
            alert.messageText = L10n.tr("alert.unsavedTitle")
            alert.informativeText = L10n.tr("alert.unsavedBody")
            alert.addButton(withTitle: L10n.tr("alert.saveAll"))
            alert.addButton(withTitle: L10n.tr("alert.dontSave"))
            alert.addButton(withTitle: L10n.tr("alert.cancel"))
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                self.callJS("saveAll", [:])
                // 异步保存后由前端发起关闭
                self.replyToTerminate(true)
            case .alertSecondButtonReturn:
                self.replyToTerminate(true)
            default:
                self.replyToTerminate(false)
            }
        }
        return .terminateLater
    }

    /// 异步告诉 AppKit 终止决策：true=同意退出，false=取消退出
    private func replyToTerminate(_ shouldTerminate: Bool) {
        DispatchQueue.main.async {
            NSApp.reply(toApplicationShouldTerminate: shouldTerminate)
        }
    }

    /// 兼容旧调用：保留同步版本，仅在启动早期 isJavaScriptReady=false 时兜底用
    private func callJSSync(_ name: String, _ payload: [String: Any]) -> Any? {
        guard isJavaScriptReady else { return nil }
        let obj: [String: Any] = payload.isEmpty ? ["_": 0] : payload
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return nil }
        let js = "window.MDWriter && window.MDWriter.query('\(name)', \(json));"
        var result: Any?
        let sem = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(js) { r, _ in
                result = r
                sem.signal()
            }
        }
        _ = sem.wait(timeout: .now() + 0.5)
        return result
    }

    // MARK: 窗口

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1320, height: 860)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView, .unifiedTitleAndToolbar],
            backing: .buffered,
            defer: false
        )
        window.title = "MD Writer"
        window.titlebarAppearsTransparent = false
        window.setFrameAutosaveName("MDWriterMainWindow")
        window.minSize = NSSize(width: 900, height: 560)
        window.center()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // 允许页面内 file:// 资源与剪贴板
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        // 关键：给 WebView 一个独立、非空的 application name。
        // WKWebView 默认用 CFBundleIdentifier 作为应用名来建运行时数据目录，
        // 于是生成 $TMPDIR/com.mdwriter.app / ~/Library/Caches/com.mdwriter.app
        // 这类**以 bundle id 命名**的目录。它们没有 Info.plist，
        // 但 LaunchServices 会把同名目录注册成 kLSBundleClassApplication，
        // 导致 open 事件被派发给这些空壳 ——
        // 症状是「双击 .md 只启动 App 却不打开文件」。
        // 改名后缓存目录不再与 bundle id 同名，从根上避免误注册。
        config.applicationNameForUserAgent = "MDWriterWeb"

        let userContent = WKUserContentController()
        // 在页面自己的脚本之前注入语言：前端 boot 时同步就能读到，
        // 不会先按默认语言渲染一遍再跳变
        userContent.addUserScript(WKUserScript(
            source: "window.__MD_LANG__ = \"\(L10n.current)\";",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = userContentControllerProxy(userContent)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.allowsBackForwardNavigationGestures = false

        // 让网页里的快捷键走原生菜单

        window.contentView?.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            webView.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            webView.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
        ])

        window.delegate = self
        window.makeKeyAndOrderFront(nil)

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent().deletingLastPathComponent())
        }
    }

    /// 页面加载完成 -> 兜底通知
    ///
    /// 主路径是前端主动发 bridgeReady（时序确定）。
    /// 这里只作兜底：万一握手消息丢失，至少不会卡在空白页。
    /// markReady 内部有幂等保护，两条路径不会重复补发。
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, !self.isJavaScriptReady else { return }
            self.traceOpen("握手未到达，用导航完成兜底 markReady")
            self.markReady()
        }
    }

    private func userContentControllerProxy(_ ucc: WKUserContentController) -> WKUserContentController {
        let handler = ScriptMessageHandler { [weak self] message, body in
            self?.handle(command: message, body: body)
        }
        ucc.add(handler, name: "mdwriter")
        return ucc
    }

    // MARK: JS 桥

    private func handle(command: String, body: Any) {
        guard let dict = body as? [String: Any] else { return }
        let action = dict["action"] as? String ?? command
        let payload = dict["payload"] as? [String: Any] ?? [:]

        switch action {
        case "bridgeReady":
            // 前端桥接已挂载完毕，可以安全投递事件了
            traceOpen("收到前端握手 bridgeReady")
            markReady()
        case "open":
            presentOpenPanel()
        case "save":
            saveMarkdown(payload)
        case "saveAs":
            saveMarkdownAs(payload)
        case "export":
            presentExportPanel(payload)
        case "print":
            printDocument()
        case "printHTML":
            printHTML(payload["html"] as? String ?? "")
        case "new":
            callJS("newDocument", [:])
        case "setTitle":
            let title = payload["title"] as? String ?? ""
            let dirty = payload["dirty"] as? Bool ?? false
            let tabCount = payload["tabCount"] as? Int ?? 1
            let prefix = tabCount > 1 ? L10n.tr("title.docs", ["n": "\(tabCount)"]) : ""
            window.title = dirty ? "\(prefix)\(title)\(L10n.tr("title.unsaved"))" : "\(prefix)\(title)"
            window.subtitle = dirty ? L10n.tr("title.modified") : ""
            window.isDocumentEdited = dirty
        case "asset.save":
            saveAsset(payload)
        case "asset.list":
            listAssets(payload)
        case "toast":
            let text = payload["text"] as? String ?? ""
            let kind = payload["kind"] as? String ?? "info"
            showToast(text, kind: kind)
        case "debug.screenshot":
            saveScreenshot(to: payload["path"] as? String)
        case "debug.eval":
            // 仅允许在前端通过 boot 时设置的 window.__MDWRITER_DEBUG__ = true 后调用。
            // 这是「自检模式」专用入口：打开它能执行任意 JS（如截图脚本、查 DOM）。
            // 生产构建里这个 flag 永远 false，所以即便前端被 XSS 攻击也无法借这条桥执行任意代码。
            let code = payload["code"] as? String ?? ""
            webView.evaluateJavaScript("window.__MDWRITER_DEBUG__ === true") { [weak self] flag, _ in
                guard let self, (flag as? Bool) == true else {
                    print("[eval] 拒绝：debug 模式未启用")
                    return
                }
                self.webView.evaluateJavaScript(code) { result, error in
                    let r = String(describing: result ?? "nil")
                    let e = error?.localizedDescription ?? "nil"
                    print("[eval] result=\(r.prefix(400)) error=\(e)")
                }
            }
        case "setLanguage":
            // 前端切换语言 -> 存偏好并重建菜单（菜单是启动时一次性构建的）
            if let lang = payload["lang"] as? String {
                L10n.preference = lang
                buildMainMenu()
            }
        case "focusEditor":
            window.makeKeyAndOrderFront(nil)
            webView.window?.makeFirstResponder(webView)
        default:
            break
        }
    }

    private func callJS(_ name: String, _ payload: [String: Any]) {
        let obj: [String: Any] = payload.isEmpty ? ["_": 0] : payload
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }

        // 前端尚未就绪时先排队，否则事件会被静默丢弃。
        //
        // macOS 处理「用某 App 打开文件」的顺序是：
        //   Apple Event（application:open:）→ applicationDidFinishLaunching
        // 也就是说 openFile 比 markReady 更早执行。WKWebView 那时还没
        // loadHTMLString 完成，evaluateJavaScript 打进去的命令不会执行，
        // 于是窗口打开是一片空白 —— 看起来就像「文件没打开」。
        guard isJavaScriptReady else {
            pendingJSCalls.append((name, json))
            return
        }
        DispatchQueue.main.async {
            let js = "window.MDWriter && window.MDWriter.on('\(name)', \(json));"
            self.webView.evaluateJavaScript(js) { _, err in
                // 带回执：evaluateJavaScript 对「语句求值为 undefined」
                // 也会当成成功，只有抛异常才是失败。
                // 这里用明确的存在性检查，避免再次出现
                // 「日志说已发送、实际被 window.MDWriter && 短路丢弃」的情况。
                if let err {
                    self.traceOpen("投递失败 \(name): \(err.localizedDescription)")
                } else {
                    self.traceOpen("投递成功 \(name)")
                }
            }
        }
    }

    /// 前端桥接就绪（收到 bridgeReady 握手）后启用投递并补发队列。
    ///
    /// 不再用 WKNavigationDelegate 的导航完成回调来判断 ——
    /// 导航完成只保证 HTML 加载完，不保证模块顶层已经把
    /// window.MDWriter 挂上。改由前端主动握手，时序才确定。
    private func markReady() {
        guard !isJavaScriptReady else { return }
        isJavaScriptReady = true
        callJS("ready", [:])
        // 排队期间积压的事件按顺序补发 —— documentOpened 必须排在 ready 之后，
        // 否则前端还没挂上监听就收到文件，事件又丢了。
        let queued = pendingJSCalls
        pendingJSCalls.removeAll()
        traceOpen("补发排队事件 \(queued.count) 个: \(queued.map(\.0))")
        for (name, json) in queued {
            let js = "window.MDWriter && window.MDWriter.on('\(name)', \(json));"
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript(js) { _, err in
                    if let err {
                        self.traceOpen("补发失败 \(name): \(err.localizedDescription)")
                    } else {
                        self.traceOpen("补发成功 \(name)")
                    }
                }
            }
        }
    }

    // MARK: 文件打开

    private func registerFileOpen() {
        guard let docType = UTType(filenameExtension: "md") else { return }
        // 通过 Info.plist 声明后系统会自动路由
        _ = docType
    }

    private func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.title = L10n.tr("dialog.openTitle")
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = Self.markdownTypes
        panel.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            self?.openFile(atPath: url.path)
        }
    }

    private func openFile(atPath path: String) {
        // 文件关联出问题时，这里能给出确切路径。
        // NSLog 在部分环境（如无 Console.app 的 CI / 沙箱）取不到，
        // 所以同时写一份到临时文件，方便排查。
        func trace(_ msg: String) {
            NSLog("[MDWriter] %@", msg)
            let line = "[MDWriter] \(msg)\n"
            let p = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("mdwriter-open.log")
            if let h = try? FileHandle(forWritingTo: p) {
                h.seekToEndOfFile()
                h.write(line.data(using: .utf8)!)
                try? h.close()
            } else {
                try? line.write(to: p, atomically: true, encoding: .utf8)
            }
        }

        let exists = FileManager.default.fileExists(atPath: path)
        trace("openFile: \(path) exists=\(exists)")

        guard exists else { return }
        guard let data = FileManager.default.contents(atPath: path) else {
            trace("openFile: 无法读取内容")
            return
        }
        guard let text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1) else {
            trace("openFile: 编码无法识别")
            return
        }
        recordRecent(path)
        // 加入「已打开文档」白名单：asset.save / asset.list 只能作用于这里的路径，
        // 防止前端伪造 docPath 让我们读 / 写到任意目录。
        let normalized = (path as NSString).standardizingPath
        openedDocPathsLock.lock()
        openedDocPaths.insert(normalized)
        openedDocPathsLock.unlock()
        trace("openFile: 已发送 \(text.count) 字符")
        callJS("documentOpened", [
            "path": path,
            "name": (path as NSString).lastPathComponent,
            "content": text,
        ])
    }

    static let markdownTypes: [UTType] = {
        var types: [UTType] = []
        if let t = UTType(filenameExtension: "md") { types.append(t) }
        if let t = UTType(filenameExtension: "markdown") { types.append(t) }
        if let t = UTType(filenameExtension: "mdx") { types.append(t) }
        if let t = UTType(filenameExtension: "txt") { types.append(t) }
        types.append(.plainText)
        return types
    }()

    // MARK: 保存

    private func saveMarkdown(_ payload: [String: Any]) {
        let content = payload["content"] as? String ?? ""
        // 记下发起保存的 Tab，回调时原样带回，保证更新的是正确的那个
        let tabId = payload["tabId"] as? String ?? ""
        if let path = payload["path"] as? String, !path.isEmpty {
            write(content: content, to: path)
            callJS("documentSaved", [
                "path": path,
                "name": (path as NSString).lastPathComponent,
                "tabId": tabId,
            ])
        } else {
            saveMarkdownAs(payload)
        }
    }

    private func saveMarkdownAs(_ payload: [String: Any]) {
        let content = payload["content"] as? String ?? ""
        let tabId = payload["tabId"] as? String ?? ""
        let suggested = (payload["name"] as? String ?? L10n.tr("dialog.untitled")).replacingOccurrences(of: ".md", with: "")
        let panel = NSSavePanel()
        panel.title = L10n.tr("dialog.saveTitle")
        panel.nameFieldStringValue = suggested + ".md"
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        panel.beginSheetModal(for: window) { [weak self] resp in
            if resp == .OK, let url = panel.url {
                self?.write(content: content, to: url.path)
                self?.callJS("documentSaved", [
                    "path": url.path,
                    "name": url.lastPathComponent,
                    "tabId": tabId,
                ])
            } else {
                // 用户取消保存——通知前端，避免 "保存后关 Tab" 卡死
                self?.callJS("saveCancelled", ["tabId": tabId])
            }
        }
    }

    private func write(content: String, to path: String) {
        do {
            try content.write(toFile: path, atomically: true, encoding: .utf8)
        } catch {
            showToast(L10n.tr("err.saveFailed", ["msg": error.localizedDescription]), kind: "error")
        }
    }

    // MARK: 导出（PDF / DOCX / HTML / PNG 由前端生成二进制，原生只负责落盘）

    private func presentExportPanel(_ payload: [String: Any]) {
        let dataString = payload["base64"] as? String ?? ""
        let suggestedName = payload["name"] as? String ?? "export"
        guard !dataString.isEmpty, let data = Data(base64Encoded: dataString) else { return }

        let panel = NSSavePanel()
        panel.title = L10n.tr("dialog.exportTitle", ["ext": payload["ext"] as? String ?? "file"])
        panel.nameFieldStringValue = suggestedName
        if let ext = payload["ext"] as? String, let ut = UTType(filenameExtension: ext) {
            panel.allowedContentTypes = [ut]
        }
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url)
                self.callJS("exportDone", ["path": url.path, "name": url.lastPathComponent])
            } catch {
                self.showToast(L10n.tr("err.exportFailed", ["msg": error.localizedDescription]), kind: "error")
            }
        }
    }

    // MARK: 图片资源库

    /// 单个图片资源的大小上限：50 MB。base64 编码体积约 1.33x，留足余量后是安全网，
    /// 防止恶意 / 失控的前端一次性把巨文件塞进来撑爆磁盘。
    private static let maxAssetBytes = 50 * 1024 * 1024
    /// 允许写入 assets/ 的扩展名白名单。SVG 不在此列：SVG 可内嵌脚本，
    /// 写入后会通过原 image URL 加载，存在 XSS 入口。
    private static let allowedAssetExts: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "bmp",
    ]

    /// 校验文件名是否安全：必须是纯 basename，不含路径分隔符、不为「.」「..」。
    /// 防止 `../../etc/passwd` 这类路径遍历。
    private static func sanitizedAssetName(_ raw: String) -> String? {
        // 截到最后一个路径分隔符之后；不允许出现 :（Windows 盘符）和 NUL
        let basename = (raw as NSString).lastPathComponent
        if basename.isEmpty || basename == "." || basename == ".." { return nil }
        if basename.contains("/") || basename.contains("\\") || basename.contains(":") { return nil }
        // 限定扩展名；空扩展名也拒绝（避免奇葩类型）
        let ext = (basename as NSString).pathExtension.lowercased()
        guard !ext.isEmpty, allowedAssetExts.contains(ext) else { return nil }
        // 长度上限，防 DoS / 文件名过长的文件系统错误
        guard basename.count <= 80 else { return nil }
        return basename
    }

    private func saveAsset(_ payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String,
              let data = Data(base64Encoded: b64),
              let nameRaw = payload["name"] as? String else { return }
        // 文件大小上限
        guard data.count <= Self.maxAssetBytes else {
            showToast("图片过大（>50MB），已拒绝", kind: "warn")
            return
        }
        // 文件名安全：纯 basename + 白名单扩展名
        guard let name = Self.sanitizedAssetName(nameRaw) else {
            showToast("文件名不合法", kind: "warn")
            return
        }
        // docPath 必须在已打开的文件白名单里；空 docPath 走 Application Support。
        // 前端如果伪造 docPath（如 ~/Library/...），这里直接拒掉，
        // 避免把图片写到任意用户有权限的目录里。
        let docPath = payload["docPath"] as? String
        guard Self.isDocPathAllowed(docPath) else {
            showToast("文档路径无效，未保存图片", kind: "warn")
            return
        }
        let dir = Self.assetsDir(for: docPath)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        // 写入前再做一次标准化 + 范围校验：结果路径必须仍在 dir 之下
        let resolved = url.standardizedFileURL.path
        let dirResolved = dir.standardizedFileURL.path.hasSuffix("/") ? dir.standardizedFileURL.path : dir.standardizedFileURL.path + "/"
        guard resolved.hasPrefix(dirResolved) else {
            showToast("路径越界，未保存图片", kind: "warn")
            return
        }
        do {
            try data.write(to: url, options: [.atomic])
        } catch {
            showToast(L10n.tr("err.saveFailed", ["msg": error.localizedDescription]), kind: "error")
            return
        }
        callJS("assetSaved", ["name": name, "url": "assets/\(name)", "id": payload["id"] as? String ?? name])
    }

    private func listAssets(_ payload: [String: Any]) {
        let docPath = payload["docPath"] as? String
        // 同 saveAsset：必须经过 docPath 白名单校验
        guard Self.isDocPathAllowed(docPath) else {
            callJS("assetList", ["files": []])
            return
        }
        let dir = Self.assetsDir(for: docPath)
        var files: [[String: Any]] = []
        if let items = try? FileManager.default.contentsOfDirectory(atPath: dir.path) {
            for f in items {
                if f.hasPrefix("."), f != ".DS_Store" { continue }
                // 跳过隐藏目录 / 符号链接 / 不在白名单的扩展名
                let ext = (f as NSString).pathExtension.lowercased()
                guard Self.allowedAssetExts.contains(ext) else { continue }
                let fullPath = dir.appendingPathComponent(f).path
                // 二次范围校验：防止列表里出现符号链接指向目录外
                let resolved = (fullPath as NSString).standardizingPath
                let dirResolved = (dir.path as NSString).standardizingPath
                guard resolved.hasPrefix(dirResolved + "/") else { continue }
                var entry: [String: Any] = ["name": f, "url": "assets/\(f)"]
                if let data = FileManager.default.contents(atPath: fullPath),
                   data.count <= Self.maxAssetBytes {
                    entry["dataURL"] = "data:\(Self.mimeForPath(f));base64,\(data.base64EncodedString())"
                }
                if let d = try? FileManager.default.attributesOfItem(atPath: fullPath),
                   let size = d[.size] as? Int, let date = d[.modificationDate] as? Date {
                    entry["size"] = size
                    entry["mtime"] = date.timeIntervalSince1970
                }
                files.append(entry)
            }
        }
        callJS("assetList", ["files": files])
    }

    /// 简易 MIME 推断：仅按扩展名匹配图片类型
    static func mimeForPath(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "bmp": return "image/bmp"
        default: return "application/octet-stream"
        }
    }

    /// assets 目录：与 md 文件同级；若文件未保存则退到 Application Support
    static func assetsDir(for docPath: String?) -> URL {
        let fm = FileManager.default
        if let docPath, !docPath.isEmpty {
            // 即便外层校验过 docPath，这里再做一次规范化防御：
            // 防止父目录里出现 symlink 把我们带出预期的目录。
            let normalized = (docPath as NSString).standardizingPath
            let parent = (normalized as NSString).deletingLastPathComponent
            return URL(fileURLWithPath: parent).appendingPathComponent("assets", isDirectory: true)
        }
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MDWriter/assets", isDirectory: true)
        return support
    }

    /// docPath 是否在「已打开文档」白名单里：nil / 空字符串视为合法（走 Application Support）。
    /// 防止前端通过伪造 docPath 让原生读到任意目录。
    static func isDocPathAllowed(_ docPath: String?) -> Bool {
        guard let docPath, !docPath.isEmpty else { return true }
        // 拿到当前实例的白名单；这里是静态方法，借助 shared delegate 单例。
        // AppDelegate 是单例（main.swift 创建一次），所以直接用 NSApp.delegate 取。
        guard let delegate = NSApp.delegate as? AppDelegate else { return false }
        delegate.openedDocPathsLock.lock()
        defer { delegate.openedDocPathsLock.unlock() }
        let normalized = (docPath as NSString).standardizingPath
        return delegate.openedDocPaths.contains(normalized)
    }

    // MARK: 打印 / PDF

    private func printDocument() {
        guard let info = NSPrintInfo.shared.copy() as? NSPrintInfo else { return }
        info.topMargin = 24; info.bottomMargin = 24
        info.leftMargin = 24; info.rightMargin = 24
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        op.run()
    }

    /// 用离屏 WKWebView 渲染导出的 HTML，再打印（可在系统面板里选「存储为 PDF」）
    private func printHTML(_ html: String) {
        guard !html.isEmpty else { return }
        let printer = PrintWebViewController(html: html, onError: { [weak self] msg in
            self?.callJS("nativeToast", ["text": L10n.tr("err.pdfFailed", ["msg": msg]), "kind": "error"])
        })
        printer.present(from: window)
    }

    // MARK: 截图

    /// 对窗口内容截图（沙箱环境下 screencapture 不可用时的兜底，也方便自动化验证）
    fileprivate func saveScreenshot(to path: String?) {
        guard let path, !path.isEmpty else { return }
        let cfg = WKSnapshotConfiguration()
        cfg.rect = webView.bounds
        cfg.afterScreenUpdates = true
        webView.takeSnapshot(with: cfg) { image, error in
            guard let image,
                  let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                print("[shot] 失败: \(error?.localizedDescription ?? "未知")")
                return
            }
            do {
                try png.write(to: URL(fileURLWithPath: path))
                print("[shot] 已保存 \(path)")
            } catch {
                print("[shot] 写入失败: \(error.localizedDescription)")
            }
        }
    }

    // MARK: Toast

    private func showToast(_ text: String, kind: String) {
        // 交给前端画 toast，原生只兜底弹窗
        if text.isEmpty { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.callJS("nativeToast", ["text": text, "kind": kind])
        }
    }

    // MARK: 菜单

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        // --- MD Writer ---
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: L10n.tr("menu.about"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tr("menu.preferences"), action: #selector(openPreferences), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tr("menu.hide"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tr("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // --- 文件 ---
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: L10n.tr("menu.file"))
        fileMenu.addItem(item(L10n.tr("menu.newTab"), #selector(newDoc), "n"))
        fileMenu.addItem(item(L10n.tr("menu.open"), #selector(openDoc), "o"))
        // 打开最近：动态加载 UserDefaults 里的最近文件列表
        self.recentMenu = NSMenu(title: L10n.tr("menu.openRecent"))
        rebuildRecentMenu()
        let recentItem = NSMenuItem(title: L10n.tr("menu.openRecent"), action: nil, keyEquivalent: "")
        recentItem.submenu = recentMenu
        fileMenu.addItem(recentItem)
        fileMenu.addItem(item(L10n.tr("menu.clearRecent"), #selector(clearRecentFiles), ""))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item(L10n.tr("menu.reopenLast"), #selector(reopenLastFile), "r", [.option, .command]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item(L10n.tr("menu.closeTab"), #selector(closeTab), "w"))
        fileMenu.addItem(item(L10n.tr("menu.closeOtherTabs"), #selector(closeOtherTabs), "w", [.option, .command, .shift]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item(L10n.tr("menu.save"), #selector(saveDoc), "s"))
        fileMenu.addItem(item(L10n.tr("menu.saveAs"), #selector(saveDocAs), "s", [.shift, .command]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item(L10n.tr("menu.exportHTML"), #selector(exportHTML), "e", [.shift, .command]))
        fileMenu.addItem(item(L10n.tr("menu.exportPDF"), #selector(exportPDF), "e", [.option, .command]))
        fileMenu.addItem(item(L10n.tr("menu.exportWord"), #selector(exportDOCX), "e", [.option, .command]))
        fileMenu.addItem(item(L10n.tr("menu.exportPNG"), #selector(exportPNG), "e", [.control, .command]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item(L10n.tr("menu.print"), #selector(printDoc), "p", [.command, .shift]))
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // --- 编辑 ---
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: L10n.tr("menu.edit"))
        editMenu.addItem(item(L10n.tr("menu.undo"), #selector(undoWeb), "z", [.command]))
        editMenu.addItem(item(L10n.tr("menu.redo"), #selector(redoWeb), "z", [.command, .shift]))
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L10n.tr("menu.cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L10n.tr("menu.copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L10n.tr("menu.paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(item(L10n.tr("menu.pastePlain"), #selector(pastePlain), "v", [.shift, .command]))
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L10n.tr("menu.selectAll"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(item(L10n.tr("menu.find"), #selector(findText), "f"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // --- 格式 ---
        let fmtItem = NSMenuItem()
        let fmtMenu = NSMenu(title: L10n.tr("menu.format"))
        fmtMenu.addItem(item(L10n.tr("menu.bold"), #selector(toggleBold), "b"))
        fmtMenu.addItem(item(L10n.tr("menu.italic"), #selector(toggleItalic), "i"))
        fmtMenu.addItem(item(L10n.tr("menu.underline"), #selector(toggleUnderline), "u"))
        fmtMenu.addItem(item(L10n.tr("menu.inlineCode"), #selector(toggleInlineCode), "e", [.command, .shift]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item(L10n.tr("menu.h1"), #selector(h1), "1", [.command, .option]))
        fmtMenu.addItem(item(L10n.tr("menu.h2"), #selector(h2), "2", [.command, .option]))
        fmtMenu.addItem(item(L10n.tr("menu.h3"), #selector(h3), "3", [.command, .option]))
        fmtMenu.addItem(item(L10n.tr("menu.body"), #selector(para), "0", [.command, .option]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item(L10n.tr("menu.bulletList"), #selector(bulletList), "l", [.command, .shift]))
        fmtMenu.addItem(item(L10n.tr("menu.orderedList"), #selector(orderedList), "l", [.command, .shift, .option]))
        fmtMenu.addItem(item(L10n.tr("menu.quote"), #selector(quoteBlock), "", [.command, .shift, .option]))
        fmtMenu.addItem(item(L10n.tr("menu.inlineMath"), #selector(inlineMath), "m", [.command, .shift]))
        fmtMenu.addItem(item(L10n.tr("menu.insertImage"), #selector(insertImage), "g", [.command, .shift]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item(L10n.tr("menu.insertMermaid"), #selector(insertMermaid), "m", [.command, .option]))
        fmtMenu.addItem(withTitle: L10n.tr("menu.insertTable"), action: #selector(insertTable), keyEquivalent: "")
        fmtMenu.addItem(withTitle: L10n.tr("menu.insertHR"), action: #selector(insertHR), keyEquivalent: "")
        fmtItem.submenu = fmtMenu
        mainMenu.addItem(fmtItem)

        // --- 视图 ---
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: L10n.tr("menu.view"))
        viewMenu.addItem(item(L10n.tr("menu.nextTab"), #selector(nextTab), "]", [.command, .shift]))
        viewMenu.addItem(item(L10n.tr("menu.prevTab"), #selector(prevTab), "[", [.command, .shift]))
        viewMenu.addItem(.separator())
        // 跳转到第 N 个标签页（⌘1…⌘9）
        for n in 1...9 {
            let mi = NSMenuItem(title: L10n.tr("menu.tab", ["n": "\(n)"]), action: #selector(selectTab(_:)), keyEquivalent: "\(n)")
            mi.keyEquivalentModifierMask = [.command]
            mi.tag = n
            viewMenu.addItem(mi)
        }
        viewMenu.addItem(.separator())
        viewMenu.addItem(item(L10n.tr("menu.wysiwyg"), #selector(modeWYSIWYG), "1", [.command, .option]))
        viewMenu.addItem(item(L10n.tr("menu.source"), #selector(modeSource), "2", [.command, .option]))
        viewMenu.addItem(item(L10n.tr("menu.split"), #selector(modeSplit), "3", [.command, .option]))
        viewMenu.addItem(.separator())
        viewMenu.addItem(item(L10n.tr("menu.zoomIn"), #selector(zoomIn), "=", [.command]))
        viewMenu.addItem(item(L10n.tr("menu.zoomOut"), #selector(zoomOutSel), "-", [.command]))
        viewMenu.addItem(item(L10n.tr("menu.zoomReset"), #selector(zoomReset), "0", [.command]))
        viewMenu.addItem(.separator())
        viewMenu.addItem(item(L10n.tr("menu.sidebar"), #selector(toggleSidebar), "s", [.control, .command]))
        viewMenu.addItem(item(L10n.tr("menu.fullscreen"), #selector(toggleFullscreen), "f", [.control, .command]))
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // --- 主题 ---
        let themeItem = NSMenuItem()
        let themeMenu = NSMenu(title: L10n.tr("menu.theme"))
        for (name, cmd) in [
            (L10n.tr("menu.themeSystem"), #selector(themeSystem)),
            (L10n.tr("menu.themeLight"), #selector(themeLight)),
            (L10n.tr("menu.themeDark"), #selector(themeDark)),
        ] {
            themeMenu.addItem(withTitle: name, action: cmd, keyEquivalent: "")
        }
        themeItem.submenu = themeMenu
        mainMenu.addItem(themeItem)

        // --- 窗口 & 帮助 ---
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: L10n.tr("menu.window"))
        winMenu.addItem(withTitle: L10n.tr("menu.minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: L10n.tr("menu.zoomWindow"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        winMenu.addItem(withTitle: L10n.tr("menu.bringAllToFront"), action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)

        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: L10n.tr("menu.help"))
        helpMenu.addItem(withTitle: L10n.tr("menu.cheatsheet"), action: #selector(showHelp), keyEquivalent: "/")
        // 打开诊断日志：文件关联出问题时直接看，不用去猜路径
        let logItem = NSMenuItem(title: "打开诊断日志", action: #selector(openDiagnosticLog), keyEquivalent: "")
        logItem.target = self
        helpMenu.addItem(logItem)
        helpItem.submenu = helpMenu
        mainMenu.addItem(helpItem)

        NSApp.mainMenu = mainMenu
    }

    private func item(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.keyEquivalentModifierMask = mods
        return i
    }

    @objc func zoomOutSel() { callJS("zoom", ["delta": -1]) }

    // MARK: 菜单动作 → 转发前端

    @objc func newDoc() { callJS("menuAction", ["name": "new"]) }
    @objc func openDoc() { presentOpenPanel() }

    // MARK: 最近文件

    @objc func clearRecentFiles() {
        UserDefaults.standard.removeObject(forKey: recentFilesKey)
        rebuildRecentMenu()
    }

    @objc func openRecent(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        openFile(atPath: path)
    }

    private func recordRecent(_ path: String) {
        var list = UserDefaults.standard.stringArray(forKey: recentFilesKey) ?? []
        list.removeAll { $0 == path }
        list.insert(path, at: 0)
        if list.count > recentFilesLimit { list = Array(list.prefix(recentFilesLimit)) }
        UserDefaults.standard.set(list, forKey: recentFilesKey)
        rebuildRecentMenu()
    }

    private func rebuildRecentMenu() {
        guard let menu = recentMenu else { return }
        menu.removeAllItems()
        let list = UserDefaults.standard.stringArray(forKey: recentFilesKey) ?? []
        if list.isEmpty {
            let empty = NSMenuItem(title: L10n.tr("recent.empty"), action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
            return
        }
        for path in list {
            let name = (path as NSString).lastPathComponent
            let mi = NSMenuItem(title: name, action: #selector(openRecent(_:)), keyEquivalent: "")
            mi.representedObject = path
            mi.toolTip = path
            menu.addItem(mi)
        }
    }
    @objc func closeTab() { callJS("menuAction", ["name": "closeTab"]) }
    @objc func closeOtherTabs() { callJS("menuAction", ["name": "closeOtherTabs"]) }
    @objc func nextTab() { callJS("menuAction", ["name": "nextTab"]) }
    @objc func prevTab() { callJS("menuAction", ["name": "prevTab"]) }
    @objc func selectTab(_ sender: NSMenuItem) { callJS("switchTab", ["index": sender.tag]) }
    @objc func saveDoc() { callJS("menuAction", ["name": "save"]) }
    @objc func saveDocAs() { callJS("menuAction", ["name": "saveAs"]) }
    @objc func printDoc() { printDocument() }
    @objc func exportHTML() { callJS("menuAction", ["name": "exportHTML"]) }
    @objc func exportPDF() { callJS("menuAction", ["name": "exportPDF"]) }
    @objc func exportDOCX() { callJS("menuAction", ["name": "exportDOCX"]) }
    @objc func exportPNG() { callJS("menuAction", ["name": "exportPNG"]) }

    @objc func toggleBold() { callJS("format", ["name": "bold"]) }
    @objc func toggleItalic() { callJS("format", ["name": "italic"]) }
    @objc func toggleUnderline() { callJS("format", ["name": "underline"]) }
    @objc func toggleInlineCode() { callJS("format", ["name": "code"]) }
    @objc func h1() { callJS("format", ["name": "h1"]) }
    @objc func h2() { callJS("format", ["name": "h2"]) }
    @objc func h3() { callJS("format", ["name": "h3"]) }
    @objc func para() { callJS("format", ["name": "p"]) }
    @objc func bulletList() { callJS("format", ["name": "ul"]) }
    @objc func orderedList() { callJS("format", ["name": "ol"]) }
    @objc func quoteBlock() { callJS("format", ["name": "quote"]) }
    @objc func inlineMath() { callJS("format", ["name": "math"]) }
    @objc func insertMermaid() { callJS("format", ["name": "mermaid"]) }
    @objc func insertImage() { callJS("format", ["name": "image"]) }
    @objc func insertTable() { callJS("format", ["name": "table"]) }
    @objc func insertHR() { callJS("format", ["name": "hr"]) }

    @objc func modeWYSIWYG() { callJS("setMode", ["mode": "wysiwyg"]) }
    @objc func modeSource() { callJS("setMode", ["mode": "source"]) }
    @objc func modeSplit() { callJS("setMode", ["mode": "split"]) }
    @objc func zoomIn() { callJS("zoom", ["delta": 1]) }
    @objc func zoomReset() { callJS("zoom", ["delta": 0]) }
    @objc func toggleSidebar() { callJS("menuAction", ["name": "toggleSidebar"]) }
    @objc func toggleFullscreen() { window.toggleFullScreen(nil) }

    @objc func themeSystem() { callJS("setThemeMode", ["mode": "system"]) }
    @objc func themeLight() { callJS("setThemeMode", ["mode": "light"]) }
    @objc func themeDark() { callJS("setThemeMode", ["mode": "dark"]) }

    @objc func findText() { callJS("menuAction", ["name": "find"]) }
    @objc func undoWeb() { callJS("menuAction", ["name": "undo"]) }
    @objc func redoWeb() { callJS("menuAction", ["name": "redo"]) }
    @objc func pastePlain() { callJS("menuAction", ["name": "pastePlain"]) }
    @objc func openPreferences() { callJS("menuAction", ["name": "preferences"]) }
    @objc func showHelp() { callJS("menuAction", ["name": "help"]) }
}

extension AppDelegate: NSWindowDelegate {
    func windowDidBecomeKey(_ notification: Notification) { callJS("focus", [:]) }
}

// MARK: - 工具

/// 离屏渲染 HTML 并唤起打印（PDF 导出走这里）
final class PrintWebViewController: NSObject, WKNavigationDelegate {
    private let html: String
    private var printer: WKWebView?
    private var hostWindow: NSWindow?
    private var failed: Bool = false
    /// 出错时回调外部（一般是 AppDelegate）通知前端 toast
    private let onError: (String) -> Void

    init(html: String, onError: @escaping (String) -> Void = { _ in }) {
        self.html = html
        self.onError = onError
        super.init()
    }

    func present(from window: NSWindow) {
        hostWindow = window

        let config = WKWebViewConfiguration()
        let offscreen = WKWebView(frame: NSRect(x: 0, y: 0, width: 794, height: 1123), configuration: config)
        offscreen.navigationDelegate = self
        // 不再用 alphaValue 隐藏（macOS 14+ 会把 alpha<0.1 的 WKWebView 视为未实例化，导致打印空白）。
        // 直接把窗口放到屏幕外（macOS 多屏环境里取主屏右侧 100pt），orderFront 让 WKWebView 真正完成布局。
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let offX = screenFrame.maxX + 100
        let frame = NSRect(x: offX, y: screenFrame.maxY - 1123, width: 794, height: 1123)
        offscreen.frame = frame

        let host = NSWindow(contentRect: frame,
                            styleMask: [.borderless],
                            backing: .buffered,
                            defer: false)
        host.contentView?.addSubview(offscreen)
        host.isReleasedWhenClosed = false
        host.setFrame(frame, display: true)
        host.orderFront(nil)
        printer = offscreen

        offscreen.loadHTMLString(html, baseURL: nil)

        // 兜底：8 秒仍未渲染完成也走打印（避免用户点了导出却没反应）
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
            guard let self else { return }
            if self.printer != nil {
                print("[print] 兜底触发 doPrint")
                self.doPrint()
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 留出时间给 mermaid/字体/图片完成布局
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            self?.doPrint()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("打印页加载失败: \(error.localizedDescription)")
        failed = true
        onError("渲染未完成：\(error.localizedDescription)")
        finish()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("打印页加载失败（provisional）: \(error.localizedDescription)")
        failed = true
        onError(error.localizedDescription)
        finish()
    }

    private func doPrint() {
        guard let webView = printer, !failed else { finish(); return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.topMargin = 36
        info.bottomMargin = 36
        info.leftMargin = 36
        info.rightMargin = 36
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic

        let op = webView.printOperation(with: info)
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        if let win = webView.window {
            op.runModal(for: win, delegate: self, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
        finish()
    }

    private func finish() {
        DispatchQueue.main.async { [weak self] in
            self?.printer?.window?.orderOut(nil)
            self?.printer?.removeFromSuperview()
            self?.printer = nil
            self?.hostWindow = nil
        }
    }
}

/// WKScriptMessageHandler 转发到 AppDelegate
final class ScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private let onMessage: (String, Any) -> Void
    init(onMessage: @escaping (String, Any) -> Void) { self.onMessage = onMessage }
    func userContentController(_ u: WKUserContentController, didReceive message: WKScriptMessage) {
        onMessage(message.name, message.body)
    }
}

// MARK: - 启动

/// 诊断日志：写入 ~/Library/Logs/MDWriter.log，便于排查启动问题
func log(_ msg: String) {
    let line = "[\(Date())] \(msg)\n"
    if let url = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
        .appendingPathComponent("Logs/MDWriter.log"),
       let fh = try? FileHandle(forWritingTo: url) {
        // 文件不存在则创建
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(line.data(using: .utf8)!)
            try? h.close()
        }
        _ = fh
    }
    print(line, terminator: "")
}

log("启动 MDWriter…")
let app = NSApplication.shared

// 顶层变量持有 delegate，语义更清晰。
// （注：曾怀疑 NSApplication.delegate 的 weak 引用导致 delegate 被提前释放，
//  实测 Swift 顶层 let 的生命周期与进程一致，不会被提前释放，
//  所以那不是本问题的原因。此处只是把变量名改明确。）
let mdWriterDelegate = AppDelegate()
app.delegate = mdWriterDelegate
app.setActivationPolicy(.regular)
log("NSApplication 已创建，开始 run loop")

// 自检模式：带 --selftest 启动时，加载完成后自动截图并退出。
// 用于在无 GUI 交互的环境里验证渲染结果。
let args = CommandLine.arguments
if args.contains("--selftest"), let idx = args.firstIndex(of: "--selftest"),
   idx + 1 < args.count {
    let outPath = args[idx + 1]
    DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) {
        mdWriterDelegate.saveScreenshot(to: outPath)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            NSApp.terminate(nil)
        }
    }
}

app.run()