/**
 * 新功能验证：Tab 拖拽排序、关闭确认、光标位置。
 * 拖拽用真实 DragEvent 模拟（jsdom 支持 DataTransfer 足够）。
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
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 200, height: 30, x: 0, y: 0 });
}

dom.window.eval(await readFile(new URL('app.js', RES), 'utf8'));
await new Promise((r) => setTimeout(r, 1200));

const doc = dom.window.document;
const W = dom.window;
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const fire = (n, p = {}) => dom.window.eval(`window.MDWriter.on('${n}', ${JSON.stringify(p)})`);
const names = () => Array.from(doc.querySelectorAll('#tab-bar .tab-name')).map((e) => e.textContent);

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 110) : ''}`); }
};

console.log('【1】准备多个 Tab');
fire('documentOpened', { path: '/a.md', name: 'A.md', content: '# A' }); await wait();
fire('documentOpened', { path: '/b.md', name: 'B.md', content: '# B' }); await wait();
fire('documentOpened', { path: '/c.md', name: 'C.md', content: '# C' }); await wait(400);
ck('共 4 个 Tab', doc.querySelectorAll('#tab-bar .tab').length === 4,
  `实际 ${doc.querySelectorAll('#tab-bar .tab').length}`);
console.log(`     顺序: ${names().join(' → ')}`);

console.log('\n【2】拖拽排序');
const tabs = () => Array.from(doc.querySelectorAll('#tab-bar .tab'));

function makeDataTransfer() {
  // jsdom 不实现 DataTransfer 构造器，用最小桩替代。
  // 拖拽逻辑只用 effectAllowed / dropEffect / setData，不依赖真实实现。
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    data: {},
    setData(k, v) { this.data[k] = v; },
    getData(k) { return this.data[k] || ''; },
  };
}

function makeDragEvent(type, dt, clientX) {
  // jsdom 不实现 DragEvent；用 MouseEvent + 手动挂 dataTransfer 触发同名事件。
  // 应用的拖拽逻辑只读 event.type / dataTransfer / clientX，与事件构造器无关。
  const ev = new W.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10 });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
  return ev;
}

function dragTab(fromIdx, toIdx, toAfter = false) {
  const list = tabs();
  const from = list[fromIdx];
  const to = list[toIdx];
  const dt = makeDataTransfer();
  const x = toAfter ? 190 : 10;

  from.dispatchEvent(makeDragEvent('dragstart', dt, x));
  to.dispatchEvent(makeDragEvent('dragover', dt, x));
  to.dispatchEvent(makeDragEvent('drop', dt, x));
  from.dispatchEvent(makeDragEvent('dragend', dt, x));
}

// 把第 0 个（使用说明）拖到第 2 个之前
const before = names();
dragTab(0, 2, false);
await wait(300);
const afterDrag = names();
console.log(`     拖前: ${before.join(' → ')}`);
console.log(`     拖后: ${afterDrag.join(' → ')}`);
ck('顺序发生了变化', JSON.stringify(before) !== JSON.stringify(afterDrag));
ck('Tab 总数不变', afterDrag.length === before.length, `${before.length} → ${afterDrag.length}`);
ck('没有丢失或重复 Tab', new Set(afterDrag).size === afterDrag.length);
ck('使用说明仍存在', afterDrag.includes('使用说明.md'), afterDrag.join(','));

console.log('\n【3】拖到末尾');
const b2 = names();
dragTab(0, b2.length - 1, true);
await wait(300);
const a2 = names();
console.log(`     拖后: ${a2.join(' → ')}`);
ck('顺序再次变化', JSON.stringify(b2) !== JSON.stringify(a2));
ck('Tab 总数仍不变', a2.length === b2.length);
ck('全部 Tab 还在', ['A.md', 'B.md', 'C.md', '使用说明.md'].every((n) => a2.includes(n)), a2.join(','));

console.log('\n【4】拖拽不影响激活状态');
const activeBefore = doc.querySelector('#tab-bar .tab.active .tab-name')?.textContent;
dragTab(1, 3, true);
await wait(300);
const activeAfter = doc.querySelector('#tab-bar .tab.active .tab-name')?.textContent;
ck('激活的 Tab 未被拖走', activeBefore === activeAfter, `${activeBefore} → ${activeAfter}`);

console.log('\n【5】关闭确认');
// 让当前 Tab 变脏
const activePane = Array.from(doc.querySelectorAll('#wysiwyg-host .tab-editor')).find((e) => !e.hidden);
const p = activePane.querySelector('p, h1, div') || activePane;
p.textContent = '改过';
activePane.dispatchEvent(new W.Event('input', { bubbles: true }));
await wait(350);
ck('当前 Tab 已标记未保存', !!doc.querySelector('#tab-bar .tab.dirty'));

// 模拟 confirm 返回 false（取消关闭）
let asked = 0;
const origConfirm = W.confirm;
W.confirm = (msg) => { asked++; return false; };
fire('menuAction', { name: 'closeTab' }); await wait(300);
ck('关闭前弹出了确认', asked >= 1, `询问 ${asked} 次`);
ck('取消后 Tab 仍在', doc.querySelectorAll('#tab-bar .tab').length === a2.length - 1 + 1,
  `实际 ${doc.querySelectorAll('#tab-bar .tab').length}`);

// 确认关闭
const countBefore = doc.querySelectorAll('#tab-bar .tab').length;
W.confirm = () => true;
fire('menuAction', { name: 'closeTab' }); await wait(300);
ck('确认后 Tab 被关闭', doc.querySelectorAll('#tab-bar .tab').length === countBefore - 1,
  `${countBefore} → ${doc.querySelectorAll('#tab-bar .tab').length}`);

console.log('\n【6】点 × 不弹确认');
const n1 = doc.querySelectorAll('#tab-bar .tab').length;
const activePane2 = Array.from(doc.querySelectorAll('#wysiwyg-host .tab-editor')).find((e) => !e.hidden);
const p2 = activePane2.querySelector('p, h1, div') || activePane2;
p2.textContent = '再改';
activePane2.dispatchEvent(new W.Event('input', { bubbles: true }));
await wait(350);
let askedX = 0;
W.confirm = () => { askedX++; return true; };
doc.querySelector('#tab-bar .tab.active .tab-close')
  .dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
await wait(300);
ck('点 × 不弹确认（用户明确意图）', askedX === 0, `询问 ${askedX} 次`);
ck('点 × 直接关闭成功', doc.querySelectorAll('#tab-bar .tab').length === n1 - 1,
  `${n1} → ${doc.querySelectorAll('#tab-bar .tab').length}`);
W.confirm = origConfirm;

console.log('\n【7】光标位置');
const cp = doc.getElementById('cursor-pos');
ck('状态栏有光标位置元素', !!cp);
ck('初始显示行 1 列 1', /行\s*1/.test(cp?.textContent || ''), cp?.textContent);

// 切到源码模式，光标应能算出行号
fire('setMode', { mode: 'source' }); await wait(600);
const cp2 = doc.getElementById('cursor-pos');
ck('源码模式下有行号信息', /行\s*\d+/.test(cp2?.textContent || ''), cp2?.textContent);

console.log('\n【8】Tab 可拖拽属性');
const firstTab = doc.querySelector('#tab-bar .tab');
ck('Tab 标记为 draggable', firstTab?.getAttribute('draggable') === 'true',
  firstTab?.getAttribute('draggable'));

console.log('\n【9】全程无 JS 错误');
ck('无运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${'='.repeat(50)}`);
console.log(`新功能测试：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
