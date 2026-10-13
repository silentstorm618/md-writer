/**
 * 诊断：三种模式下滚动容器的真实层级与高度。
 * 输出每一层的 class/clientH/scrollH/overflowY，定位滚动断在哪一层。
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
const PORT = 9345;

const tmp = mkdtempSync(resolve(tmpdir(), 'mdw-diag-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve(tmp, 'p')}`,
  '--window-size=1200,800', 'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  try {
    const j = JSON.parse(execSync(`curl -s http://127.0.0.1:${PORT}/json/version`, { shell: '/bin/bash' }).toString());
    if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
  } catch {}
}
if (!wsUrl) { console.error('Chrome 未就绪'); process.exit(1); }

class CDP {
  constructor(u) {
    this.ws = new globalThis.WebSocket(u); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

// 复制真实 web 目录，注入长文档
const appDir = resolve(tmp, 'app');
execSync(`mkdir -p "${appDir}" && cp -R "${WEB}/." "${appDir}/"`, { shell: '/bin/bash' });

// 走真实 API 建一个长文档，再切到源码模式
writeFileSync(resolve(appDir, 'inject.js'), `
window.addEventListener('load', function () {
  setTimeout(function () {
    var parts = [];
    for (var i = 1; i <= 200; i++) {
      parts.push('## 标题 ' + i);
      parts.push('');
      parts.push('这是第 ' + i + ' 行的正文内容，用来把文档撑得很长很长很长很长，确保必须滚动。');
      parts.push('');
    }
    var md = parts.join('\\n');
    // 新建 Tab 并写入长文档（真实 API）
    window.MDWriter.on('documentOpened', { path: '/tmp/long.md', name: 'long.md', content: md });
    setTimeout(function () {
      window.__md = md;
      window.__appReady = true;
    }, 600);
  }, 400);
});
`);
const html = readFileSync(resolve(WEB, 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>', '<script src="app.js"></script>\n<script src="inject.js"></script>');
writeFileSync(resolve(appDir, 'index.html'), html);

await cdp.send('Page.navigate', { url: `file://${resolve(appDir, 'index.html')}` }, sessionId);
await sleep(3500);

// 逐模式 dump 每一层
const dump = async (mode) => {
  await cdp.send('Runtime.evaluate', {
    expression: `window.MDWriter.on('setMode',{mode:'${mode}'});`, }, sessionId);
  await sleep(900);

  const r = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      function chain(sel) {
        const out = [];
        let el = document.querySelector(sel);
        let depth = 0;
        while (el && depth < 8) {
          const cs = getComputedStyle(el);
          out.push({
            sel: el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') +
                 (el.className && typeof el.className === 'string' ? '.'+el.className.trim().split(/\\s+/).join('.') : ''),
            clientH: el.clientHeight, scrollH: el.scrollHeight,
            overflowY: cs.overflowY, height: cs.height,
            display: cs.display, flex: cs.flex,
            hidden: el.hidden,
          });
          el = el.firstElementChild; depth++;
        }
        return out;
      }
      const roots = {
        wysiwyg: '#wysiwyg-host .tab-editor:not([hidden])',
        source:  '#source-host .tab-editor:not([hidden])',
        // 分栏要同时看左右两栏
        split:   '#main',
      };
      // 用 allScrollables 找出整棵子树里所有可滚元素
      const allScroll = (function(){
        const list = [];
        const root = document.querySelector(roots['${mode}']);
        (function walk(el){
          if (!el || el.nodeType !== 1) return;
          const cs = getComputedStyle(el);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            const b = el.scrollTop; el.scrollTop = 400;
            const a = el.scrollTop; el.scrollTop = b;
            list.push({
              cls: (typeof el.className === 'string' ? el.className : '').slice(0,44),
              clientH: el.clientHeight, scrollH: el.scrollHeight,
              overflowY: cs.overflowY, scrolled: a > 0,
            });
          }
          for (const c of el.children) walk(c);
        })(root);
        return list;
      })();
      return JSON.stringify({
        mode: document.body.dataset.mode,
        chain: chain(roots['${mode}']),
        mdLen: window.__md ? window.__md.length : 0,
        allScroll,
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  return JSON.parse(r.result.value);
};

for (const mode of ['wysiwyg', 'source', 'split']) {
  const d = await dump(mode);
  console.log(`\n${'='.repeat(62)}`);
  console.log(`模式: ${d.mode}`);
  console.log('='.repeat(62));
  console.log('层级链:');
  for (const l of d.chain) {
    const can = l.scrollH > l.clientH + 2 ? `溢出${l.scrollH - l.clientH}` : '';
    console.log(`  ${l.sel.slice(0, 58).padEnd(58)} c=${String(l.clientH).padStart(5)} s=${String(l.scrollH).padStart(6)} ${l.overflowY.padEnd(7)} ${l.height.padEnd(8)} ${l.can}`);
  }
  console.log(`  (文档 ${d.mdLen} 字符)`);
  if (d.allScroll.length) {
    for (const s of d.allScroll) {
      const flag = s.scrolled ? '✅可滚' : '⚠️ 有滚动条但滚不动';
      console.log(`  ${flag} .${s.cls}  c=${s.clientH} s=${s.scrollH} ${s.overflowY}`);
    }
  } else {
    console.log('  ❌ 该模式下没有任何 overflow:auto/scroll 元素');
  }
}

process.on('exit', () => {
  try { chrome.kill('SIGKILL'); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});
process.exit(0);
