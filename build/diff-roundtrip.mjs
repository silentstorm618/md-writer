/** 定位完整示例文档的往返差异行 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document; global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser; global.Element = dom.window.Element;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.katex = { renderToString: (e) => `<span>${e}</span>` };
const { createWYSIWYG } = await import('../web/src/ui/editor.js');

const SAMPLE = `# MD Writer 使用指南

欢迎使用 **MD Writer** —— 一个原生的 macOS Markdown 编辑器。

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
# 这是注释
function hello() { return 1; }
\`\`\`

### 流程图

\`\`\`mermaid
graph TD
  A[写] --> B[导出]
\`\`\`

## 引用与强调

准备好就开始写。`;

const h = document.createElement('div');
document.body.appendChild(h);
const ed = createWYSIWYG(h, {});
ed.setMarkdown(SAMPLE);
const p1 = ed.getMarkdown();
ed.setMarkdown(p1);
const p2 = ed.getMarkdown();

const a = p1.split('\n'), b = p2.split('\n');
let diff = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    diff++;
    console.log(`行 ${i}:`);
    console.log(`  p1: ${JSON.stringify(a[i])}`);
    console.log(`  p2: ${JSON.stringify(b[i])}`);
  }
}
console.log(diff === 0 ? '\n✅ 完全一致' : `\n共 ${diff} 行不同`);
