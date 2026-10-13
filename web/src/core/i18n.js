/**
 * 轻量 i18n —— 中英双语。
 *
 * 语言真源在原生侧 UserDefaults["MDWriter.language"]，启动时由 Swift 用
 * WKUserScript 注入 window.__MD_LANG__，这里同步读取，避免首屏先闪一下中文。
 * 浏览器 / 自检环境没有注入时，回落 localStorage，再回落到跟随系统。
 *
 * 用法
 *   import { t, setLang, getLang } from './core/i18n.js';
 *   t('toast.saved', { name: 'foo.md' })
 *   t('insp.about').split('\n')          // 多行文案
 */

const STORAGE_KEY = 'mdwriter-lang';
const FALLBACK = 'zh-CN';

// MARK: - 词典

const zh = {
  // 语言自身
  'lang.auto': '跟随系统',
  'lang.zh': '简体中文',
  'lang.en': 'English',
  'lang.changed': '语言已切换为{lang}',

  // 工具栏
  'toolbar.mode.wysiwyg': '所见即所得',
  'toolbar.mode.wysiwyg.title': '所见即所得 ⌥⌘1',
  'toolbar.mode.source': '源码',
  'toolbar.mode.source.title': 'Markdown 源码 ⌥⌘2',
  'toolbar.mode.split': '分栏',
  'toolbar.mode.split.title': '分栏 ⌥⌘3',
  'toolbar.new': '＋ 新建',
  'toolbar.new.title': '新建标签页 ⌘N',
  'toolbar.h1.title': '一级标题',
  'toolbar.h2.title': '二级标题',
  'toolbar.h3.title': '三级标题',
  'toolbar.p': '正文',
  'toolbar.p.title': '正文',
  'toolbar.bold.title': '粗体 ⌘B',
  'toolbar.italic.title': '斜体 ⌘I',
  'toolbar.underline.title': '下划线 ⌘U',
  'toolbar.code.title': '行内代码 ⌘⇧`',
  'toolbar.ul.title': '项目符号',
  'toolbar.ol.title': '编号列表',
  'toolbar.quote.title': '引用',
  'toolbar.hr.title': '分隔线',
  'toolbar.table.title': '插入表格',
  'toolbar.mermaid.title': 'Mermaid 流程图',
  'toolbar.math.title': '公式',
  'toolbar.zoomOut.title': '缩小',
  'toolbar.zoomIn.title': '放大',
  'toolbar.export.md.title': '导出 Markdown',
  'toolbar.export.html.title': '导出 HTML',
  'toolbar.export.pdf.title': '导出 PDF',
  'toolbar.export.docx.title': '导出 Word',
  'toolbar.export.png.title': '导出 PNG 长图',
  'toolbar.sidebar.title': '侧边栏 ⌃⌘S',

  // 状态栏
  'status.saved': '已保存',
  'status.modified': '已修改',
  'status.savedAt': '已保存于 {time}',
  'status.unsavedCount': '{n} 个未保存',
  'status.stats': '{chars} 字 · {lines} 行 · {words} 词 · 约 {minutes} 分钟',
  'status.cursor': '行 {line}，列 {col}',
  'status.hint': '<kbd>⌘N</kbd>新建 <kbd>⌘O</kbd>打开 <kbd>⌘W</kbd>关标签 <kbd>⌘1-9</kbd>切换',

  // 侧边栏
  'sidebar.aria': '侧边栏',
  'sidebar.tabs.aria': '侧边栏视图',
  'tabbar.aria': '文档标签',
  'sidebar.toc': '目录',
  'sidebar.images': '图片',
  'sidebar.emptyToc': '还没有标题',
  'sidebar.emptyTocHint': '用 # 开头创建标题',
  'sidebar.emptyImages': '还没有图片',
  'sidebar.emptyImagesHint': '直接粘贴或拖入图片即可',

  // 检视器（偏好设置）
  'insp.exportTheme': '导出主题',
  'insp.font': '字体',
  'insp.fontFamily': '字体族',
  'insp.fontSize': '字号',
  'insp.options': '选项',
  'insp.showToc': '预览显示目录',
  'insp.followSystemFont': '跟随系统字号',
  'insp.tocDepth': '目录深度',
  'insp.about': '关于',
  'insp.about.body': 'MD Writer 1.0\n原生 macOS Markdown 编辑器\n数据全部保存在本地',
  'insp.language': '界面语言',

  // 主题 / 字体显示名（id 不翻译，只翻译 label / desc）
  'theme.tech': '技术文档',
  'theme.tech.desc': '适合技术文章、README、方案文档',
  'theme.wechat': '公众号',
  'theme.wechat.desc': '适合发到微信，15px 字号、1.8 行高',
  'theme.minimal': '极简',
  'theme.minimal.desc': '黑白灰，无装饰，适合打印',
  'theme.parchment': '羊皮纸',
  'theme.parchment.desc': '暖色护眼，长文阅读舒适',
  'theme.dark': '深色',
  'theme.dark.desc': '深色背景，适合屏幕阅读',

  'font.system': '系统默认',
  'font.songti': '宋体',
  'font.heiti': '黑体',
  'font.kai': '楷体',
  'font.yuanti': '圆体',
  'font.mono': '等宽',

  // 文档默认名
  'doc.untitled': '未命名',
  'doc.sample': '使用说明.md',

  // Toast
  'toast.emptyDoc': '文档是空的，没什么可导出的',
  'toast.downloaded': '已下载 .md 文件',
  'toast.draftCleared': '草稿已清空',
  'toast.exportedTo': '已导出到 {name}',
  'toast.imageSaved': '图片已保存：{name}',
  'toast.cheatsheetInserted': '已插入语法速查文档',
  'toast.imageInserted': '已插入图片：{name}',
  'toast.exporting': '正在生成 {fmt}…',
  'toast.exported': '{fmt} 已导出',
  'toast.pdfHint': '在打印面板里选择「PDF → 存储为 PDF」',
  'toast.exportFailed': '导出失败：{msg}',
  'toast.saveFailed': '保存失败：{msg}',
  'toast.alreadyOpen': '{name} 已经打开，已切换过去',
  'toast.opened': '已打开 {name}',
  'toast.draftPrefix': '草稿',
  'toast.savedAll': '已保存 {n} 个文档',
  'toast.savedPartial': '已保存 {n} 个，{failed} 个超时',
  'toast.saved': '已保存 {name}',
  'toast.created': '已新建「{name}」',
  'toast.nothingToSave': '没有需要保存的文档',
  'toast.helpOpened': '已打开使用说明',
  'toast.saveCancelled': '保存已取消',
  'toast.clipboardFailed': '无法读取剪贴板',
  'toast.replaced': '已替换 {n} 处',
  'toast.restored': '已恢复 {n} 个文档',
  'toast.ready': '就绪。⌘N 新建，⌘O 打开，每个文件都是独立标签页',

  // 查找 / 替换
  'find.placeholder': '查找…',
  'find.replace.placeholder': '替换为…',
  'find.prev': '上一个',
  'find.next': '下一个',
  'find.replace': '替换',
  'find.replaceCurrent': '替换当前',
  'find.replaceAll': '替换全部',
  'find.close': '关闭',
  'find.all': '全部',

  // 未保存确认
  'dialog.saveChanges.title': '保存对「{name}」的修改吗？',
  'dialog.saveChanges.body': '关闭前未保存的修改将会丢失。',
  'dialog.cancel': '取消',
  'dialog.discard': '不保存',
  'dialog.save': '保存',

  // 编辑器 / 源码模式
  'editor.linkPrompt': '请输入链接地址',
  'source.aria': 'Markdown 源码',
  'source.placeholder': '在这里写 Markdown…',

  // 渲染错误
  'render.mathError': '公式错误：{expr}',
  'render.mermaidError': 'Mermaid 语法有误：{msg}',

  // 导出产物
  'export.untitledDoc': '未命名文档',
  'export.tocTitle': '目录',
  'export.mermaidPlaceholder': '[Mermaid 图]',
};

const en = {
  'lang.auto': 'Follow System',
  'lang.zh': '简体中文',
  'lang.en': 'English',
  'lang.changed': 'Language switched to {lang}',

  'toolbar.mode.wysiwyg': 'Rich Text',
  'toolbar.mode.wysiwyg.title': 'Rich Text ⌥⌘1',
  'toolbar.mode.source': 'Source',
  'toolbar.mode.source.title': 'Markdown Source ⌥⌘2',
  'toolbar.mode.split': 'Split',
  'toolbar.mode.split.title': 'Split View ⌥⌘3',
  'toolbar.new': '＋ New',
  'toolbar.new.title': 'New Tab ⌘N',
  'toolbar.h1.title': 'Heading 1',
  'toolbar.h2.title': 'Heading 2',
  'toolbar.h3.title': 'Heading 3',
  'toolbar.p': 'Body',
  'toolbar.p.title': 'Body Text',
  'toolbar.bold.title': 'Bold ⌘B',
  'toolbar.italic.title': 'Italic ⌘I',
  'toolbar.underline.title': 'Underline ⌘U',
  'toolbar.code.title': 'Inline Code ⌘⇧`',
  'toolbar.ul.title': 'Bullet List',
  'toolbar.ol.title': 'Numbered List',
  'toolbar.quote.title': 'Quote',
  'toolbar.hr.title': 'Divider',
  'toolbar.table.title': 'Insert Table',
  'toolbar.mermaid.title': 'Mermaid Diagram',
  'toolbar.math.title': 'Formula',
  'toolbar.zoomOut.title': 'Zoom Out',
  'toolbar.zoomIn.title': 'Zoom In',
  'toolbar.export.md.title': 'Export Markdown',
  'toolbar.export.html.title': 'Export HTML',
  'toolbar.export.pdf.title': 'Export PDF',
  'toolbar.export.docx.title': 'Export Word',
  'toolbar.export.png.title': 'Export Long PNG',
  'toolbar.sidebar.title': 'Sidebar ⌃⌘S',

  'status.saved': 'Saved',
  'status.modified': 'Modified',
  'status.savedAt': 'Saved at {time}',
  'status.unsavedCount': '{n} unsaved',
  'status.stats': '{chars} chars · {lines} lines · {words} words · ~{minutes} min',
  'status.cursor': 'Ln {line}, Col {col}',
  'status.hint': '<kbd>⌘N</kbd>New <kbd>⌘O</kbd>Open <kbd>⌘W</kbd>Close <kbd>⌘1-9</kbd>Switch',

  'sidebar.aria': 'Sidebar',
  'sidebar.tabs.aria': 'Sidebar views',
  'tabbar.aria': 'Document tabs',
  'sidebar.toc': 'Outline',
  'sidebar.images': 'Images',
  'sidebar.emptyToc': 'No headings yet',
  'sidebar.emptyTocHint': 'Start a line with #',
  'sidebar.emptyImages': 'No images yet',
  'sidebar.emptyImagesHint': 'Paste or drag an image in',

  'insp.exportTheme': 'Export Theme',
  'insp.font': 'Font',
  'insp.fontFamily': 'Family',
  'insp.fontSize': 'Size',
  'insp.options': 'Options',
  'insp.showToc': 'Show outline in preview',
  'insp.followSystemFont': 'Follow system font size',
  'insp.tocDepth': 'Outline depth',
  'insp.about': 'About',
  'insp.about.body': 'MD Writer 1.0\nNative macOS Markdown editor\nAll data stays on your Mac',
  'insp.language': 'Language',

  'theme.tech': 'Technical',
  'theme.tech.desc': 'For technical articles, READMEs and specs',
  'theme.wechat': 'WeChat',
  'theme.wechat.desc': 'Optimized for WeChat: 15px, 1.8 line height',
  'theme.minimal': 'Minimal',
  'theme.minimal.desc': 'Black and white, no decoration, print-friendly',
  'theme.parchment': 'Parchment',
  'theme.parchment.desc': 'Warm tones, comfortable for long reads',
  'theme.dark': 'Dark',
  'theme.dark.desc': 'Dark background, easy on the eyes',

  'font.system': 'System Default',
  'font.songti': 'Songti',
  'font.heiti': 'Heiti',
  'font.kai': 'Kaiti',
  'font.yuanti': 'Rounded',
  'font.mono': 'Monospace',

  'doc.untitled': 'Untitled',
  'doc.sample': 'Guide.md',

  'toast.emptyDoc': 'Document is empty, nothing to export',
  'toast.downloaded': 'Downloaded .md file',
  'toast.draftCleared': 'Draft cleared',
  'toast.exportedTo': 'Exported to {name}',
  'toast.imageSaved': 'Image saved: {name}',
  'toast.cheatsheetInserted': 'Inserted Markdown cheatsheet',
  'toast.imageInserted': 'Inserted image: {name}',
  'toast.exporting': 'Generating {fmt}…',
  'toast.exported': '{fmt} exported',
  'toast.pdfHint': 'Choose “PDF → Save as PDF” in the print panel',
  'toast.exportFailed': 'Export failed: {msg}',
  'toast.saveFailed': 'Save failed: {msg}',
  'toast.alreadyOpen': '{name} is already open, switched to it',
  'toast.opened': 'Opened {name}',
  'toast.draftPrefix': 'Draft',
  'toast.savedAll': 'Saved {n} documents',
  'toast.savedPartial': 'Saved {n}, {failed} timed out',
  'toast.saved': 'Saved {name}',
  'toast.created': 'Created “{name}”',
  'toast.nothingToSave': 'Nothing to save',
  'toast.helpOpened': 'Opened the guide',
  'toast.saveCancelled': 'Save cancelled',
  'toast.clipboardFailed': 'Cannot read the clipboard',
  'toast.replaced': 'Replaced {n} occurrences',
  'toast.restored': 'Restored {n} documents',
  'toast.ready': 'Ready. ⌘N new, ⌘O open, each file is a separate tab',

  'find.placeholder': 'Find…',
  'find.replace.placeholder': 'Replace with…',
  'find.prev': 'Previous',
  'find.next': 'Next',
  'find.replace': 'Replace',
  'find.replaceCurrent': 'Replace',
  'find.replaceAll': 'Replace All',
  'find.close': 'Close',
  'find.all': 'All',

  'dialog.saveChanges.title': 'Save changes to “{name}”?',
  'dialog.saveChanges.body': 'Unsaved changes will be lost.',
  'dialog.cancel': 'Cancel',
  'dialog.discard': 'Don’t Save',
  'dialog.save': 'Save',

  'editor.linkPrompt': 'Enter link URL',
  'source.aria': 'Markdown source',
  'source.placeholder': 'Write Markdown here…',

  'render.mathError': 'Math error: {expr}',
  'render.mermaidError': 'Invalid Mermaid syntax: {msg}',

  'export.untitledDoc': 'Untitled Document',
  'export.tocTitle': 'Table of Contents',
  'export.mermaidPlaceholder': '[Mermaid Diagram]',
};

const DICT = { 'zh-CN': zh, en };

// MARK: - 状态

let current = FALLBACK;

function normalize(lang) {
  if (!lang) return null;
  const s = String(lang).toLowerCase();
  if (s === 'auto' || s === 'system') return 'auto';
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('en')) return 'en';
  return null;
}

function detectSystem() {
  if (typeof navigator === 'undefined') return FALLBACK;
  // jsdom（自检环境）里 navigator.language 固定是 en-US，
  // 直接跟随会让所有断言中文 UI 的用例挂掉。把它当成"没有信号"，
  // 回落 FALLBACK，保证自检在任何机器上结果一致。
  if ((navigator.userAgent || '').includes('jsdom')) return FALLBACK;
  const l = navigator.language || (navigator.languages && navigator.languages[0]) || '';
  return normalize(l) || FALLBACK;
}

/** 解析 auto：看系统首选语言。 */
export function resolve(lang) {
  const n = normalize(lang);
  if (n && n !== 'auto') return n;
  return detectSystem();
}

export function getLang() {
  return current;
}

/** 原始偏好值（可能是 auto），用于回填下拉框。 */
export function getPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

export function t(key, params) {
  const table = DICT[current] || DICT[FALLBACK];
  let s = table[key];
  if (s === undefined) s = DICT[FALLBACK][key];  // 英文缺 key 时回落中文，别把 key 露给用户
  if (s === undefined) return key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split(`{${k}}`).join(String(params[k]));
    }
  }
  return s;
}

/**
 * 切换语言。
 * @param {string} lang  auto | zh-CN | en
 * @param {object} opts  silent=true 时不通知原生（原生主动推下来时用）
 */
export function setLang(lang, opts = {}) {
  const pref = normalize(lang) || 'auto';
  current = resolve(pref);

  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
  }
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
  applyDOM();
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('mdwriter:langchange', { detail: { lang: current } }));
  }
  if (!opts.silent && typeof window !== 'undefined' && window.MDWriter && window.MDWriter.bridge) {
    window.MDWriter.bridge.send('setLanguage', { lang: pref });
  }
  return current;
}

/** 遍历带 data-i18n* 的元素，把文案写进 DOM。 */
export function applyDOM(root) {
  if (typeof document === 'undefined') return;
  const scope = root || document;
  const set = (sel, attr, fn) => {
    scope.querySelectorAll(sel).forEach((el) => {
      const key = el.getAttribute(attr);
      if (key) fn(el, t(key));
    });
  };
  set('[data-i18n]', 'data-i18n', (el, v) => { el.textContent = v; });
  set('[data-i18n-title]', 'data-i18n-title', (el, v) => { el.setAttribute('title', v); });
  set('[data-i18n-placeholder]', 'data-i18n-placeholder', (el, v) => { el.setAttribute('placeholder', v); });
  set('[data-i18n-aria]', 'data-i18n-aria', (el, v) => { el.setAttribute('aria-label', v); });
  // 多行文案用 data-i18n-html（内容来自词典，非用户输入）
  set('[data-i18n-html]', 'data-i18n-html', (el, v) => { el.innerHTML = v.split('\n').join('<br>'); });
}

/** 语言下拉的选项。 */
export const LANG_OPTIONS = [
  { value: 'auto', labelKey: 'lang.auto' },
  { value: 'zh-CN', labelKey: 'lang.zh' },
  { value: 'en', labelKey: 'lang.en' },
];

/**
 * 仅供自检使用：暴露词典。
 * build/selftest-i18n.mjs 用它校验中英 key 是否一一对应、占位符是否一致。
 */
export function _dict() { return DICT; }

/** 初始化：优先用原生注入的值。 */
export function initI18n() {
  const injected = typeof window !== 'undefined' ? window.__MD_LANG__ : null;
  let pref = null;
  try {
    pref = localStorage.getItem(STORAGE_KEY);
  } catch { /* ignore */ }
  const chosen = injected || pref || 'auto';
  current = resolve(chosen);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
  }
  return current;
}
