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

final class AppDelegate: NSObject, NSApplicationDelegate {

    var window: NSWindow!
    var webView: WKWebView!
    private var docOpenedByApp = false
    private var isJavaScriptReady = false
    private var recentMenu: NSMenu!
    private let recentFilesKey = "MDWriter.recentFiles"
    private let recentFilesLimit = 10

    // MARK: 生命周期

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        registerFileOpen()

        // 启动时若带文件参数则打开
        let args = CommandLine.arguments
        if args.count > 1, FileManager.default.fileExists(atPath: args[1]) {
            openFile(atPath: args[1])
        }
    }

    func application(_ application: NSApplication, openFiles urls: [URL]) {
        if let url = urls.first { openFile(atPath: url.path) }
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
            alert.messageText = "有未保存的文档"
            alert.informativeText = "关闭 MD Writer 会丢失未保存的修改。"
            alert.addButton(withTitle: "保存全部")
            alert.addButton(withTitle: "不保存")
            alert.addButton(withTitle: "取消")
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

        let userContent = WKUserContentController()
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

    /// 页面加载完成 -> 通知前端启动
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        markReady()
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
            let prefix = tabCount > 1 ? "[\(tabCount) 个文档] " : ""
            window.title = dirty ? "\(prefix)\(title) — 未保存" : "\(prefix)\(title)"
            window.subtitle = dirty ? "已修改" : ""
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
            let code = payload["code"] as? String ?? ""
            webView.evaluateJavaScript(code) { result, error in
                let r = String(describing: result ?? "nil")
                let e = error?.localizedDescription ?? "nil"
                print("[eval] result=\(r.prefix(400)) error=\(e)")
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
        let js = "window.MDWriter && window.MDWriter.on('\(name)', \(json));"
        DispatchQueue.main.async { self.webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    /// 页面加载完成后标记 JS 可用（同步查询需要）
    private func markReady() {
        isJavaScriptReady = true
        if CommandLine.arguments.count <= 1 {
            callJS("ready", [:])
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
        panel.title = "打开 Markdown 文件"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = Self.markdownTypes
        panel.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            self?.openFile(atPath: url.path)
        }
    }

    private func openFile(atPath path: String) {
        guard let data = FileManager.default.contents(atPath: path) else { return }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return }
        recordRecent(path)
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
        let suggested = (payload["name"] as? String ?? "未命名").replacingOccurrences(of: ".md", with: "")
        let panel = NSSavePanel()
        panel.title = "保存 Markdown"
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
            showToast("保存失败：\(error.localizedDescription)", kind: "error")
        }
    }

    // MARK: 导出（PDF / DOCX / HTML / PNG 由前端生成二进制，原生只负责落盘）

    private func presentExportPanel(_ payload: [String: Any]) {
        let dataString = payload["base64"] as? String ?? ""
        let suggestedName = payload["name"] as? String ?? "export"
        guard !dataString.isEmpty, let data = Data(base64Encoded: dataString) else { return }

        let panel = NSSavePanel()
        panel.title = "导出为 \(payload["ext"] as? String ?? "文件")"
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
                self.showToast("导出失败：\(error.localizedDescription)", kind: "error")
            }
        }
    }

    // MARK: 图片资源库

    private func saveAsset(_ payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String,
              let data = Data(base64Encoded: b64),
              let name = payload["name"] as? String else { return }
        let dir = Self.assetsDir(for: payload["docPath"] as? String)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try? data.write(to: url)
        callJS("assetSaved", ["name": name, "url": "assets/\(name)", "id": payload["id"] as? String ?? name])
    }

    private func listAssets(_ payload: [String: Any]) {
        let dir = Self.assetsDir(for: payload["docPath"] as? String)
        var files: [[String: Any]] = []
        if let items = try? FileManager.default.contentsOfDirectory(atPath: dir.path) {
            for f in items {
                if f.hasPrefix("."), f != ".DS_Store" { continue }
                var entry: [String: Any] = ["name": f, "url": "assets/\(f)"]
                // 把图片内容转成 base64 dataURL 一并返回，前端直接放进 MDWriterAssets
                let fullPath = dir.appendingPathComponent(f).path
                if let data = FileManager.default.contents(atPath: fullPath) {
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
            let parent = (docPath as NSString).deletingLastPathComponent
            return URL(fileURLWithPath: parent).appendingPathComponent("assets")
        }
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MDWriter/assets", isDirectory: true)
        return support
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
            self?.callJS("nativeToast", ["text": "导出 PDF 失败：\(msg)", "kind": "error"])
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
        appMenu.addItem(withTitle: "关于 MD Writer", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "偏好设置…", action: #selector(openPreferences), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 MD Writer", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 MD Writer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // --- 文件 ---
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "文件")
        fileMenu.addItem(item("新建标签页", #selector(newDoc), "n"))
        fileMenu.addItem(item("打开…", #selector(openDoc), "o"))
        // 打开最近：动态加载 UserDefaults 里的最近文件列表
        self.recentMenu = NSMenu(title: "打开最近")
        rebuildRecentMenu()
        let recentItem = NSMenuItem(title: "打开最近", action: nil, keyEquivalent: "")
        recentItem.submenu = recentMenu
        fileMenu.addItem(recentItem)
        fileMenu.addItem(item("清空最近文件", #selector(clearRecentFiles), ""))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("关闭标签页", #selector(closeTab), "w"))
        fileMenu.addItem(item("关闭其他标签页", #selector(closeOtherTabs), "w", [.option, .command, .shift]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("保存", #selector(saveDoc), "s"))
        fileMenu.addItem(item("另存为…", #selector(saveDocAs), "s", [.shift, .command]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("导出为 HTML…", #selector(exportHTML), "e", [.shift, .command]))
        fileMenu.addItem(item("导出为 PDF…", #selector(exportPDF), "e", [.option, .command]))
        fileMenu.addItem(item("导出为 Word…", #selector(exportDOCX), "e", [.option, .command]))
        fileMenu.addItem(item("导出为 PNG 长图…", #selector(exportPNG), "e", [.control, .command]))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("打印…", #selector(printDoc), "p", [.command, .shift]))
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // --- 编辑 ---
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(item("撤销", #selector(undoWeb), "z", [.command]))
        editMenu.addItem(item("重做", #selector(redoWeb), "z", [.command, .shift]))
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(item("粘贴为纯文本", #selector(pastePlain), "v", [.shift, .command]))
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(item("查找…", #selector(findText), "f"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // --- 格式 ---
        let fmtItem = NSMenuItem()
        let fmtMenu = NSMenu(title: "格式")
        fmtMenu.addItem(item("粗体", #selector(toggleBold), "b"))
        fmtMenu.addItem(item("斜体", #selector(toggleItalic), "i"))
        fmtMenu.addItem(item("下划线", #selector(toggleUnderline), "u"))
        fmtMenu.addItem(item("行内代码", #selector(toggleInlineCode), "e", [.command, .shift]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item("标题 1", #selector(h1), "1", [.command, .option]))
        fmtMenu.addItem(item("标题 2", #selector(h2), "2", [.command, .option]))
        fmtMenu.addItem(item("标题 3", #selector(h3), "3", [.command, .option]))
        fmtMenu.addItem(item("正文", #selector(para), "0", [.command, .option]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item("项目符号列表", #selector(bulletList), "l", [.command, .shift]))
        fmtMenu.addItem(item("编号列表", #selector(orderedList), "l", [.command, .shift, .option]))
        fmtMenu.addItem(item("引用", #selector(quoteBlock), "", [.command, .shift, .option]))
        fmtMenu.addItem(item("行内公式", #selector(inlineMath), "m", [.command, .shift]))
        fmtMenu.addItem(item("插入图片…", #selector(insertImage), "g", [.command, .shift]))
        fmtMenu.addItem(.separator())
        fmtMenu.addItem(item("插入 Mermaid 图", #selector(insertMermaid), "m", [.command, .option]))
        fmtMenu.addItem(withTitle: "插入表格", action: #selector(insertTable), keyEquivalent: "")
        fmtMenu.addItem(withTitle: "插入分隔线", action: #selector(insertHR), keyEquivalent: "")
        fmtItem.submenu = fmtMenu
        mainMenu.addItem(fmtItem)

        // --- 视图 ---
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        viewMenu.addItem(item("下一个标签页", #selector(nextTab), "]", [.command, .shift]))
        viewMenu.addItem(item("上一个标签页", #selector(prevTab), "[", [.command, .shift]))
        viewMenu.addItem(.separator())
        // 跳转到第 N 个标签页（⌘1…⌘9）
        for n in 1...9 {
            let mi = NSMenuItem(title: "标签页 \(n)", action: #selector(selectTab(_:)), keyEquivalent: "\(n)")
            mi.keyEquivalentModifierMask = [.command]
            mi.tag = n
            viewMenu.addItem(mi)
        }
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("所见即所得", #selector(modeWYSIWYG), "1", [.command, .option]))
        viewMenu.addItem(item("Markdown 源码", #selector(modeSource), "2", [.command, .option]))
        viewMenu.addItem(item("分栏（源码 + 预览）", #selector(modeSplit), "3", [.command, .option]))
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("放大", #selector(zoomIn), "=", [.command]))
        viewMenu.addItem(item("缩小", #selector(zoomOutSel), "-", [.command]))
        viewMenu.addItem(item("实际大小", #selector(zoomReset), "0", [.command]))
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("侧边栏", #selector(toggleSidebar), "s", [.control, .command]))
        viewMenu.addItem(item("全屏", #selector(toggleFullscreen), "f", [.control, .command]))
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // --- 主题 ---
        let themeItem = NSMenuItem()
        let themeMenu = NSMenu(title: "主题")
        for (name, cmd) in [("跟随系统", #selector(themeSystem)), ("浅色", #selector(themeLight)), ("深色", #selector(themeDark))] {
            themeMenu.addItem(withTitle: name, action: cmd, keyEquivalent: "")
        }
        themeItem.submenu = themeMenu
        mainMenu.addItem(themeItem)

        // --- 窗口 & 帮助 ---
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        winMenu.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)

        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: "帮助")
        helpMenu.addItem(withTitle: "Markdown 语法速查", action: #selector(showHelp), keyEquivalent: "/")
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
            let empty = NSMenuItem(title: "（无最近文件）", action: nil, keyEquivalent: "")
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
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
log("NSApplication 已创建，开始 run loop")

// 自检模式：带 --selftest 启动时，加载完成后自动截图并退出。
// 用于在无 GUI 交互的环境里验证渲染结果。
let args = CommandLine.arguments
if args.contains("--selftest"), let idx = args.firstIndex(of: "--selftest"),
   idx + 1 < args.count {
    let outPath = args[idx + 1]
    DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) {
        delegate.saveScreenshot(to: outPath)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            NSApp.terminate(nil)
        }
    }
}

app.run()