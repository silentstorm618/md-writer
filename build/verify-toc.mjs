/**
 * 用截图里的真实示例文档验证 buildTOC 修复。
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.katex = { renderToString: (e) => `<span>${e}</span>` };

const { buildTOC } = await import('../web/src/export/index.js');

// 从 main.js 提取的真实示例文档结构
const SAMPLE = `# MD Writer 使用指南

欢迎使用 **MD Writer** —— 一个原生的 macOS Markdown 编辑器。

## 三个编辑模式

| 快捷键 | 模式 | 说明 |
| --- | --- | --- |
| \`⌘1\` | 所见即所得 | 像 Word 一样排版 |

## 常用快捷键

- **\`⌘B\`** — 粗体
- [x] 支持所见即所得编辑

### 列表与待办

- [ ] 待办

### 代码高亮

\`\`\`javascript
# 井号注释不应进入目录
function foo() {}
\`\`\`

### 流程图

\`\`\`mermaid
graph TD
  A[写] --> B[导出]
\`\`\`

### 数学公式

行内公式：$E = mc^2$

## 引用与强调

> 引用内容

准备好就开始写。`;

const toc = buildTOC(SAMPLE);
const holder = document.createElement('div');
holder.innerHTML = toc;
document.body.appendChild(holder);

const links = Array.from(holder.querySelectorAll('a'));

console.log('=== 生成的目录 ===');
console.log(toc.replace(/></g, '>\n<'));
console.log('\n=== 统计 ===');
console.log(`链接总数: ${links.length}`);

const texts = links.map((a) => a.textContent);
console.log('条目:', texts.join(' | '));

/* 断言 */
let pass = 0, fail = 0;
const ck = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\n=== 校验 ===');
// 文档里 depth<=3 的标题共 8 个：
// H1 使用指南 / H2 三个编辑模式 / H2 常用快捷键 / H3 列表与待办 / H3 代码高亮 / H3 流程图 / H3 数学公式 / H2 引用与强调
ck('链接数 == 8（无重复）', links.length === 8, `实际 ${links.length}`);
ck('不含代码块里的 # 注释', !texts.some((t) => t.includes('井号')));
ck('每个标题只出现一次', new Set(texts).size === texts.length);

for (const expected of ['MD Writer 使用指南', '三个编辑模式', '常用快捷键', '列表与待办',
  '代码高亮', '流程图', '数学公式', '引用与强调']) {
  ck(`包含「${expected}」`, texts.includes(expected));
}

// 层级正确性
const h3Items = links.filter((a) => a.className === 'lv3');
ck('lv3 层级有 4 项', h3Items.length === 4, `实际 ${h3Items.length}`);
const lv1 = links.filter((a) => a.className === 'lv1');
ck('lv1 层级有 1 项', lv1.length === 1, `实际 ${lv1.length}`);

// 子列表嵌套结构：H3 应嵌在对应的 H2 下
const uls = holder.querySelectorAll('ul');
// 正确的结构：1 个根 ul + 2 个含 H3 子项的 ul = 3
ck('存在嵌套子列表', uls.length === 3, `实际 ${uls.length} 个 ul`);

console.log(`\n${'='.repeat(44)}`);
console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);