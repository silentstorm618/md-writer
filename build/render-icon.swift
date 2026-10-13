// 把 SVG 渲染为多尺寸 PNG，再组装 .icns
// 用法: swift render-icon.swift <svg路径> <输出目录>
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("用法: render-icon <svg> <outdir>\n".data(using: .utf8)!)
    exit(1)
}
let svgPath = args[1]
let outDir = args[2]

let svgURL = URL(fileURLWithPath: svgPath)
guard let svgData = try? Data(contentsOf: svgURL),
      let svgString = String(data: svgData, encoding: .utf8) else {
    FileHandle.standardError.write("无法读取 SVG\n".data(using: .utf8)!)
    exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let sizes = [16, 32, 64, 128, 256, 512, 1024]
var pending = sizes.count

for size in sizes {
    let config = WKWebViewConfiguration()
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: size, height: size), configuration: config)

    let html = """
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;width:\(size)px;height:\(size)px;overflow:hidden;background:transparent}
    svg{display:block;width:\(size)px;height:\(size)px}</style></head>
    <body>\(svgString)</body></html>
    """

    let snapshotConfig = WKSnapshotConfiguration()
    snapshotConfig.rect = NSRect(x: 0, y: 0, width: size, height: size)

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
        web.loadHTMLString(html, baseURL: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
web.takeSnapshot(with: snapshotConfig) { image, _ in
            defer {
                pending -= 1
                if pending == 0 { NSApp.terminate(nil) }
            }
            guard let image else { return }
            // WKWebView 快照带 Retina 比例。用 CGContext 直接按目标像素绘制，
            // 保证 iconutil 拿到的是标准尺寸（16/32/…/1024）。
            guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                  let cs = CGColorSpace(name: CGColorSpace.sRGB),
                  let ctx = CGContext(data: nil,
                                      width: size,
                                      height: size,
                                      bitsPerComponent: 8,
                                      bytesPerRow: 0,
                                      space: cs,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }

            ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
            ctx.draw(source, in: CGRect(x: 0, y: 0, width: size, height: size))

            guard let out = ctx.makeImage(),
                  let data = NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:]) else { return }
            let url = URL(fileURLWithPath: outDir).appendingPathComponent("icon_\(size).png")
            try? data.write(to: url)
        }
        }
    }
}

app.run()