# MD Writer

原生 macOS Markdown 编辑器 —— 像 Word 一样排版，也能随手切到源码；一键导出 HTML / PDF / Word / PNG。

## 安装

### 推荐：Homebrew

```bash
brew tap silentstorm618/md-writer https://github.com/silentstorm618/md-writer
brew trust silentstorm618/md-writer
brew install --cask md-writer
```

### 手动下载

从 [Releases](https://github.com/silentstorm618/md-writer/releases) 下载 `MDWriter-<版本>.pkg`（双击进安装器，自动装到 Applications）
或 `MDWriter-<版本>.dmg`（拖入 Applications）。

> **首次打开提示「已损坏，无法打开」？**
>
> 本项目尚未加入 Apple Developer Program，产物无法签名公证。文件本身完好，
> 只是缺 Gatekeeper 票据。两种方式解决：
>
> ```bash
> # 方式 1：用 Homebrew 安装（推荐，自动处理）
> brew install --cask md-writer
>
> # 方式 2：手动移除下载标记
> xattr -dr com.apple.quarantine /Applications/MDWriter.app
> ```
>
> 或在「系统设置 → 隐私与安全性」里点「仍要打开」。
>
> 项目补齐签名公证后此问题消失，步骤见 [docs/NOTARIZATION.md](docs/NOTARIZATION.md)。

### 设为默认打开程序

装好后执行一次，把 `.md` / `.markdown` 的默认打开程序设为 MD Writer：

```bash
make default-app
```

之后双击 `.md` 文件就会用 MD Writer 打开。也可手动设置：
「系统设置 → 通用 → 默认应用 → 文件扩展名 → `.md` → 选 MD Writer」。

#### 排障：双击 `.md` 只启动 App、不打开文件

macOS 有个坑：WKWebView / AppKit 的运行时缓存目录
（`~/Library/Caches/com.mdwriter.app`、`~/Library/WebKit/com.mdwriter.app`、
`$TMPDIR/com.mdwriter.app`）**以 bundle id 命名**，没有 `Info.plist`。
一旦某个操作触发 LaunchServices 扫描全盘（例如**把 App 移到废纸篓**），
这些缓存目录就会被误认成 App 副本并注册，open 事件随之被派发给它们 ——
结果就是 App 启动了，但没有代码打开文件。

排查第一条命令：

```bash
lsregister -dump | grep '^path:' | grep -i mdwriter
```

正常应**只有一行** `/Applications/MDWriter.app`。多出来的行都是诱饵。
用 `make default-app` 可自动清理（脚本会校验并注销诱饵）。

注意：**不要用「移到废纸篓」来替换旧版本**，那正是触发误注册的诱因。
`make default-app` 用 `mv` 改名为 `.old.<时间戳>` 再装新版，不经过废纸篓。

## 构建（推荐 Makefile）

```bash
npm install
make          # 等价于 make app：前端 + 原生 + 组装 .app
make dev      # 前端 watch 模式
make test     # 跑逻辑 + DOM 自检
make clean    # 清理产物
```

也可以用 npm scripts：`npm run build` / `npm run native` / `npm run app` / `npm test`。

## 新增特性（v1.1+）

- **查找 / 替换**（`⌘F`）：所见即所得与源码模式都支持，正则与替换一键完成
- **粘贴富文本自动转 Markdown**：从 Chrome / Word / Notion 复制带格式的内容，自动转成干净 MD 插入（底层 turndown）
- **DOCX 任务列表 checkbox 视觉、Mermaid 转 PNG 嵌入**：DOCX 里流程图不再是源码占位
- **三按钮关闭确认**（macOS 风格：保存 / 不保存 / 取消）
- **持久化侧边栏 / 主题模式 / 目录深度**：重启后状态完整恢复
- **磁盘 assets/ 启动时加载**：跨会话可见已用过的图片
- **最近文件菜单**：原生「文件 → 打开最近」
- **启动恢复"撤销"按钮**：8 秒内可一键清空草稿重新开始
- **save-state 显示具体保存时间**：保存后 3 秒内显示「已保存于 12:34:56」
- **目录深度可配置**（H1 ~ H1-H6）：长文档更友好
- **mermaid 真实字体**：流程图跟随主题字体，不再回退默认
- **离屏 PDF WebView 放到屏幕外**：避免 macOS 14+ alpha<0.1 引起的打印空白
- **未保存文档异步退出确认**：避免冷启动时 0.5s 同步信号阻塞主线程
- **Info.plist LSApplicationCategoryType / NSSupportsAutomaticGraphicsSwitching**：Launchpad 与分类正常


---

## 核心能力

### 多标签页

每个文件一个独立标签页，互不干扰。

| 操作 | 快捷键 |
| --- | --- |
| 新建标签页 | `⌘N` |
| 打开文件（自动开新标签） | `⌘O` |
| 关闭当前标签页 | `⌘W` |
| 关闭其他标签页 | `⌥⇧⌘W` |
| 下一个 / 上一个标签页 | `⇧⌘]` / `⇧⌘[` |
| 跳转到第 N 个标签页 | `⌘1` … `⌘9` |

- 重复打开同一文件 → 自动切到已有标签，不重复打开
- 关闭最后一个标签页 → 自动新建空白文档，不会空界面
- 鼠标中键关闭、双击标签栏空白处新建
- 各标签页独立保存**内容、撤销栈、滚动位置、光标、未保存状态**
- 关闭 App 时若有未保存内容会拦截确认；`saveAll` 依次保存

### 三种编辑模式，共用一份内容

| 快捷键 | 模式 | 说明 |
| --- | --- | --- |
| `⌥⌘1` | 所见即所得 | contenteditable 富文本，排版所见即所得 |
| `⌥⌘2` | Markdown 源码 | CodeMirror 6，带语法高亮 / 折叠 / 搜索 |
| `⌥⌘3` | 分栏 | 左源码、右实时预览 |

> 注：视图模式快捷键用 `⌥⌘`，因为 `⌘1-9` 已分配给标签页切换（与 VS Code / Safari 一致）。

### 导出格式

| 格式 | 快捷键 | 实现方式 |
| --- | --- | --- |
| HTML 单文件 | `⇧⌘E` | 内嵌 CSS，图片转 base64，离线可看 |
| PDF | `⌥⌘E` | 离屏 WKWebView 渲染 → 原生打印面板（可选「存储为 PDF」） |
| Word (.docx) | `⌥⌘E` + 选项 | `docx` 库生成真实 docx，标题/列表/表格/代码/图片都保留 |
| PNG 长图 | `⌃⌘E` | html2canvas 整页截图，2x 高清 |
| Markdown | — | 原样导出源文件 |

### 排版主题与字体

5 套主题（技术文档 / 公众号 / 极简 / 羊皮纸 / 深色）× 8 种字体（宋体、黑体、楷体、圆体、等宽、Times、Inter、系统）× 12 档字号。

主题是一组 CSS 变量，**导出 HTML 时原样注入**——所以导出的排版和编辑器里看到的完全一致。

`⌘,` 打开右侧检视器切换。

### 图表与公式

- **Mermaid**：` ```mermaid ` 代码块自动渲染成流程图，导出 HTML 时已转成 SVG
- **KaTeX**：`$行内$` 与 `$$块级$$` 公式，字体已 base64 内联，离线可用
- **代码高亮**：highlight.js，80+ 语言

### 图片管理

- 直接**粘贴**、**拖入**或用 `⌘⇧G` 插入
- 自动落到文档同级的 `assets/` 目录（随 .md 一起可迁移）
- 侧边栏「图片」页可查看并二次插入
- 导出 HTML 时可选内联为 base64

### 其他

- 首次启动载入完整示例文档，不是空白页
- 自动存草稿（localStorage），600ms 防抖，异常退出不丢内容
- 侧边栏目录随标题实时更新，点击跳转
- `⇧⌘/` 插入语法速查文档
- 跟随系统深色模式
- **中英双语界面**：`⌘,` 打开检视器 →「界面语言」切换，可跟随系统 / 简体中文 / English

---

## 架构

```
md-writer/
├── native/
│   ├── main.swift              Swift + WKWebView 外壳
│   ├── Info.plist              含 .md 文档类型关联
│   └── MDWriter.app/           构建产物
├── web/src/
│   ├── main.js                 状态管理 / 视图切换 / 桥接 / 导出调度
│   ├── core/
│   │   ├── renderer.js         marked + KaTeX + mermaid + DOMPurify
│   │   ├── i18n.js             中英词典 + t()/setLang() + data-i18n 应用
│   │   └── theme.js            主题变量 / 字体 / 排版 CSS
│   ├── ui/
│   │   ├── editor.js           所见即所得编辑器（HTML ↔ MD 双向）
│   │   └── source-editor.js    CodeMirror 6 源码编辑器
│   └── export/index.js         MD/HTML/PDF/DOCX/PNG 导出管线
├── homebrew-tap/               Homebrew Cask tap（独立仓库）
│   └── Casks/md-writer.rb      以 pkg 为安装源，CI 自动更新 version/sha256
├── docs/
│   └── NOTARIZATION.md         签名 / 公证操作手册
├── .github/workflows/
│   └── release.yml             push tag → 构建 → 条件公证 → 发 release
└── build/
    ├── build.mjs               esbuild 前端打包
    ├── make-icon.mjs           SVG → PNG → icns
    ├── make-icns.py            icns 二进制组装（绕开 iconutil 限制）
    ├── pack-app.py             app 包组装 + ad-hoc 签名
    ├── make-dmg.py             生成 dmg
    ├── make-pkg.py             生成 pkg（pkgbuild）
    ├── notarize.py             Developer ID 签名 + 公证 + 钉票
    ├── entitlements.plist      Hardened Runtime 例外声明
    ├── finalize.py             清理残留 + 产物校验
    ├── selftest.mjs            纯逻辑自检（68 项）
    └── selftest-dom.mjs        真实 DOM 自检（53 项）
```

**为什么用 Swift + WKWebView 而不是 Tauri / Electron**

本机没有 Rust 工具链，Tauri 要先装 Rust 再编译；Electron 包体 150MB+。WKWebView 是系统自带，产出的 `.app` 只有 **7.8MB**，冷启动快，且能直接用 NSOpenPanel / NSSavePanel / NSPrintOperation 这些原生能力。

---

## 开发

```bash
npm install

node build/build.mjs            # 构建前端
node build/build.mjs --watch    # 前端 watch 模式
swiftc -O -o build/MDWriter native/main.swift   # 编译原生
python3 build/pack-app.py       # 组装 .app
python3 build/finalize.py       # 清理 + 校验

node build/selftest.mjs         # 逻辑自检
node build/selftest-dom.mjs     # DOM 自检
```

## 分发

```bash
make dist                       # 构建 .app + dmg + pkg，输出到 dist/（无需开发者账号）
make dmg                        # 只生成 dmg
make pkg                        # 只生成 pkg

make sign                       # Developer ID 签名（需证书）
make notarize                   # 签名 + 公证 + 钉票 + 产出 dmg/pkg（需证书 + 凭据）
make verify-sign                # 体检当前产物，看能否对外分发
```

产物落在 `dist/`：`MDWriter-<版本>.dmg`、`MDWriter-<版本>.pkg`。

发版只需 push tag，CI 会自动构建、发 release，并更新 `Casks/md-writer.rb` 里的
version / sha256：

```bash
git tag v1.0.1 && git push origin v1.0.1
```

签名公证是**条件执行**的：没配 secrets 时 workflow 自动降级为「只产出未签名产物」，
不会卡住发版。补齐证书后的完整步骤见 [docs/NOTARIZATION.md](docs/NOTARIZATION.md)。

## 自检覆盖

**逻辑自检 72 项**：Markdown 渲染、扩展语法（表格/任务列表/代码块/图片/链接）、标题层级、边界情况、XSS 载荷、导出分块解析、行内 runs 解析、目录生成、500 节文档性能、主题系统、公式保护。

**DOM 自检 62 项**（jsdom 真实环境）：
- XSS 净化 10 种载荷（script / onerror / onload / javascript: / iframe / object / embed / data: URI）
- 合法内容保留 7 项（段落/标题/代码/表格/图片/data:image/链接）
- 编辑器 HTML→Markdown 序列化 16 项
- MD→HTML→MD 往返一致性
- 导出 HTML 结构、主题 CSS 完整性、打印样式

**i18n 自检 26 项**：中英词典 key 一一对应、占位符两边一致、`index.html` 与源码引用的 key 是否存在、Swift 侧 `L10n` 词典完整性、切换语言是否真的生效。这类错误运行时只会静默显示成中文或裸 key，只能靠对比检查发现。

```
DOM 自检：62 通过 / 0 失败
i18n 自检：26 通过 / 0 失败
结果：72 通过 / 0 失败
```

## 安全

渲染管线统一走 DOMPurify，`ALLOWED_URI_REGEXP` 只放行 `https:`/`mailto:`/`tel:`/`#`/相对路径/`data:image/`。粘贴的 HTML 会剥掉除 `href/src/alt/title` 外的所有属性。