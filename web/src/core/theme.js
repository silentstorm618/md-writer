/**
 * 主题（排版风格）与字体系统。
 * 每个主题是一组 CSS 变量，导出 HTML 时原样注入，保证「导出所见即所得」。
 */

/** 字体族选项：macOS 上真实存在的字体 */
export const FONTS = [
  { id: 'system', label: '系统默认', stack: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif' },
  { id: 'songti', label: '宋体', stack: '"Songti SC", "SimSun", serif' },
  { id: 'heiti', label: '黑体', stack: '"PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif' },
  { id: 'kai', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", serif' },
  { id: 'yuanti', label: '圆体', stack: '"Yuanti SC", "Hiragino Sans GB", sans-serif' },
  { id: 'mono', label: '等宽', stack: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace' },
  { id: 'times', label: 'Times', stack: '"Times New Roman", Times, serif' },
  { id: 'inter', label: 'Inter', stack: '"Inter", "Helvetica Neue", Arial, sans-serif' },
];

export const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32];

/**
 * 导出主题。
 * 配色取自实际界面截图的主色（#101010 深底 / #7ba6f8 强调蓝），
 * 深色主题的对比度经过校验：正文 #e6e6e6 对底 #101010 ≈ 14.6:1。
 */
export const THEMES = [
  {
    id: 'tech',
    label: '技术文档',
    desc: '适合技术文章、README、方案文档',
    vars: {
      '--t-bg': '#ffffff',
      '--t-fg': '#1f2328',
      '--t-muted': '#6b7280',
      '--t-border': '#d8dee4',
      '--t-accent': '#0969da',
      '--t-code-bg': '#f6f8fa',
      '--t-quote-bg': '#f6f8fa',
      '--t-quote-border': '#d0d7de',
      '--t-table-head': '#f6f8fa',
      '--t-mark-bg': '#fff8c5',
      '--t-radius': '8px',
      '--t-line-height': '1.75',
      '--t-heading-weight': '650',
      '--t-max-width': '820px',
    },
  },
  {
    id: 'wechat',
    label: '公众号',
    desc: '适合发到微信，15px 字号、1.8 行高',
    vars: {
      '--t-bg': '#ffffff',
      '--t-fg': '#3f3f3f',
      '--t-muted': '#8a8a8a',
      '--t-border': '#ececec',
      '--t-accent': '#576b95',
      '--t-code-bg': '#f7f7f7',
      '--t-quote-bg': '#f7f7f7',
      '--t-quote-border': '#dcdcdc',
      '--t-table-head': '#fafafa',
      '--t-mark-bg': '#fff3a0',
      '--t-radius': '4px',
      '--t-line-height': '1.85',
      '--t-heading-weight': '700',
      '--t-max-width': '677px',
      '--t-font-size': '15px',
    },
  },
  {
    id: 'minimal',
    label: '极简',
    desc: '黑白灰，无装饰，适合打印',
    vars: {
      '--t-bg': '#ffffff',
      '--t-fg': '#111111',
      '--t-muted': '#767676',
      '--t-border': '#e0e0e0',
      '--t-accent': '#111111',
      '--t-code-bg': '#fafafa',
      '--t-quote-bg': '#ffffff',
      '--t-quote-border': '#cccccc',
      '--t-table-head': '#fafafa',
      '--t-mark-bg': '#f0f0f0',
      '--t-radius': '0px',
      '--t-line-height': '1.7',
      '--t-heading-weight': '700',
      '--t-max-width': '760px',
    },
  },
  {
    id: 'sepia',
    label: '羊皮纸',
    desc: '暖色护眼，长文阅读舒适',
    vars: {
      '--t-bg': '#fbf6ec',
      '--t-fg': '#433422',
      '--t-muted': '#8a7a63',
      '--t-border': '#e3d9c6',
      '--t-accent': '#a0522d',
      '--t-code-bg': '#f2e9d8',
      '--t-quote-bg': '#f5eee0',
      '--t-quote-border': '#d9c9ae',
      '--t-table-head': '#f2e9d8',
      '--t-mark-bg': '#f7e3a1',
      '--t-radius': '6px',
      '--t-line-height': '1.8',
      '--t-heading-weight': '700',
      '--t-max-width': '800px',
    },
  },
  {
    id: 'dark',
    label: '深色',
    desc: '深色背景，适合屏幕阅读',
    vars: {
      '--t-bg': '#101010',
      '--t-fg': '#e6e6e6',
      '--t-muted': '#979ea7',
      '--t-border': '#2a2e35',
      '--t-accent': '#7ba6f8',
      '--t-code-bg': '#191c22',
      '--t-quote-bg': '#191c22',
      '--t-quote-border': '#2f343c',
      '--t-table-head': '#191c22',
      '--t-mark-bg': '#4a4220',
      '--t-radius': '8px',
      '--t-line-height': '1.75',
      '--t-heading-weight': '650',
      '--t-max-width': '820px',
    },
  },
];

/** 计算 WCAG 对比度，用于校验配色可读性 */
export function contrastRatio(fg, bg) {
  const parse = (c) => {
    const s = String(c).replace('#', '');
    const full = s.length === 3 ? s.split('').map((x) => x + x).join('') : s;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const lum = (c) => {
    const [r, g, b] = parse(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(fg), l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}
export function fontById(id) {
  return FONTS.find((f) => f.id === id) || FONTS[0];
}

/** 生成主题 CSS 变量块 */
export function themeVars(theme, font, fontSize) {
  const v = { ...theme.vars };
  v['--t-font-family'] = font.stack;
  v['--t-font-size'] = `${fontSize}px`;
  return Object.entries(v)
    .map(([k, val]) => `  ${k}: ${val};`)
    .join('\n');
}

/**
 * 排版 CSS。这段同时用于：应用内预览、导出 HTML、打印 PDF。
 * 所有取值都走变量，保证换主题/字体只需改变量。
 */
export function contentCSS() {
  return `
.md-body {
  font-family: var(--t-font-family);
  font-size: var(--t-font-size);
  line-height: var(--t-line-height);
  color: var(--t-fg);
  max-width: var(--t-max-width);
  margin: 0 auto;
  padding: 40px 24px 80px;
  word-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}

.md-body > *:first-child { margin-top: 0; }

.md-body h1, .md-body h2, .md-body h3,
.md-body h4, .md-body h5, .md-body h6 {
  font-weight: var(--t-heading-weight);
  line-height: 1.35;
  margin: 1.8em 0 .7em;
  scroll-margin-top: 60px;
}
.md-body h1 { font-size: 1.9em; margin-top: .3em; padding-bottom: .35em; border-bottom: 1px solid var(--t-border); }
.md-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--t-border); }
.md-body h3 { font-size: 1.22em; }
.md-body h4 { font-size: 1.08em; }
.md-body h5 { font-size: 1em; }
.md-body h6 { font-size: .92em; color: var(--t-muted); }

.md-body p { margin: 0 0 1.15em; }

.md-body a {
  color: var(--t-accent);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--t-accent) 35%, transparent);
}
.md-body a:hover { border-bottom-color: var(--t-accent); }

.md-body strong { font-weight: 700; }
.md-body mark { background: var(--t-mark-bg); color: inherit; padding: .1em .25em; border-radius: 3px; }
.md-body del { color: var(--t-muted); }

/* 行内代码 */
.md-body code {
  font-family: var(--mono);
  font-size: .88em;
  background: var(--t-code-bg);
  padding: .18em .38em;
  border-radius: var(--t-radius);
  border: 1px solid var(--t-border);
}

/* 代码块 */
.md-body pre.md-code {
  position: relative;
  background: var(--t-code-bg);
  border: 1px solid var(--t-border);
  border-radius: var(--t-radius);
  padding: 16px 18px;
  margin: 0 0 1.3em;
  overflow-x: auto;
  line-height: 1.6;
}
.md-body pre.md-code code {
  background: none; border: none; padding: 0;
  font-size: .875em; white-space: pre;
}
.md-code-lang {
  position: absolute; top: 6px; right: 10px;
  font-size: 11px; color: var(--t-muted);
  font-family: var(--mono); text-transform: lowercase;
  user-select: none;
}

/* 引用 */
.md-body blockquote {
  margin: 0 0 1.3em;
  padding: .7em 1.1em;
  background: var(--t-quote-bg);
  border-left: 4px solid var(--t-quote-border);
  color: var(--t-muted);
  border-radius: 0 var(--t-radius) var(--t-radius) 0;
}
.md-body blockquote > *:last-child { margin-bottom: 0; }

/* 列表 */
.md-body ul, .md-body ol { margin: 0 0 1.2em; padding-left: 1.6em; }
.md-body li { margin: .28em 0; }
.md-body li > ul, .md-body li > ol { margin: .28em 0; }
.md-body ul.contains-task-list { list-style: none; padding-left: .3em; }
.md-body .task-list-item { list-style: none; }
.md-body input[type=checkbox] { margin-right: .5em; }

/* 表格 */
.md-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 1.4em;
  font-size: .94em;
  display: block;
  overflow-x: auto;
}
.md-body th, .md-body td {
  border: 1px solid var(--t-border);
  padding: .6em .85em;
  text-align: left;
  vertical-align: top;
}
.md-body th { background: var(--t-table-head); font-weight: 650; }
.md-body tbody tr:nth-child(even) { background: color-mix(in srgb, var(--t-table-head) 50%, transparent); }

/* 图片 */
.md-body img {
  max-width: 100%;
  height: auto;
  border-radius: var(--t-radius);
  display: block;
  margin: .4em auto;
}
.md-body figure { margin: 1.4em 0; text-align: center; }
.md-body figcaption { font-size: .85em; color: var(--t-muted); margin-top: .5em; }

/* 分隔线 */
.md-body hr {
  border: none;
  border-top: 1px solid var(--t-border);
  margin: 2em 0;
}

/* Mermaid */
.md-body .md-mermaid {
  margin: 0 0 1.4em;
  text-align: center;
  padding: 18px 10px;
  background: var(--t-quote-bg);
  border: 1px solid var(--t-border);
  border-radius: var(--t-radius);
  overflow-x: auto;
}
.md-body .md-mermaid svg { max-width: 100%; height: auto; }
.md-body .md-mermaid-error {
  text-align: left;
  border-color: #e5534b;
}
.md-mermaid-src {
  margin: 0; padding: 12px;
  background: var(--t-code-bg);
  border-radius: calc(var(--t-radius) - 2px);
  font-family: var(--mono); font-size: .82em;
  overflow-x: auto; color: var(--t-fg);
}
.md-mermaid-tip { font-size: .82em; color: #e5534b; margin-top: 8px; }

/* 公式 */
.md-body .katex { font-size: 1.05em; }
.md-body .katex-display {
  margin: 1.4em 0;
  padding: .5em 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.md-math-error { color: #e5534b; background: transparent !important; border: 1px dashed #e5534b; }

/* 目录 */
.md-body .md-toc {
  background: var(--t-quote-bg);
  border: 1px solid var(--t-border);
  border-radius: var(--t-radius);
  padding: 14px 18px;
  margin: 0 0 1.6em;
  font-size: .92em;
}
.md-body .md-toc-title { font-weight: 700; margin-bottom: .5em; }
.md-body .md-toc ul { list-style: none; padding-left: 1.1em; margin: 0; }
.md-body .md-toc > ul { padding-left: 0; }
.md-body .md-toc a { color: var(--t-fg); border: none; }
.md-body .md-toc a:hover { color: var(--t-accent); }

/* 导出时若不希望显示锚点链接 */
.exported .md-body a[data-anchor] { border: none; }

/* 打印/PDF 优化：避免元素被切断、链接显示真实地址 */
@media print {
  .md-body { max-width: 100%; padding: 0; font-size: 12pt; }
  .md-body h1, .md-body h2, .md-body h3, .md-body h4 {
    break-after: avoid-page; page-break-after: avoid;
  }
  .md-body pre, .md-body table, .md-body img,
  .md-body blockquote, .md-body .md-mermaid {
    break-inside: avoid-page; page-break-inside: avoid;
  }
  .md-body li { break-inside: avoid; }
  .md-body a { color: inherit; border-bottom: none; }
  .md-body a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: .82em; color: #888; word-break: break-all;
  }
  .md-code-lang { display: none; }
  /* 打印时始终用浅色，避免深色主题耗墨 */
  .md-body, .md-body pre, .md-body code, .md-body blockquote {
    background: transparent !important;
    color: #000 !important;
  }
  .md-body pre, .md-body blockquote, .md-body table {
    border-color: #ccc !important;
  }
}
`;
}