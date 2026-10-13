/**
 * 端到端复验：覆盖截图里的全部问题。
 */
import { JSDOM } from 'jsdom';

const html = await import('node:fs').then((fs) =>
  fs.promises.readFile(new URL('../web/index.html', import.meta.url), 'utf8')
);

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.katex = { renderToString: (e) => `<span class="k">${e}</span>` };
global.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {} }));

const { createWYSIWYG } = await import('../web/src/ui/editor.js');
const { buildTOC } = await import('../web/src/export/index.js');
const { renderMarkdown } = await import('../web/src/core/renderer.js');

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 100) : ''}`); }
};

const SAMPLE = `# MD Writer 使用指南

欢迎使用 **MD Writer** —— 一个原生的 macOS Markdown 编辑器，支持像 Word 一样直接排版。

> 左边写，右边看。所有格式一键导出：HTML、PDF、Word、PNG。

## 三个编辑模式

| 快捷键 | 模式 | 说明 |
| --- | --- | --- |
| \`⌘1\` | 所见即所得 | 像 Word 一样排版 |
| \`⌘2\` | Markdown 源码 | 带语法高亮 |

## 常用快捷键

- **\`⌘B\`** — 粗体
- **\`⌘I\`** — 斜体

### 列表与待办

- [x] 支持所见即所得编辑
- [ ] 待办

### 代码高亮

\`\`\`javascript
# 这是注释，不该进目录
function hello() { return 1; }
\`\`\`

### 流程图

\`\`\`mermaid
graph TD
  A[写] --> B[导出]
\`\`\`

## 引用与强调

准备好就开始写。`;

console.log('\n【1】目录不再重复');
{
  const toc = buildTOC(SAMPLE);
  const d = document.createElement('div');
  d.innerHTML = toc;
  const links = Array.from(d.querySelectorAll('a')).map((a) => a.textContent);
  // 文档实际标题：H1×1 + H2×3 + H3×3 = 7（第 57 行那个 # 在代码块里，应被排除）
ck('标题数 == 7', links.length === 7, `实际 ${links.length}: ${links.join(',')}`);
  ck('无重复项', new Set(links).size === links.length);
  ck('代码块注释未混入', !links.some((t) => t.includes('注释')));
}

console.log('\n【2】编辑器无多重转义');
{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ed = createWYSIWYG(host, {});
  ed.setMarkdown(SAMPLE);
  const h = host.innerHTML;
  ck('无 &amp;amp;', !h.includes('&amp;amp;'));
  ck('无 &lt;p&gt; 等标签实体', !h.includes('&lt;p&gt;') && !h.includes('&lt;strong&gt;'));
  ck('正文不含实体残留', !host.textContent.includes('&amp;') && !host.textContent.includes('&lt;'));
  ck('&amp; 计数为 0', (h.match(/&amp;/g) || []).length === 0);
}

console.log('\n【3】表格结构正确');
{
  const host = document.querySelectorAll('.wysiwyg, div');
  const h = document.createElement('div');
  document.body.appendChild(h);
  const ed = createWYSIWYG(h, {});
  ed.setMarkdown(SAMPLE);
  const t = h.querySelector('table');
  ck('存在 table', !!t);
  ck('行数 == 3（表头+2数据）', t.querySelectorAll('tr').length === 3, `实际 ${t.querySelectorAll('tr').length}`);
  ck('列数 == 3', t.querySelectorAll('th').length === 3);
  ck('单元格无实体残留', !t.textContent.includes('&amp;'));
  ck('单元格文本正确', t.querySelector('td')?.textContent.includes('⌘1'));
}

console.log('\n【4】setMarkdown 不再触发 onChange（打破自激回路）');
{
  let fired = 0;
  const h = document.createElement('div');
  document.body.appendChild(h);
  const ed = createWYSIWYG(h, { onChange: () => { fired++; } });
  ed.setMarkdown(SAMPLE);
  ck('程序化载入不触发 onChange', fired === 0, `实际触发 ${fired} 次`);
}

console.log('\n【5】多次渲染内容稳定（幂等）');
{
  const h = document.createElement('div');
  document.body.appendChild(h);
  const ed = createWYSIWYG(h, {});
  ed.setMarkdown(SAMPLE);
  const p1 = ed.getMarkdown();
  ed.setMarkdown(p1);
  const p2 = ed.getMarkdown();
  ed.setMarkdown(p2);
  const p3 = ed.getMarkdown();
  ck('三次渲染结果一致', p1 === p2 && p2 === p3);
  ck('内容不含实体', !p1.includes('&amp;amp;') && !p1.includes('&amp;'));
  ck('表格语法保持', p1.includes('| --- |'));
}

console.log('\n【6】预览渲染干净');
{
  const out = renderMarkdown(SAMPLE);
  ck('无多重转义', !out.includes('&amp;amp;'));
  ck('表格已渲染', out.includes('<table'));
  // 只检查代码块之外的部分——代码块里保留原始 # 注释是正确的
  const outsideCode = out.replace(/<pre[\s\S]*?<\/pre>/g, '');
  ck('正文无未渲染的 markdown 标题', !/>\s*#{1,6}\s/.test(outsideCode),
    (outsideCode.match(/>\s*#{1,6}\s.{0,40}/) || [''])[0]);
  ck('无 script 注入', !out.includes('<script'));
}

console.log(`\n${'='.repeat(46)}`);
console.log(`${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);