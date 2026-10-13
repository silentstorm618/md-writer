/**
 * 集成测试：在 jsdom 里加载真实 index.html + 打包产物，
 * 验证 App 能启动、面板互斥正确、目录不重复。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RES = new URL('../native/MDWriter.app/Contents/Resources/web/', import.meta.url);
const indexHTML = await readFile(new URL('index.html', RES), 'utf8');

const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => consoleErrors.push(String(e.message).slice(0, 160)));
vc.on('error', (...a) => consoleErrors.push(a.join(' ').slice(0, 160)));

const dom = new JSDOM(indexHTML, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.DOMParser = dom.window.DOMParser;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));

// jsdom 没有真实布局引擎，CodeMirror 的光标测量会缺 getClientRects。
// 真实 WebKit 不受影响；这里补一个空实现，让测试环境能跑完整流程。
if (typeof dom.window.Range !== 'undefined') {
  dom.window.Range.prototype.getClientRects = function () { return []; };
  dom.window.Range.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  };
}

// 手动执行 bundle（避开 jsdom 对 file:// 脚本的限制）
const bundle = await readFile(new URL('app.js', RES), 'utf8');
dom.window.eval(bundle);

await new Promise((r) => setTimeout(r, 1200));

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 110) : ''}`); }
};

console.log('\n【集成】App 启动');
const doc = dom.window.document;
ck('工具栏已渲染', !!doc.getElementById('toolbar'));
ck('侧边栏存在', !!doc.getElementById('sidebar'));
ck('所见即所得宿主已挂载', !!doc.getElementById('wysiwyg-host'));
ck('编辑器已填充内容', (doc.getElementById('wysiwyg-host')?.innerHTML || '').length > 200,
  `长度 ${(doc.getElementById('wysiwyg-host')?.innerHTML || '').length}`);
ck('标题已渲染', !!doc.querySelector('.wysiwyg h1'),
  doc.querySelector('.wysiwyg h1')?.textContent?.slice(0, 20));

console.log('\n【集成】无启动报错');
ck('无 JS 运行时错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

console.log('\n【集成】面板互斥（每种模式只显示需要的面板）');
const panes = Array.from(doc.querySelectorAll('.mode-pane'));
const modeBtns = Array.from(doc.querySelectorAll('[data-mode-btn]'));

for (const btn of modeBtns) {
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const mode = doc.body.dataset.mode;
  const visible = panes.filter((p) => !p.hidden)
    .map((p) => Array.from(p.classList).find((c) => c.startsWith('pane-') && c !== 'pane-divider'));
  const expect = {
    wysiwyg: ['pane-wysiwyg'],
    source: ['pane-source'],
    split: ['pane-source', 'pane-preview'],
  }[mode];

  const ok = visible.length === expect.length && expect.every((e) => visible.includes(e));
  ck(`${mode} 模式面板正确`, ok, `期望 [${expect}] 实际 [${visible}]`);
}

console.log('\n【集成】侧边栏目录不重复');
// 回到所见即所得模式
modeBtns.find((b) => b.dataset.modeBtn === 'wysiwyg')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

const sideLinks = Array.from(doc.querySelectorAll('#sidebar-body a')).map((a) => a.textContent);
ck('侧边栏目录有内容', sideLinks.length > 0, `实际 ${sideLinks.length} 项`);
ck('侧边栏目录无重复', new Set(sideLinks).size === sideLinks.length,
  sideLinks.join(','));
ck('侧边栏目录项数合理(<=10)', sideLinks.length <= 10, `实际 ${sideLinks.length}`);

console.log('\n【集成】切换模式 10 次后内容仍稳定');
for (let i = 0; i < 10; i++) {
  const b = modeBtns[i % 3];
  b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
}
const wHost = doc.getElementById('wysiwyg-host');
const text = wHost.textContent || '';
ck('内容未被 &amp; 污染', !text.includes('&amp;') && !text.includes('&amp;amp;'));
ck('内容未被标签实体污染', !text.includes('&lt;p&gt;'));
ck('标题仍在', (text.match(/MD Writer/g) || []).length >= 1);

console.log(`\n${'='.repeat(46)}`);
console.log(`集成测试：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);