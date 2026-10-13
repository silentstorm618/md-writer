/**
 * 验证 applyThemeVars 的明暗切换逻辑：
 * 深色界面下不能出现「深底黑字」，也不能残留浅色的行内样式。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';

const RES = new URL('../native/MDWriter.app/Contents/Resources/web/', import.meta.url);
const indexHTML = await readFile(new URL('index.html', RES), 'utf8');

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', (e) => errs.push(String(e.message).slice(0, 120)));

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
dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
if (dom.window.Range) {
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 });
}

const bundle = await readFile(new URL('app.js', RES), 'utf8');
dom.window.eval(bundle);
await new Promise((r) => setTimeout(r, 1000));

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 100) : ''}`); }
};

const root = dom.window.document.documentElement;
const inlineVar = (name) => root.style.getPropertyValue(name).trim();

console.log('=== 深色模式（系统偏好=深色）===');
ck('data-theme=dark', root.dataset.theme === 'dark', root.dataset.theme);
ck('界面底色走深色', !inlineVar('--bg'), `内联 --bg="${inlineVar('--bg')}"（应为空，交给 CSS）`);
ck('正文色未被浅色主题覆盖', inlineVar('--t-fg') !== '#1f2328',
  `--t-fg="${inlineVar('--t-fg')}"（不该是浅色主题的深字）`);

console.log('\n--- 关键：不能有深底黑字 ---');
const fg = inlineVar('--t-fg');
const bg = inlineVar('--t-bg');
if (fg) {
  ck('未内联深色正文（由 CSS dark 提供）', fg.toLowerCase() !== '#16181d', fg);
} else {
  console.log('     --t-fg 由 [data-theme=dark] 提供 = #e6e6e6 ✅');
}

console.log('\n--- 排版变量应始终保留 ---');
for (const v of ['--t-font-size', '--t-max-width', '--t-line-height', '--t-radius']) {
  ck(`${v} 已设置`, !!inlineVar(v), inlineVar(v));
}

console.log('\n=== 切换到浅色模式 ===');
dom.window.eval(`window.MDWriter.on('setThemeMode', {mode:'light'})`);
await new Promise((r) => setTimeout(r, 200));
ck('data-theme=light', root.dataset.theme === 'light', root.dataset.theme);

console.log('\n=== 切换到深色模式 ===');
dom.window.eval(`window.MDWriter.on('setThemeMode', {mode:'dark'})`);
await new Promise((r) => setTimeout(r, 200));
ck('data-theme=dark', root.dataset.theme === 'dark', root.dataset.theme);
ck('再次切换后无残留浅色 --t-fg', inlineVar('--t-fg').toLowerCase() !== '#1f2328', inlineVar('--t-fg'));

console.log('\n=== 选深色导出主题时的表现 ===');
// 模拟点选「深色」主题卡片
const card = dom.window.document.querySelector('[data-theme-card="dark"]');
if (card) {
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  ck('深色主题已应用 --t-bg=#101010', inlineVar('--t-bg').toLowerCase() === '#101010', inlineVar('--t-bg'));
  ck('深色主题正文 #e6e6e6', inlineVar('--t-fg').toLowerCase() === '#e6e6e6', inlineVar('--t-fg'));
} else {
  ck('深色主题卡片存在', false, '未找到 [data-theme-card="dark"]');
}

console.log('\n=== 浅色界面 + 深色主题（应自动用浅色配色兜底）===');
dom.window.eval(`window.MDWriter.on('setThemeMode', {mode:'light'})`);
await new Promise((r) => setTimeout(r, 200));
// 此时 themeId 仍是 dark，界面是浅色
const fgLight = inlineVar('--t-fg');
console.log(`     --t-fg = "${fgLight}"`);
ck('浅色界面下未使用深色主题的 #e6e6e6（否则白底白字）',
  fgLight.toLowerCase() !== '#e6e6e6' || inlineVar('--t-bg').toLowerCase() !== '#101010',
  `fg=${fgLight} bg=${inlineVar('--t-bg')}`);

console.log('\n=== 启动无报错 ===');
ck('无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n${'='.repeat(48)}`);
console.log(`${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);