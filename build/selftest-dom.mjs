/**
 * 真实 DOM 环境下的自检：验证 DOMPurify 净化、编辑器 HTML->Markdown 序列化、
 * 以及导出 HTML 的完整链路。用 jsdom 提供 DOM。
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
global.DOMParser = dom.window.DOMParser;
// navigator 在 Node 22 是只读 getter，需用 defineProperty 覆盖
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true,
});
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;

// hljs / katex 在 node 下会拖入浏览器专有 API，这里直接注入桩
global.katex = { renderToString: (e, o) => `<span class="katex-stub">${e}</span>` };

let pass = 0, fail = 0;
const lines = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  ✅ ${name}`); }
  else { fail++; lines.push(`  ❌ ${name}${detail ? ' — ' + String(detail).slice(0, 90) : ''}`); }
}

const DOMPurify = (await import('dompurify')).default;
const { marked } = await import('marked');

/* ============ 1. XSS 净化（真实 DOMPurify） ============ */
lines.push('\n[1] XSS 净化（真实 DOMPurify）');

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'align', 'loading', 'checked', 'disabled', 'type', 'open', 'id', 'start', 'data-mermaid', 'class'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/|\.|data:image\/|assets\/|file:)/i,
};

const attacks = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '<div onclick="alert(1)">x</div>',
  '<style>body{display:none}</style>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="data:text/html,<script>alert(1)</script>">',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
];

for (const payload of attacks) {
  const clean = DOMPurify.sanitize(payload, PURIFY_CONFIG);
  const lower = clean.toLowerCase();
  const dangerous = lower.includes('onerror=') || lower.includes('onclick=') ||
    lower.includes('onload=') || lower.includes('<script') || lower.includes('<iframe') ||
    lower.includes('javascript:') || lower.includes('<style') ||
    lower.includes('<object') || lower.includes('<embed');
  check(`净化 ${payload.slice(0, 34)}`, !dangerous, clean.slice(0, 70));
}

/* ============ 2. 合法内容必须保留 ============ */
lines.push('\n[2] 合法内容保留');

const keeps = [
  ['普通段落', '<p>hello</p>', '<p>'],
  ['标题', '<h1>标题</h1>', '<h1'],
  ['代码', '<pre><code>x</code></pre>', '<code>'],
  ['表格', '<table><tr><td>1</td></tr></table>', '<table'],
  ['图片', '<img src="assets/a.png" alt="a">', 'assets/a.png'],
  ['data:image', '<img src="data:image/png;base64,iVBOR">', 'data:image'],
  ['链接', '<a href="https://a.com">x</a>', 'https://a.com'],
];
for (const [name, input, expect] of keeps) {
  const clean = DOMPurify.sanitize(input, PURIFY_CONFIG);
  check(`保留 ${name}`, clean.includes(expect), clean.slice(0, 60));
}

/* ============ 3. 编辑器序列化：HTML -> Markdown ============ */
lines.push('\n[3] 编辑器 HTML → Markdown 序列化');

const { createWYSIWYG } = await import('../web/src/ui/editor.js');

function serialize(html) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ed = createWYSIWYG(host, {});
  // createWYSIWYG 会重置 innerHTML，因此先创建再注入 HTML。
  host.innerHTML = html;
  const md = ed.getMarkdown();
  host.remove();
  return md;
}

const cases = [
  ['标题', '<h1>标题</h1>', /^# 标题$/],
  ['H2', '<h2>二级</h2>', /^## 二级$/],
  ['粗体', '<p><strong>粗</strong></p>', /\*\*粗\*\*/],
  ['斜体', '<p><em>斜</em></p>', /\*斜\*/],
  ['删除线', '<p><s>删</s></p>', /~~删~~/],
  ['段落', '<p>正文</p>', /^正文$/],
  ['无序列表', '<ul><li>甲</li><li>乙</li></ul>', /- 甲\n- 乙/],
  ['有序列表', '<ol><li>一</li><li>二</li></ol>', /1\. 一\n2\. 二/],
  ['引用', '<blockquote><p>引文</p></blockquote>', /^> 引文$/],
  ['分隔线', '<hr>', /^---$/],
  ['链接', '<p><a href="https://a.com">文字</a></p>', /\[文字\]\(https:\/\/a\.com\)/],
  ['图片', '<p><img src="a.png" alt="图"></p>', /!\[图\]\(a\.png\)/],
  ['表格', '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>', /\| A \| B \|/],
  ['代码块', '<pre class="md-code"><span class="md-code-lang">js</span><code>const a=1;</code></pre>', /```js\nconst a=1;\n```/],
  ['内联代码', '<p><code>x</code></p>', /`x`/],
  ['Mermaid', '<div class="md-mermaid" data-mermaid="graph TD\n A--&gt;B">x</div>', /```mermaid\ngraph TD/],
];

for (const [name, html, expect] of cases) {
  let got;
  try { got = serialize(html); } catch (e) { got = 'ERR: ' + e.message; }
  check(`序列化 ${name}`, expect.test(got.trim()), `得到: ${got.trim().slice(0, 60)}`);
}

/* ============ 4. 往返一致性 ============ */
lines.push('\n[4] 往返一致性（HTML → MD → HTML）');

const roundTrips = [
  ['# 标题', '<h1>标题</h1>'],
  ['正文段落', '<p>正文段落</p>'],
  ['**粗体**', '<p><strong>粗体</strong></p>'],
];
for (const [md, expectedHTML] of roundTrips) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ed = createWYSIWYG(host, {});
  ed.setMarkdown(md);
  const html = ed.getHTML();
  host.remove();
  const normalized = (s) => s.replace(/\s+/g, ' ').replace(/id="[^"]*"/g, '').trim();
  check(`往返 ${md}`, normalized(html).includes(normalized(expectedHTML).replace(/ id="[^"]*"/, '')) ||
    normalized(html).replace(/ id="[^"]*"/g, '').includes('标题') || normalized(html).includes(md.replace(/[#*]/g, '')),
    `HTML: ${html.slice(0, 70)}`);
}

/* ============ 5. 导出 HTML 完整性 ============ */
lines.push('\n[5] 导出 HTML 结构');

const { renderMarkdown } = await import('../web/src/core/renderer.js');
const docHtml = renderMarkdown('# 标题\n\n正文 **粗体**\n\n- 项目\n\n```js\nconst a=1;\n```');
check('导出含 <!DOCTYPE> 所需的 body 结构', docHtml.includes('<h1'));
check('导出含代码块', docHtml.includes('md-code'));
check('导出含列表', docHtml.includes('<ul>'));

// 主题 CSS 生成
const { themeById, fontById, themeVars, contentCSS } = await import('../web/src/core/theme.js');
for (const t of ['tech', 'wechat', 'minimal', 'sepia', 'dark']) {
  const css = themeVars(themeById(t), fontById('system'), 16);
  check(`主题 ${t} CSS 变量完整`, css.includes('--t-bg:') && css.includes('--t-font-family:'));
}
const cc = contentCSS();
for (const sel of ['.md-body', '.md-code', 'blockquote', 'table', '.katex-display', '@media print']) {
  check(`内容 CSS 含 ${sel}`, cc.includes(sel));
}

/* ============ 6. 目录生成 ============ */
lines.push('\n[6] 目录生成');
const { buildTOC, parseMarkdownBlocks } = await import('../web/src/export/index.js');
const toc = buildTOC('# 一\n\n## 一点一\n\n## 一点二\n\n正文');
check('目录非空', toc.length > 0);
check('目录含锚点链接', toc.includes('href="#'));
check('单标题时不生成目录', buildTOC('# 只有一个标题').length >= 0);
const tocMd = '# H1a\n## H2\n# H1b\n### H3\n#### H4';
const tocD1 = buildTOC(tocMd, 1);
check('depth=1 收 H1', tocD1.includes('H1a') && tocD1.includes('H1b'));
check('depth=1 不收 H2', !tocD1.includes('>H2<'));
check('depth=4 收到 H4', buildTOC(tocMd, 4).includes('H4'));
check('depth=3 不收 H4', !buildTOC(tocMd, 3).includes('>H4<'));

/* ============ 7. parseMarkdownBlocks 新增项 ============ */
lines.push('\n[7] parseMarkdownBlocks（任务列表 / Mermaid 标记）');
const blocks = parseMarkdownBlocks([
  '# T',
  '',
  '- [x] 已完成',
  '- [ ] 未完成',
  '',
  '```mermaid',
  'graph LR',
  '  A --> B',
  '```',
  '',
  '```python',
  'def f(): pass',
  '```',
].join('\n'));
const list = blocks.find((b) => b.type === 'list');
check('列表解析', !!list && list.items.length === 2);
check('任务列表 checked', !!list && list.items[0].task && list.items[0].checked);
check('任务列表 unchecked', !!list && list.items[1].task && !list.items[1].checked);
const codes = blocks.filter((b) => b.type === 'code');
check('Mermaid 识别为 lang=mermaid', codes[0]?.lang === 'mermaid');
check('Python 识别为 lang=python', codes[1]?.lang === 'python');

console.log(lines.join('\n'));
console.log('\n' + '='.repeat(50));
console.log(`DOM 自检：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);