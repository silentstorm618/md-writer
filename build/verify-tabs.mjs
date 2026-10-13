/**
 * 多 Tab 集成测试。
 * 在 jsdom 里加载真实 index.html + 打包产物，模拟真实的 Tab 操作。
 * 重点验证：各 Tab 内容隔离、脏标记独立、关闭行为正确。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';

const RES = new URL('../native/MDWriter.app/Contents/Resources/web/', import.meta.url);
const indexHTML = await readFile(new URL('index.html', RES), 'utf8');

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', (e) => errs.push(String(e.message).slice(0, 150)));

const dom = new JSDOM(indexHTML, {
  url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
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
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
if (dom.window.Range) {
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 });
}

const bundle = await readFile(new URL('app.js', RES), 'utf8');
dom.window.eval(bundle);
await new Promise((r) => setTimeout(r, 1200));

const doc = dom.window.document;
const W = dom.window;
const wait = (ms = 260) => new Promise((r) => setTimeout(r, ms));
const fire = (name, payload = {}) => dom.window.eval(`window.MDWriter.on('${name}', ${JSON.stringify(payload)})`);

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 110) : ''}`); }
};

const tabCount = () => doc.querySelectorAll('#tab-bar .tab').length;
const activeName = () => doc.querySelector('#tab-bar .tab.active .tab-name')?.textContent || '';
const activeEditorText = () => {
  const panes = Array.from(doc.querySelectorAll('#wysiwyg-host .tab-editor')).filter((e) => !e.hidden);
  return panes[0]?.textContent || '';
};

console.log('【1】启动状态');
ck('启动即有 Tab 栏', !!doc.getElementById('tab-bar'));
ck('初始恰好 1 个 Tab', tabCount() === 1, `实际 ${tabCount()}`);
ck('首个 Tab 是使用说明', activeName().includes('使用说明'), activeName());
ck('启动无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\n【2】新建文档 -> 各自独立 Tab');
fire('menuAction', { name: 'new' }); await wait();
ck('新建后有 2 个 Tab', tabCount() === 2, `实际 ${tabCount()}`);
ck('新 Tab 成为激活态', activeName() === '未命名', activeName());

fire('menuAction', { name: 'new' }); await wait(400);
ck('再建后有 3 个 Tab', tabCount() === 3, `实际 ${tabCount()}`);

console.log('\n【3】打开文件 -> 新开 Tab');
fire('documentOpened', { path: '/tmp/a.md', name: 'A.md', content: '# A 文档\n\nAAA' }); await wait();
ck('打开文件后有 4 个 Tab', tabCount() === 4, `实际 ${tabCount()}`);
ck('激活的是新打开的文件', activeName() === 'A.md', activeName());
ck('内容已载入', activeEditorText().includes('AAA'), activeEditorText().slice(0, 40));

console.log('\n【4】重复打开同一文件 -> 切回已有 Tab 而非重复');
const before = tabCount();
fire('documentOpened', { path: '/tmp/a.md', name: 'A.md', content: '# A 文档\n\nAAA' }); await wait();
ck('未新增 Tab', tabCount() === before, `实际 ${tabCount()}`);

console.log('\n【5】内容隔离：各 Tab 互不串台');
const clickTabByName = async (name) => {
  const el = Array.from(doc.querySelectorAll('#tab-bar .tab'))
    .find((t) => t.querySelector('.tab-name')?.textContent === name);
  if (!el) return false;
  el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  await wait();
  return true;
};

ck('切到使用说明 Tab', await clickTabByName('使用说明.md'));
ck('使用说明内容正确', activeEditorText().includes('MD Writer'), activeEditorText().slice(0, 40));

ck('切到 A.md Tab', await clickTabByName('A.md'));
ck('A.md 内容完好', activeEditorText().includes('AAA'), activeEditorText().slice(0, 40));
ck('A.md 不含使用说明内容', !activeEditorText().includes('MD Writer 使用指南'), activeEditorText().slice(0, 60));

// 再切回使用说明，确认切来切去内容稳定
await clickTabByName('使用说明.md');
ck('往返切换后内容仍正确', activeEditorText().includes('MD Writer'), activeEditorText().slice(0, 40));

console.log('\n【6】同时只有一个 Tab 的编辑器可见');
const visible = Array.from(doc.querySelectorAll('#wysiwyg-host .tab-editor')).filter((e) => !e.hidden);
ck('wysiwyg 仅 1 个可见', visible.length === 1, `实际 ${visible.length}`);
const visSrc = Array.from(doc.querySelectorAll('#source-host .tab-editor')).filter((e) => !e.hidden);
ck('source 仅 1 个可见', visSrc.length === 1, `实际 ${visSrc.length}`);

console.log('\n【7】关闭 Tab');
const beforeClose = tabCount();
doc.querySelector('#tab-bar .tab.active .tab-close')
  .dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
await wait();
ck('关闭后减少 1 个', tabCount() === beforeClose - 1, `${beforeClose} → ${tabCount()}`);
ck('关闭后仍有激活 Tab', !!doc.querySelector('#tab-bar .tab.active'));
ck('被关闭的 Tab 已从 DOM 移除',
  doc.querySelectorAll('#wysiwyg-host .tab-editor').length === tabCount(),
  `DOM ${doc.querySelectorAll('#wysiwyg-host .tab-editor').length} vs Tab ${tabCount()}`);

console.log('\n【8】逐个关闭直到只剩一个，再关最后一个');
for (let i = 0; i < 20; i++) {
  const btn = doc.querySelector('#tab-bar .tab.active .tab-close');
  if (!btn) break;
  btn.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  await wait(120);
}
ck('关完仍至少有 1 个 Tab', tabCount() >= 1, `实际 ${tabCount()}`);
ck('界面未陷入空白', !!doc.querySelector('#tab-bar .tab.active'));
ck('编辑器仍挂载', doc.querySelectorAll('#wysiwyg-host .tab-editor').length >= 1);

console.log('\n【9】Tab 切换');
fire('menuAction', { name: 'new' }); await wait();
fire('menuAction', { name: 'new' }); await wait(300);
const n = tabCount();
ck('至少 3 个 Tab 可切换', n >= 3, `实际 ${n}`);

const names = () => Array.from(doc.querySelectorAll('#tab-bar .tab-name')).map((e) => e.textContent);
fire('switchTab', { index: 1 }); await wait();
ck('跳转到第 1 个 Tab', activeName() === names()[0], `${activeName()} vs ${names()[0]}`);

const activeId = () => doc.querySelector('#tab-bar .tab.active')?.dataset.tab;
const ids = () => Array.from(doc.querySelectorAll('#tab-bar .tab')).map((t) => t.dataset.tab);
const tabBeforeId = activeId();
const idxBefore = ids().indexOf(tabBeforeId);
fire('switchTab', { delta: 1 }); await wait();
ck('下一个 Tab 生效', activeId() !== tabBeforeId, `切换前后都是 ${activeId()}`);
ck('下一个确为相邻 Tab', ids().indexOf(activeId()) === (idxBefore + 1) % n,
  `${idxBefore} → ${ids().indexOf(activeId())}，共 ${n} 个`);

fire('switchTab', { delta: -1 }); await wait();
ck('上一个 Tab 可回退', activeId() === tabBeforeId, `${activeId()} vs ${tabBeforeId}`);

console.log('\n【10】关闭其他 Tab');
fire('switchTab', { index: 1 }); await wait();
fire('menuAction', { name: 'closeOtherTabs' }); await wait(300);
ck('只剩 1 个 Tab', tabCount() === 1, `实际 ${tabCount()}`);

console.log('\n【11】脏标记独立');
fire('menuAction', { name: 'new' }); await wait();
fire('documentOpened', { path: '/tmp/b.md', name: 'B.md', content: '# B' }); await wait();
const dirtyBefore = doc.querySelectorAll('#tab-bar .tab.dirty').length;
ck('初始无未保存标记', dirtyBefore === 0, `实际 ${dirtyBefore}`);

// 在 B.md 里输入 -> 应只有 B 变 dirty
const bPane = Array.from(doc.querySelectorAll('#wysiwyg-host .tab-editor')).find((e) => !e.hidden);
const target = bPane.querySelector('p, h1, div') || bPane;
target.textContent = '改过的内容';
bPane.dispatchEvent(new W.Event('input', { bubbles: true }));
await wait(400);
ck('编辑后标记未保存', doc.querySelectorAll('#tab-bar .tab.dirty').length >= 1,
  `实际 ${doc.querySelectorAll('#tab-bar .tab.dirty').length}`);

// 切到别的 Tab，确认未保存标记还挂在原来那个 Tab 上
const dirtyTabName = doc.querySelector('#tab-bar .tab.dirty .tab-name')?.textContent;
fire('switchTab', { delta: 1 }); await wait();
const stillDirty = doc.querySelectorAll('#tab-bar .tab.dirty').length;
ck('切走后未保存标记仍在', stillDirty >= 1, `实际 ${stillDirty}`);
ck('未保存标记属于正确的 Tab', dirtyTabName === 'B.md', String(dirtyTabName));

console.log('\n【12】导出针对当前 Tab');
ck('有导出按钮可用', !!doc.querySelector('[data-cmd="export"][data-value="html"]'));

console.log('\n【13】草稿恢复结构');
const saved = W.localStorage.getItem('mdwriter-tabs');
ck('已写入多 Tab 草稿', !!saved, '无 localStorage');
if (saved) {
  const parsed = JSON.parse(saved);
  ck('草稿含 tabs 数组', Array.isArray(parsed.tabs), typeof parsed.tabs);
  ck('草稿记录每个 Tab 的 name/path/dirty',
    parsed.tabs.every((t) => 'name' in t && 'path' in t && 'dirty' in t));
}

console.log('\n【14】全程无 JS 错误');
ck('无运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(50)}`);
console.log(`多Tab 测试：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);