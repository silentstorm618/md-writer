/**
 * 真实浏览器布局验证（Chrome DevTools Protocol）。
 *
 * jsdom 没有布局引擎，无法验证滚动 —— 而「所见即所得不能上下滚动」
 * 正是只有真实布局才能暴露的问题。这里用无头 Chrome 实测
 * clientHeight / scrollHeight / overflowY / scrollTop。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(ROOT, 'native/MDWriter.app/Contents/Resources/web');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + String(d).slice(0, 120) : ''}`); }
};

/* ---------- 1. 用真实 index.html 的 CSS 造一个长文档页面 ---------- */
const idx = readFileSync(resolve(WEB, 'index.html'), 'utf8');
const css = idx.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const longBody = Array.from({ length: 150 }, (_, i) =>
  `<h2>段落 ${i + 1}</h2><p>第 ${i + 1} 段内容，用来把文档撑得很长很长很长，确保必须滚动才能看到全部。滚动滚动滚动。</p>`
).join('\n');

const page = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head><meta charset="utf-8"><style>${css}</style></head>
<body data-mode="wysiwyg">
<div id="app">
  <div id="toolbar" style="height:46px;flex:none"></div>
  <div id="tab-bar" style="height:34px;flex:none"></div>
  <aside id="sidebar" style="width:232px"></aside>
  <div id="main">
    <section class="mode-pane pane-wysiwyg">
      <div id="wysiwyg-host">
        <div class="tab-editor"><div class="wysiwyg" contenteditable="true">${longBody}</div></div>
      </div>
    </section>
    <section class="mode-pane pane-source" hidden>
      <div id="source-host">
        <div class="tab-editor"><div class="source-pane">
          <div class="cm-editor"><div class="cm-scroller">${longBody.replace(/</g, '&lt;')}</div></div>
        </div></div>
      </div>
    </section>
    <div class="pane-divider" hidden></div>
    <section class="mode-pane pane-preview" hidden>
      <div id="preview-scroll"><div class="md-body">${longBody}</div></div>
    </section>
  </div>
  <div id="statusbar" style="height:24px"></div>
</div>
</body></html>`;

const tmp = mkdtempSync(resolve(tmpdir(), 'mdw-scroll-'));
const file = resolve(tmp, 'probe.html');
writeFileSync(file, page);

/* ---------- 2. 启动无头 Chrome + 开调试端口 ---------- */
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve(tmp, 'profile')}`,
  '--window-size=1200,800',
  'about:blank',
], { stdio: 'ignore' });

let ws = null;
const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

// 等待调试端口就绪
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  try {
    const r = execSync(`curl -s http://127.0.0.1:${PORT}/json/version`, { shell: '/bin/bash' });
    const j = JSON.parse(r.toString());
    if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
  } catch {}
}
if (!wsUrl) {
  console.error('❌ Chrome 调试端口未能就绪');
  process.exit(1);
}

/* ---------- 3. 用 WebSocket 发 CDP 命令 ---------- */
const { WebSocket } = await import('ws').catch(() => ({ WebSocket: null }));
if (!WebSocket) {
  // Node 22 有内置 WebSocket
  const { default: W } = await import('node:worker_threads').then(() => ({ default: globalThis.WebSocket }));
}

class CDP {
  constructor(url) {
    this.ws = new globalThis.WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error('ws error'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return p;
  }
}

const cdp = new CDP(wsUrl);
await cdp.ready;

// 开新 tab
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Page.navigate', { url: `file://${file}` }, sessionId);
await sleep(2500);

/* ---------- 4. 实测布局与滚动 ---------- */
const probe = `(() => {
  const q = (s) => document.querySelector(s);
  const measure = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      overflowY: cs.overflowY,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      overflowX: cs.overflowX,
    };
  };
  const editor = q('.tab-editor:not([hidden]) .wysiwyg');
  const before = editor ? editor.scrollTop : -1;
  if (editor) editor.scrollTop = 400;
  const after = editor ? editor.scrollTop : -1;
  if (editor) editor.scrollTop = before;

  return JSON.stringify({
    main: measure(q('#main')),
    pane: measure(q('.mode-pane.pane-wysiwyg')),
    host: measure(q('#wysiwyg-host')),
    tabEditor: measure(q('.tab-editor:not([hidden])')),
    editor: measure(editor),
    editorScrollBefore: before,
    editorScrollAfter: after,
    docScrollH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
  });
})()`;

const r = await cdp.send('Runtime.evaluate',
  { expression: probe, returnByValue: true, awaitPromise: true }, sessionId);
const raw = r.result?.value;
if (!raw) {
  console.error('❌ 探针未返回结果', JSON.stringify(r).slice(0, 300));
  process.exit(1);
}
const m = JSON.parse(raw);

console.log('=== 真实布局测量（Chrome headless, 1200x800）===\n');
const fmt = (label, d) => {
  if (!d) { console.log(`  ${label.padEnd(12)} 缺失`); return; }
  console.log(`  ${label.padEnd(12)} client=${String(d.clientH).padStart(5)}  scroll=${String(d.scrollH).padStart(6)}  overflowY=${d.overflowY}`);
};
fmt('#main', m.main);
fmt('.mode-pane', m.pane);
fmt('#wysiwyg-host', m.host);
fmt('.tab-editor', m.tabEditor);
fmt('.wysiwyg', m.editor);

const overflows = m.editor && m.editor.scrollH > m.editor.clientH;
const canScroll = m.editorScrollAfter > 0;

console.log('');
ck('文档内容超出可视高度（测试前提）', overflows,
  `scrollH=${m.editor?.scrollH} clientH=${m.editor?.clientH}`);
ck('.wysiwyg 的 overflow-y 是 auto/scroll', ['auto', 'scroll'].includes(m.editor?.overflowY), m.editor?.overflowY);
ck('滚动容器高度小于内容高度', m.editor && m.editor.clientH > 0 && m.editor.clientH < m.editor.scrollH,
  `clientH=${m.editor?.clientH} scrollH=${m.editor?.scrollH}`);
ck('写入 scrollTop 生效（可滚动）', canScroll,
  `scrollTop: ${m.editorScrollBefore} -> ${m.editorScrollAfter}`);
ck('外层没有多余滚动条（pane 不溢出）',
  m.pane && m.pane.scrollH <= m.pane.clientH + 2,
  `pane scrollH=${m.pane?.scrollH} clientH=${m.pane?.clientH}`);
ck('页面本身不产生滚动', m.winH >= m.docScrollH - 2,
  `winH=${m.winH} docScrollH=${m.docScrollH}`);

/* ---------- 5. 切到源码模式与分栏模式，确认同样可滚 ---------- */
async function probeIn(mode) {
  await cdp.send('Runtime.evaluate', {
    expression: `document.body.dataset.mode='${mode}';
      document.querySelectorAll('.mode-pane').forEach(p=>{
        const k=[...p.classList].find(c=>c.startsWith('pane-')&&c!=='pane-divider');
        p.hidden = !({wysiwyg:['pane-wysiwyg'],source:['pane-source'],split:['pane-source','pane-preview']}['${mode}']).includes(k);
      });
      document.querySelector('.pane-divider').hidden = '${mode}'!=='split';`,
  }, sessionId);
  await sleep(400);

  const rr = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const sel = {source:'.tab-editor:not([hidden]) .cm-scroller',
                   split:'.tab-editor:not([hidden]) .cm-scroller',
                   wysiwyg:'.tab-editor:not([hidden]) .wysiwyg'};
      const el = document.querySelector(sel['${mode}']);
      if (!el) return JSON.stringify({missing:true});
      const before = el.scrollTop; el.scrollTop = 400; const after = el.scrollTop; el.scrollTop = before;
      return JSON.stringify({
        clientH: el.clientHeight, scrollH: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY,
        scrolled: after > 0,
        visiblePanes: [...document.querySelectorAll('.mode-pane')].filter(p=>!p.hidden).length,
        mainH: document.getElementById('main').clientHeight,
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  return JSON.parse(rr.result.value);
}

console.log('\n=== 其他模式 ===');
for (const mode of ['source', 'split']) {
  const d = await probeIn(mode);
  if (d.missing) {
    ck(`${mode} 模式找到滚动容器`, false, '未找到');
    continue;
  }
  console.log(`  [${mode}] client=${d.clientH} scroll=${d.scrollH} overflowY=${d.overflowY} 可见面板=${d.visiblePanes}`);
  ck(`${mode} 模式高度受视口约束`, d.clientH > 0 && d.clientH < d.scrollH,
    `clientH=${d.clientH} scrollH=${d.scrollH}`);
  ck(`${mode} 模式可滚动`, d.scrolled);
  ck(`${mode} 模式面板数量正确`,
    mode === 'source' ? d.visiblePanes === 1 : d.visiblePanes === 2,
    `实际 ${d.visiblePanes}`);
}

/* ---------- 6. 在真实 App（完整 bundle）里验证 ---------- */
console.log('\n=== 真实 App 全量验证 ===');

// 不内联 bundle（会破坏执行上下文），而是复制一份目录并追加注入脚本
const appDir = resolve(tmp, 'app');
execSync(`mkdir -p "${appDir}" && cp -R "${WEB}/." "${appDir}/"`, { shell: '/bin/bash' });

// 在 index.html 的 app.js 之后追加一个注入脚本（外部文件，安全）
writeFileSync(resolve(appDir, 'inject.js'), `
window.addEventListener('load', function () {
  setTimeout(function () {
    var parts = [];
    for (var i = 1; i <= 150; i++) {
      parts.push('<h2>段落 ' + i + '</h2><p>第 ' + i + ' 段内容，用来把文档撑得很长很长很长，确保必须滚动。</p>');
    }
    var host = document.querySelector('#wysiwyg-host .tab-editor:not([hidden]) .wysiwyg');
    if (host) host.innerHTML = parts.join('');
    window.__appReady = true;
  }, 600);
});
`);

const appHTML = readFileSync(resolve(WEB, 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>',
    '<script src="app.js"></script>\n<script src="inject.js"></script>');
writeFileSync(resolve(appDir, 'index.html'), appHTML);

await cdp.send('Page.navigate', { url: `file://${resolve(appDir, 'index.html')}` }, sessionId);
await sleep(3500);

const appProbe = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    function check(sel, label) {
      const el = document.querySelector(sel);
      if (!el) return { label, missing: true };
      const before = el.scrollTop; el.scrollTop = 500;
      const after = el.scrollTop; el.scrollTop = before;
      return {
        label, clientH: el.clientHeight, scrollH: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY, scrolled: after > 0,
      };
    }
  return JSON.stringify({
    ready: !!window.__appReady,
    tabCount: document.querySelectorAll('#tab-bar .tab').length,
    // 列出实际结构，便于诊断
    structure: (function () {
      const host = document.getElementById('wysiwyg-host');
      if (!host) return 'no host';
      return {
        hostChildren: host.children.length,
        hostChildClasses: [...host.children].map(c => c.className),
        firstGrandchild: host.children[0] ? [...host.children[0].children].map(c => c.className) : [],
        bodyMode: document.body.dataset.mode,
      };
    })(),
    wysiwyg: check('.tab-editor.wysiwyg:not([hidden])', '所见即所得(同元素)'),
    wysiwyg2: check('#wysiwyg-host .tab-editor:not([hidden])', '所见即所得(容器)'),
    main: { clientH: document.getElementById('main').clientHeight,
            scrollH: document.getElementById('main').scrollHeight },
  });
  })()`,
  returnByValue: true,
}, sessionId);
const ap = JSON.parse(appProbe.result.value);

console.log(`  Tab 数=${ap.tabCount}  appReady=${ap.ready}`);
console.log(`  [所见即所得] client=${ap.wysiwyg.clientH} scroll=${ap.wysiwyg.scrollH} overflowY=${ap.wysiwyg.overflowY}`);

ck('真实 App 启动成功', ap.ready);
ck('真实 App 正常创建 Tab', ap.tabCount === 1, `实际 ${ap.tabCount}`);
ck('真实 App：所见即所得内容已撑高', ap.wysiwyg.scrollH > ap.wysiwyg.clientH,
  `scrollH=${ap.wysiwyg.scrollH} clientH=${ap.wysiwyg.clientH}`);
ck('真实 App：所见即所得可上下滚动', ap.wysiwyg.scrolled);
ck('真实 App：#main 无溢出', ap.main.scrollH <= ap.main.clientH + 2,
  `scrollH=${ap.main.scrollH} clientH=${ap.main.clientH}`);

// 切到源码模式，用真实 CodeMirror 验证
const srcProbe = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    window.MDWriter.on('setMode', {mode:'source'});
    return new Promise(res => setTimeout(() => {
      const sc = document.querySelector('.tab-editor:not([hidden]) .cm-scroller');
      if (!sc) return res(JSON.stringify({missing:true}));
      const before = sc.scrollTop; sc.scrollTop = 500;
      const after = sc.scrollTop; sc.scrollTop = before;
      res(JSON.stringify({
        clientH: sc.clientHeight, scrollH: sc.scrollHeight,
        overflowY: getComputedStyle(sc).overflowY, scrolled: after > 0,
      }));
    }, 600));
  })()`,
  returnByValue: true, awaitPromise: true,
}, sessionId);
const sp = JSON.parse(srcProbe.result.value);
if (!sp.missing) {
  console.log(`  [源码] client=${sp.clientH} scroll=${sp.scrollH} overflowY=${sp.overflowY}`);
  ck('真实 App：源码模式可滚动', sp.scrolled, `scrollTop 写入 ${sp.scrolled}`);
  ck('真实 App：源码模式高度受约束', sp.clientH > 0 && sp.clientH < sp.scrollH,
    `clientH=${sp.clientH} scrollH=${sp.scrollH}`);
} else {
  ck('真实 App：找到源码滚动容器', false, '未找到 .cm-scroller');
}

console.log(`\n${'='.repeat(50)}`);
console.log(`真实布局验证：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(50));

process.exit(fail ? 1 : 0);
