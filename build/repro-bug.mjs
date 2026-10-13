/**
 * 复现截图中的三个问题：
 *   1. &amp;amp;amp;  多重转义
 *   2. 表格塌陷成一行
 *   3. 侧边栏目录重复
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Element = dom.window.Element;
global.katex = { renderToString: (e) => `<span class="katex-stub">${e}</span>` };

const { createWYSIWYG } = await import('../web/src/ui/editor.js');

const SAMPLE = `# MD Writer 使用指南

欢迎使用 **MD Writer** —— 一个原生的 macOS Markdown 编辑器，支持像 Word 一样直接排版，也能随时切到源码。

> 左边写，右边看。所有格式一键导出：HTML、PDF、Word、PNG。

## 三个编辑模式

| 快捷键 | 模式 | 说明 |
| --- | --- | --- |
| \`⌘1\` | 所见即所得 | 像 Word 一样排版 |
| \`⌘2\` | Markdown 源码 | 带语法高亮 |
`;

/* ---- 问题 1：转义层级 ---- */
console.log('========== 问题 1：转义 ==========');
const host1 = document.createElement('div');
document.body.appendChild(host1);
const ed1 = createWYSIWYG(host1, {});
ed1.setMarkdown(SAMPLE);

const html = host1.innerHTML;
console.log('编辑器 innerHTML 片段：');
console.log('  ', html.slice(0, 260));
console.log();

const ampCount = (html.match(/&amp;/g) || []).length;
const ltCount = (html.match(/&lt;/g) || []).length;
console.log(`  &amp; 出现次数: ${ampCount}`);
console.log(`  &lt; 出现次数: ${ltCount}`);
if (ampCount > 0 || ltCount > 0) {
  console.log('  ❌ 存在 HTML 实体泄漏到可见文本');
} else {
  console.log('  ✅ 无实体泄漏');
}

// 检查 &amp;amp;amp; 这种多重转义
if (html.includes('&amp;amp;')) {
  console.log('  ❌ 检测到多重转义 &amp;amp;');
}
if (html.includes('&lt;p&gt;') || html.includes('&lt;strong&gt;')) {
  console.log('  ❌ 检测到标签被转义成可见文本');
}

/* ---- 问题 2：表格 ---- */
console.log('\n========== 问题 2：表格 ==========');
const table = host1.querySelector('table');
if (table) {
  const rows = table.querySelectorAll('tr');
  const cells = table.querySelectorAll('td,th');
  console.log(`  表格存在，tr=${rows.length}, cell=${cells.length}`);
  const firstCell = table.querySelector('td');
  if (firstCell) console.log(`  首个单元格内容: "${firstCell.textContent.trim()}"`);
  const allText = table.textContent;
  if (allText.includes('&lt;') || allText.includes('&amp;')) {
    console.log('  ❌ 表格内容含转义实体');
  }
  if (rows.length >= 3) console.log('  ✅ 表格行数正常');
  else console.log(`  ❌ 表格行数异常（${rows.length}）`);
} else {
  console.log('  ❌ 未渲染出 table 元素');
}

/* ---- 问题 3：往返稳定性（模拟多次 setMarkdown） ---- */
console.log('\n========== 问题 3：往返稳定性 ==========');
const host3 = document.createElement('div');
document.body.appendChild(host3);
const ed3 = createWYSIWYG(host3, {});
ed3.setMarkdown(SAMPLE);
const pass1 = ed3.getMarkdown();

const host3b = document.createElement('div');
document.body.appendChild(host3b);
const ed3b = createWYSIWYG(host3b, {});
ed3b.setMarkdown(pass1);
const pass2 = ed3b.getMarkdown();

const host3c = document.createElement('div');
document.body.appendChild(host3c);
const ed3c = createWYSIWYG(host3c, {});
ed3c.setMarkdown(pass2);
const pass3 = ed3c.getMarkdown();

console.log('  第1次往返:', JSON.stringify(pass1.slice(0, 110)));
console.log('  第2次往返:', JSON.stringify(pass2.slice(0, 110)));
console.log('  第3次往返:', JSON.stringify(pass3.slice(0, 110)));
console.log();

if (pass1 === pass2 && pass2 === pass3) {
  console.log('  ✅ 往返稳定（幂等）');
} else {
  console.log('  ❌ 往返不稳定 —— 每次渲染都在改变内容！');
  if (pass1.includes('&lt;')) console.log('     → 第1次就出现实体，根因在渲染阶段');
  if (pass2.includes('&lt;') && !pass1.includes('&lt;')) console.log('     → 第1次干净第2次脏，根因在序列化阶段');
}
