/**
 * MD Writer 前端入口。
 * 负责：状态管理、视图切换、原生桥接、导出调度、自动保存。
 */
import { createWYSIWYG } from './ui/editor.js';
import { createSourceEditor } from './ui/source-editor.js';
import { renderInto, renderMarkdown, stats, ensureMermaid, renderMermaidIn } from './core/renderer.js';
import { THEMES, FONTS, FONT_SIZES, themeById, fontById, themeVars } from './core/theme.js';
import { exportHTML, exportDOCX, exportPDF, exportPNG, buildTOC } from './export/index.js';
import { getTurndown, htmlToMarkdownSync } from './core/turndown.js';

/* ============================================================
 * 状态
 * ============================================================ */

/**
 * 应用状态。
 *
 * 文档相关的一切都挂在 tabs 上，state 上只保留「全局界面」配置
 * （主题、字号、视图模式）。这样新增/打开文件就是加一个 Tab，
 * 各 Tab 的内容、脏标记、滚动位置天然隔离。
 */
const state = {
  tabs: [],                // Tab 列表，顺序即显示顺序
  activeTabId: null,       // 当前激活的 Tab id
  mode: 'wysiwyg',        // wysiwyg | source | split（全局共享）
  themeMode: 'system',    // system | light | dark
  themeId: 'tech',        // 导出主题
  fontId: 'system',
  fontSize: 16,
  zoom: 1,
  sidebar: true,
  toc: false,
  tocDepth: 3,            // 目录里收录的最大标题层级（1-6）
  libraryView: 'toc',     // toc | images
};

/** 当前激活的 Tab（保证至少返回一个） */
function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0] || null;
}

let tabSeq = 0;

const $ = (id) => document.getElementById(id);

/**
 * 与明暗无关的排版变量：这些在任何配色下都应保留用户/主题的选择，
 * 不能因为切到深色就被清掉。
 */
const NEUTRAL_VARS = new Set([
  '--t-radius', '--t-line-height', '--t-heading-weight', '--t-max-width',
  '--t-font-family', '--t-font-size',
]);

/**
 * 当前 Tab 的编辑器实例的便捷访问器。
 * 底层每个 Tab 各有一份，这里只是取当前激活的那份，
 * 让既有代码不必到处写 activeTab().wysiwyg。
 */
function curWysiwyg() { return activeTab()?.wysiwyg || null; }
function curSource() { return activeTab()?.source || null; }

/** 取指定 Tab 的内容（不看当前模式，按模式取对应编辑器） */
function currentMarkdownFor(tab) {
  if (!tab) return '';
  if (state.mode === 'source' && tab.source) return tab.source.getValue();
  if (state.mode === 'wysiwyg' && tab.wysiwyg) return tab.wysiwyg.getMarkdown();
  return tab.md;
}

/** 批量保存时的续链：每次原生回调后触发下一步 */
let pendingSaveChain = null;

/** "保存后关闭 Tab" 用的状态：在 documentSaved 回调里检测并真正关 */
let pendingCloseAfterSave = null;

let saveTimer = null;

/* ============================================================
 * 原生桥
 * ============================================================ */

const isNative = typeof window.webkit !== 'undefined';

window.MDWriter = {
  bridge: {
    send(action, payload = {}) {
      if (!isNative) return;
      window.webkit.messageHandlers.mdwriter.postMessage({ action, payload });
    },
    // 浏览器预览下的降级：直接下载
    download(name, data, mime) {
      downloadBlob(name, data, mime);
    },
  },
  on(name, payload) {
    const handler = nativeHandlers[name];
    if (handler) handler(payload || {});
  },

  /**
   * 供原生同步查询（退出前判断是否有未保存内容）。
   * evaluateJavaScript 会把返回值传回 Swift，因此必须返回原始值。
   */
  query(name) {
    switch (name) {
      case 'hasUnsaved':
        return state.tabs.some((t) => t.dirty);
      case 'tabCount':
        return state.tabs.length;
      default:
        return null;
    }
  },
};

function send(action, payload = {}) {
  if (isNative) {
    window.webkit.messageHandlers.mdwriter.postMessage({ action, payload });
  }
  return false;
}

function sendOrDownload(action, payload, filename, data, mime) {
  if (isNative) {
    send(action, payload);
    return true;
  }
  downloadBlob(filename, data, mime);
  return false;
}

/* ============================================================
 * Tab 与文档操作
 * ============================================================ */

/**
 * 打开一个新 Tab。
 * 每个 Tab 拥有独立的 wysiwyg / source 编辑器实例，
 * 因此各 Tab 的内容、撤销栈、滚动位置、光标都互不干扰。
 */
function openTab({ name = '未命名', path = '', md = '', dirty = false, activate = true } = {}) {
  const id = `tab_${++tabSeq}`;
  const tab = {
    id, name, path, md, dirty,
    scroll: { wysiwyg: 0, source: 0, preview: 0 },
  };

  const hostW = $('wysiwyg-host');
  const hostS = $('source-host');

  const elW = document.createElement('div');
  elW.className = 'tab-editor wysiwyg-pane';
  elW.dataset.tabId = id;
  hostW.appendChild(elW);

  const elS = document.createElement('div');
  elS.className = 'tab-editor source-pane';
  elS.dataset.tabId = id;
  hostS.appendChild(elS);

  tab.el = elW;
  tab.elSource = elS;
  tab.wysiwyg = createWYSIWYG(elW, {
    onChange: (m) => onTabContentChanged(id, m),
    onImage: (file) => handleImageFile(file, id),
    onPasteHTML: (html) => htmlToMarkdownSync(html),
    ensureTurndown: getTurndown,
  });
  tab.source = createSourceEditor(elS, {
    onChange: (m) => onTabContentChanged(id, m),
  });

  tab.wysiwyg.setMarkdown(md);
  tab.source.setValue(md);

  state.tabs.push(tab);
  if (activate) state.activeTabId = id;

  renderTabBar();
  if (activate) activateTab(id);
  return tab;
}

/** 某 Tab 的内容变化（来自它的编辑器） */
function onTabContentChanged(tabId, md) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  tab.md = md;
  if (!tab.dirty) {
    tab.dirty = true;
    renderTabBar();
  }
  if (tabId === state.activeTabId) {
    schedulePreview();
    updateStats();
    updateDirty();
  }
  scheduleAutosave();
}

/** 激活某个 Tab：显示它的编辑器、恢复预览与状态栏 */
function activateTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;

  state.activeTabId = id;

  // 同步内容到共享的 state 视图（供预览/导出使用）
  for (const t of state.tabs) {
    const on = t.id === id;
    t.el.hidden = !on;
    t.elSource.hidden = !on;
  }

  // 恢复各面板滚动位置
  requestAnimationFrame(() => {
    if (tab.el) tab.el.scrollTop = tab.scroll.wysiwyg;
    const sc = tab.source?.el?.querySelector?.('.cm-scroller');
    if (sc) sc.scrollTop = tab.scroll.source;
  });

  renderTabBar();
  updateDirty();
  schedulePreview();
  updateStats();
  applyThemeVars();
}

/** 关闭 Tab。unsavedHint=true 时先确认（⌘W 走确认，× 按钮直接关） */
async function closeTab(id, unsavedHint = true) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = state.tabs[idx];

  // 有未保存内容时确认（macOS 风格：保存 / 不保存 / 取消）
  if (unsavedHint && tab.dirty) {
    const choice = await showDirtyConfirm(tab.name);
    if (choice === 'cancel') return;
    if (choice === 'save') {
      // 先把内容写回 tab.md，再走 doSave；doSave 在原生环境下会异步保存，
      // 这里把"保存成功后再真正关"挂成一个一次性 listener
      tab.md = currentMarkdownFor(tab);
      pendingCloseAfterSave = id;
      doSave(false);
      return;
    }
    // 'discard' 继续走下面的卸载逻辑
  }

  // 卸载编辑器实例，释放 DOM / 监听 / 计时器
  try { tab.wysiwyg?.destroy?.(); } catch { /* 兜底 */ }
  try { tab.source?.destroy?.(); } catch { /* 兜底 */ }
  tab.el?.remove();
  tab.elSource?.remove();
  tab.wysiwyg = null;
  tab.source = null;

  state.tabs.splice(idx, 1);

  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    if (next) {
      activateTab(next.id);
    } else {
      // 关掉了最后一个 Tab：自动开一个空白文档，避免空界面
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `草稿 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      openTab({ name, md: '' });
    }
  } else {
    renderTabBar();
  }
  scheduleAutosave();
}

/** 把 Tab 移动到指定位置（拖拽排序用） */
function moveTab(fromId, toIndex) {
  const from = state.tabs.findIndex((t) => t.id === fromId);
  if (from === -1) return;
  const [tab] = state.tabs.splice(from, 1);
  let to = Math.max(0, Math.min(toIndex, state.tabs.length));
  state.tabs.splice(to, 0, tab);
  renderTabBar();
  scheduleAutosave();
}

function switchTabBy(delta) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const next = (i + delta + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next].id);
}

function switchTabByIndex(n) {
  if (n >= 1 && n <= state.tabs.length) activateTab(state.tabs[n - 1].id);
}

/** 载入内容到当前 Tab（不新建 Tab） */
function setMarkdown(md, { fromEditor = false } = {}) {
  const tab = activeTab();
  if (!tab) return;
  tab.md = md;

  if (!fromEditor) {
    tab.wysiwyg?.setMarkdown(md);
    tab.source?.setValue(md);
  }
  schedulePreview();
  updateStats();
  scheduleAutosave();
  updateDirty();
}

function currentMarkdown() {
  const tab = activeTab();
  if (!tab) return '';
  // 以当前激活的编辑器为准，保证拿到的是最新输入
  if (state.mode === 'source' && tab.source) return tab.source.getValue();
  if (state.mode === 'wysiwyg' && tab.wysiwyg) return tab.wysiwyg.getMarkdown();
  return tab.md;
}

function updateDirty() {
  const tab = activeTab();
  if (!tab) return;
  if (!suppressDirtyTitle) {
    send('setTitle', { title: tab.name, dirty: tab.dirty, tabCount: state.tabs.length });
  }
  const el = $('save-state');
  if (el) {
    if (tab.dirty) {
      el.textContent = '已修改';
    } else if (lastSavedAt) {
      // 保存后 3 秒内显示具体时间，避免一直 "已保存" 让人摸不着头脑
      const since = Date.now() - lastSavedAt;
      if (since < 3000) {
        const t = new Date(lastSavedAt);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        el.textContent = `已保存于 ${hh}:${mm}:${ss}`;
      } else {
        el.textContent = '已保存';
      }
    } else {
      el.textContent = '已保存';
    }
    el.classList.toggle('dirty', tab.dirty);
  }
  const dirtyCount = state.tabs.filter((t) => t.dirty).length;
  document.title = (tab.dirty ? '● ' : '') + tab.name + ' — MD Writer';
  // 状态栏补充未保存数量
  const multi = $('tab-dirty-count');
  if (multi) {
    multi.textContent = dirtyCount > 1 ? `${dirtyCount} 个未保存` : '';
  }
}

/** 上次保存成功的时刻，用于"刚刚保存于…"提示 */
let lastSavedAt = 0;

/** boot/恢复草稿期间屏蔽 updateDirty 的 setTitle，避免与原生 titlebar 抢 */
let suppressDirtyTitle = false;

function markDirty() {
  const tab = activeTab();
  if (!tab) return;
  tab.dirty = true;
  renderTabBar();
  updateDirty();
}

/* ---------- Tab 栏渲染 ---------- */

function renderTabBar() {
  const bar = $('tab-bar');
  if (!bar) return;

  bar.innerHTML = state.tabs.map((t, i) => `
    <div class="tab${t.id === state.activeTabId ? ' active' : ''}${t.dirty ? ' dirty' : ''}"
         data-tab="${t.id}" draggable="true"
         title="${escapeAttr(t.name)}${t.path ? ' — ' + escapeAttr(t.path) : ''}">
      <span class="tab-icon">${t.path ? '◉' : '○'}</span>
      <span class="tab-name">${escapeHTML(t.name)}</span>
      ${i < 9 ? `<span class="tab-idx">${i + 1}</span>` : ''}
      <button class="tab-close" data-close="${t.id}" title="关闭 ⌘W">×</button>
    </div>`).join('');

  // 保证激活 Tab 在可视区内
  // scrollIntoView 在部分环境（无布局引擎）不存在，加保护
  const active = bar.querySelector('.tab.active');
  if (typeof active?.scrollIntoView === 'function') {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // 保存所有 Tab（含各自的内容与脏状态），下次启动可完整恢复
      localStorage.setItem('mdwriter-tabs', JSON.stringify({
        tabs: state.tabs.map((t) => ({
          name: t.name, path: t.path, md: t.md, dirty: t.dirty,
        })),
        activeIndex: Math.max(0, state.tabs.findIndex((t) => t.id === state.activeTabId)),
        themeId: state.themeId,
        fontId: state.fontId,
        fontSize: state.fontSize,
        themeMode: state.themeMode,
        tocDepth: state.tocDepth,
        sidebar: state.sidebar,
        libraryView: state.libraryView,
        savedAt: Date.now(),
      }));
    } catch { /* 容量超限则忽略 */ }
  }, 600);
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem('mdwriter-tabs');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 启动恢复草稿前的"撤销"提示：用户点撤销则清空草稿重新开始 */
function offerRestoreUndo() {
  const btn = document.createElement('button');
  btn.className = 'restore-undo-btn';
  btn.textContent = '撤销恢复（清空草稿）';
  btn.addEventListener('click', () => {
    localStorage.removeItem('mdwriter-tabs');
    toast('草稿已清空', 'ok');
    btn.remove();
  });
  setTimeout(() => btn.remove(), 8000); // 8 秒后自动消失
  document.body.appendChild(btn);
}

/* ============================================================
 * 视图
 * ============================================================ */

/** 每种模式下应该显示哪些面板 */
const MODE_PANES = {
  wysiwyg: ['pane-wysiwyg'],
  source: ['pane-source'],
  split: ['pane-source', 'pane-preview'],
};

function setMode(mode) {
  // 切换前把当前编辑器的内容回写到 Tab
  const tab = activeTab();
  if (tab) tab.md = currentMarkdown();

  state.mode = mode;
  document.body.dataset.mode = mode;

  for (const btn of document.querySelectorAll('[data-mode-btn]')) {
    btn.classList.toggle('active', btn.dataset.modeBtn === mode);
  }

  // 只显示当前模式需要的面板；其余全部隐藏，避免两个视图叠在一起
  const visible = MODE_PANES[mode] || [];
  document.querySelectorAll('.mode-pane').forEach((pane) => {
    const cls = Array.from(pane.classList);
    const kind = cls.find((c) => c.startsWith('pane-') && c !== 'pane-divider');
    pane.hidden = !(kind && visible.includes(kind));
  });
  const divider = document.querySelector('.pane-divider');
  if (divider) divider.hidden = mode !== 'split';

  // 让所有 Tab 的对应编辑器都同步内容，保证切 Tab 时状态一致
  // 当前激活 Tab 跳过（它已经在显示当前内容，重置会丢滚动位置）
  const activeId = state.activeTabId;
  for (const t of state.tabs) {
    if (t.id === activeId) continue;
    if (mode === 'wysiwyg') t.wysiwyg?.setMarkdown(t.md);
    else t.source?.setValue(t.md);
  }

  renderSidebar();
}

function updateStats() {
  const tab = activeTab();
  const md = currentMarkdown();
  const s = stats(md);
  const el = $('statusbar-stats');
  if (el) {
    el.textContent = `${s.chars} 字 · ${s.lines} 行 · ${s.words} 词 · 约 ${s.minutes} 分钟`;
  }
  updateCursorPos(tab, md);
}

/** 状态栏显示光标位置（行/列 + 选区字数） */
function updateCursorPos(tab, md) {
  const el = $('cursor-pos');
  if (!el || !tab) return;

  let line = 1, col = 1, selected = 0;

  if (state.mode === 'source' && tab.source?.view) {
    const view = tab.source.view;
    const head = view.state.selection.main.head;
    const anchor = view.state.selection.main.anchor;
    const doc = view.state.doc;
    const lineObj = doc.lineAt(head);
    line = lineObj.number;
    col = head - lineObj.from + 1;
    if (anchor !== head) selected = Math.abs(head - anchor);
  } else if (state.mode === 'wysiwyg' && tab.wysiwyg?.el) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && tab.wysiwyg.el.contains(sel.anchorNode)) {
      const pre = sel.anchorNode;
      const text = pre?.textContent ?? '';
      const upto = sel.anchorOffset ?? 0;
      const before = text.slice(0, upto);
      const lines = before.split('\n');
      line = lines.length;
      col = lines[lines.length - 1].length + 1;
      selected = Math.abs((sel.toString() || '').length);
    }
  }

  el.textContent = selected > 0
    ? `行 ${line}，列 ${col}（已选 ${selected}）`
    : `行 ${line}，列 ${col}`;
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 260);
}

// 预览渲染带序号守卫：异步的 mermaid 渲染可能晚于下一次触发，
// 用递增序号丢弃过期的结果，避免旧内容覆盖新内容（这正是截图里内容错乱的原因）
let previewSeq = 0;
async function renderPreview() {
  const el = $('preview');
  if (!el) return;
  const seq = ++previewSeq;
  const md = currentMarkdown();

  const html = renderMarkdown(md);
  // 同步 innerHTML 写入也纳入序号守卫，避免连续触发时旧内容把新内容抢先覆盖
  if (seq !== previewSeq) return;
  el.innerHTML = (state.toc ? buildTOC(md, state.tocDepth) : '') + html;

  await renderMermaidIn(el);
  // 期间可能又触发了新的渲染（或用户切了 Tab），丢弃本次结果
  if (seq !== previewSeq) return;

  renderSidebar();
}

/**
 * 应用主题变量。
 *
 * 注意：state.themeId 是「导出主题」（决定导出的 HTML 长什么样），
 * 而界面的明暗由 themeMode 决定。若把导出主题的浅色变量无条件写到
 * :root 上，内联样式会盖过 [data-theme=dark] 选择器，
 * 结果就是深色界面里出现「深底黑字」——这正是截图里的问题。
 *
 * 因此：导出主题照常写进 --export-* 供导出使用；
 * 界面内的内容变量则按当前明暗，从 index.html 的 CSS 变量继承，
 * 只有用户显式选了深色/浅色系主题时才覆盖。
 */
function applyThemeVars() {
  const theme = themeById(state.themeId);
  const font = fontById(state.fontId);
  const root = document.documentElement;

  const dark = state.themeMode === 'dark' ||
    (state.themeMode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  // 排版类的变量（与明暗无关）始终跟随用户设置
  root.style.setProperty('--t-font-family', font.stack);
  root.style.setProperty('--t-font-size', `${state.fontSize}px`);
  root.style.setProperty('--zoom', String(state.zoom));
  root.style.setProperty('--editor-font-size', `${state.fontSize}px`);
  root.style.setProperty('--t-max-width', theme.vars['--t-max-width']);
  root.style.setProperty('--t-line-height', theme.vars['--t-line-height']);
  root.style.setProperty('--t-heading-weight', theme.vars['--t-heading-weight']);
  root.style.setProperty('--t-radius', theme.vars['--t-radius']);

  // 颜色类变量：主题与界面明暗必须一致，否则会出现「深底黑字」或「白底白字」。
  //   界面深色 + 浅色系主题 -> 用深色配色（保证可读）
  //   界面浅色 + 深色系主题 -> 用浅色配色（保证可读）
  //   两者同色系         -> 完整采用主题配色（用户显式指定，尊重选择）
  const themeIsDark = theme.id === 'dark';
  const palette = theme.vars;
  const COLOR_VARS = Object.keys(palette).filter((k) => !NEUTRAL_VARS.has(k));

  if (dark !== themeIsDark) {
    // 明暗不匹配：保留强调色（品牌感），其余颜色交给 CSS 的 data-theme 提供
    root.style.setProperty('--t-accent', palette['--t-accent']);
    for (const k of COLOR_VARS) {
      if (k !== '--t-accent') root.style.removeProperty(k);
    }
  } else {
    // 同色系：完整采用主题配色
    for (const [k, v] of Object.entries(palette)) {
      root.style.setProperty(k, v);
    }
  }

  // 编辑器配色跟随（每个 Tab 都要设置，不能只设当前 Tab）
  const isDark = String(dark);
  for (const t of state.tabs) {
    t.wysiwyg?.el && (t.wysiwyg.el.dataset.dark = isDark);
    t.source?.setTheme?.(dark);
  }

  // 主题按钮高亮
  document.querySelectorAll('[data-theme-card]').forEach((c) => {
    c.classList.toggle('active', c.dataset.themeCard === state.themeId);
  });
}

function setZoom(delta) {
  if (delta === 0) state.zoom = 1;
  else state.zoom = Math.min(2.4, Math.max(0.5, +(state.zoom + delta * 0.1).toFixed(2)));
  applyThemeVars();
  $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
}

/* ============================================================
 * 侧边栏
 * ============================================================ */

async function renderSidebar() {
  if (!state.sidebar) return;
  const el = $('sidebar-body');
  if (!el) return;

  if (state.libraryView === 'toc') {
    el.innerHTML = buildTOC(currentMarkdown(), state.tocDepth) || '<div class="side-empty">还没有标题<br><span>用 # 开头创建标题</span></div>';
  } else {
    const files = await window.MDWriterAssets?.list?.() || [];
    if (!files.length) {
      el.innerHTML = '<div class="side-empty">还没有图片<br><span>直接粘贴或拖入图片即可</span></div>';
    } else {
      el.innerHTML = files.map((f) => `
        <div class="asset-item" data-url="${f.url}">
          <img src="${f.url}" alt="${f.name}" loading="lazy">
          <div class="asset-name" title="${f.name}">${f.name}</div>
        </div>`).join('');
    }
  }
}

/* ============================================================
 * 导出
 * ============================================================ */

async function doExport(kind) {
  const tab = activeTab();
  if (!tab) return;
  const md = currentMarkdown();
  if (!md.trim()) {
    toast('文档是空的，没什么可导出的', 'warn');
    return;
  }
  tab.md = md;

  const base = (tab.name || '未命名').replace(/\.md$/i, '');
  const opts = { title: tab.name, md, themeId: state.themeId, fontId: state.fontId, fontSize: state.fontSize };
  const t = toast;

  try {
    if (kind === 'html') {
      t('正在生成 HTML…');
      const html = await exportHTML(opts);
      sendOrDownload('export', {
        base64: btoa(unescape(encodeURIComponent(html))),
        name: `${base}.html`, ext: 'html',
      }, `${base}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }), 'text/html');
      t('HTML 已导出', 'ok');
    } else if (kind === 'docx') {
      t('正在生成 Word 文档…');
      const blob = await exportDOCX(opts);
      const buf = await blob.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      sendOrDownload('export', { base64: b64, name: `${base}.docx`, ext: 'docx' },
        `${base}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      t('Word 文档已导出', 'ok');
    } else if (kind === 'png') {
      t('正在生成长图…');
      const el = $('preview');
      const dataURL = await exportPNG({ sourceEl: el, scale: 2, themeId: state.themeId });
      const b64 = dataURL.split(',')[1];
      sendOrDownload('export', { base64: b64, name: `${base}.png`, ext: 'png' },
        `${base}.png`, dataURLToBlob(dataURL), 'image/png');
      t('长图已导出', 'ok');
    } else if (kind === 'pdf') {
      const html = await exportHTML({ ...opts, inlineImg: true });
      if (isNative) {
        send('printHTML', { html });
        t('在打印面板里选择「PDF → 存储为 PDF」', 'info');
      } else {
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 500);
      }
    } else if (kind === 'md') {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      sendOrDownload('export', {
        base64: btoa(unescape(encodeURIComponent(md))),
        name: `${base}.md`, ext: 'md',
      }, `${base}.md`, blob, 'text/markdown');
      t('Markdown 已导出', 'ok');
    }
  } catch (e) {
    console.error(e);
    t(`导出失败：${e.message}`, 'error');
  }
}

function dataURLToBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function downloadBlob(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doSave(as = false) {
  const tab = activeTab();
  if (!tab) return;
  const md = currentMarkdown();
  tab.md = md;
  if (isNative) {
    send(as || !tab.path ? 'saveAs' : 'save', {
      content: md, name: tab.name, path: tab.path, tabId: tab.id,
    });
  } else {
    downloadBlob(`${(tab.name || '未命名').replace(/\.md$/, '')}.md`, md, 'text/markdown');
    tab.dirty = false;
    renderTabBar();
    updateDirty();
    toast('已下载 .md 文件', 'ok');
  }
}

/* ============================================================
 * 图片
 * ============================================================ */

/**
 * 插入图片。
 * @param {File} file
 * @param {string} tabId 目标 Tab；不传则用当前 Tab
 */
async function handleImageFile(file, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId) || activeTab();
  if (!tab) return;

  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const name = `${id}.${ext}`;
  const dataURL = await fileToDataURL(file);

  // 1) 存内存（供预览/导出用）
  window.MDWriterAssets?.add?.(name, dataURL);
  // 2) 让原生写到 assets 目录（跟文档同级）
  if (isNative) {
    send('asset.save', { base64: dataURL.split(',')[1], name, id, docPath: tab.path });
  }

  const alt = file.name.replace(/\.[^.]+$/, '');
  const md = `![${alt}](assets/${name})`;

  // 插入到目标 Tab 的编辑器
  const src = tab.source;
  if (state.mode === 'source' && src) {
    const pos = src.view.state.selection.main.head;
    const cur = src.getValue();
    src.setValue(cur.slice(0, pos) + md + cur.slice(pos));
    src.view.focus();
  } else if (tab.wysiwyg) {
    tab.wysiwyg.exec.imageHTML(`<img src="${dataURL}" alt="${alt}">`);
  }
  tab.md = (state.mode === 'source' && src) ? src.getValue() : tab.wysiwyg.getMarkdown();
  tab.dirty = true;
  if (tab.id === state.activeTabId) {
    renderTabBar();
    schedulePreview();
    updateStats();
    updateDirty();
  }
  scheduleAutosave();
  toast(`已插入图片：${name}`, 'ok');
  renderSidebar();
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/** 内存态资源库 */
window.MDWriterAssets = (() => {
  const map = new Map();
  return {
    add(name, dataURL) { map.set(name, dataURL); },
    list() {
      return Array.from(map.entries()).map(([name, url]) => ({ name, url }));
    },
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    clear() { map.clear(); },
    remove(name) { map.delete(name); },
    size() { return map.size; },
  };
})();

/** 从磁盘 assets/ 目录加载已存在的图片，供侧边栏图片库启动后即可见 */
async function loadAssetsFromDisk() {
  const tab = activeTab();
  const docPath = tab?.path || '';
  if (isNative) {
    send('asset.list', { docPath });
  }
}

/* ============================================================
 * Toast
 * ============================================================ */

let toastTimer = null;
function toast(text, kind = 'info') {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* ============================================================
 * 原生回调
 * ============================================================ */

const nativeHandlers = {
  ready() { boot(); },
  focus() { /* 聚焦时不高亮光标，避免闪烁 */ },

  /**
   * 打开文件 -> 总是新开一个 Tab。
   * 若该路径已在某个 Tab 中打开，则直接切到那个 Tab，不重复打开。
   */
  documentOpened(p) {
    const existing = state.tabs.find((t) => t.path && t.path === p.path);
    if (existing) {
      activateTab(existing.id);
      toast(`${p.name} 已经打开，已切换过去`, 'info');
      return;
    }
    const tab = openTab({
      name: p.name || '未命名',
      path: p.path || '',
      md: p.content || '',
    });
    toast(`已打开 ${tab.name}`, 'ok');
  },

  /**
   * 保存完成 -> 只更新发起保存的那个 Tab（可能不是当前激活的）。
   */
  documentSaved(p) {
    const tab = (p.tabId && state.tabs.find((t) => t.id === p.tabId)) || activeTab();
    if (!tab) return;
    if (p.path) tab.path = p.path;
    if (p.name) tab.name = p.name;
    tab.dirty = false;
    lastSavedAt = Date.now();
    renderTabBar();
    updateDirty();
    toast(`已保存 ${tab.name}`, 'ok');
    // 批量保存：继续下一个
    if (pendingSaveChain) {
      const fn = pendingSaveChain;
      pendingSaveChain = null;
      fn();
    }
    // "保存后关 Tab"：用户选了保存才关闭——这里真正关
    if (pendingCloseAfterSave && pendingCloseAfterSave === tab.id) {
      const id = pendingCloseAfterSave;
      pendingCloseAfterSave = null;
      closeTab(id, false);
    }
  },

  /** 新建文档 -> 新开一个 Tab */
  newDocument() {
    // 用时间戳命名（"草稿 2026-10-13 11:02"），多 Tab 一眼能区分
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `草稿 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    openTab({ name, md: '' });
    toast(`已新建「${name}」`, 'ok');
  },

  /** 依次保存所有未保存的 Tab */
  saveAll() {
    const dirty = state.tabs.filter((t) => t.dirty);
    if (!dirty.length) {
      toast('没有需要保存的文档', 'info');
      return;
    }
    // 原生一次只能弹一个面板，依次保存
    let i = 0;
    let failed = 0;
    const next = () => {
      if (i >= dirty.length) {
        toast(failed > 0
          ? `已保存 ${dirty.length - failed} 个，${failed} 个超时`
          : `已保存 ${dirty.length} 个文档`, failed > 0 ? 'warn' : 'ok');
        return;
      }
      const tab = dirty[i++];
      tab.md = currentMarkdownFor(tab);
      send(tab.path ? 'save' : 'saveAs', {
        content: tab.md, name: tab.name, path: tab.path, tabId: tab.id,
      });
      // watchdog：5s 没拿到 documentSaved 回调就算超时，跳到下一个
      pendingSaveChain = next;
      const myIdx = i - 1;
      setTimeout(() => {
        if (pendingSaveChain === next && dirty[myIdx]?.dirty) {
          failed++;
          pendingSaveChain = null;
          next();
        }
      }, 5000);
    };
    pendingSaveChain = null;
    next();
  },

  /** 示例文档 -> 新开一个 Tab */
  openSample() {
    openTab({ name: '使用说明.md', md: SAMPLE_DOC });
    toast('已打开使用说明', 'ok');
  },

  closeTab() {
    const tab = activeTab();
    if (tab) closeTab(tab.id);
  },

  closeOtherTabs() {
    const tab = activeTab();
    if (!tab) return;
    for (const t of [...state.tabs]) {
      if (t.id !== tab.id) closeTab(t.id);
    }
  },

  switchTab(p) {
    if (p.index != null) switchTabByIndex(p.index);
    else switchTabBy(p.delta ?? 1);
  },

  setMode(p) { setMode(p.mode); },
  setThemeMode(p) {
    state.themeMode = p.mode;
    applyThemeVars();
  },

  zoom(p) { setZoom(p.delta); },

  menuAction(p) {
    switch (p.name) {
      case 'new': nativeHandlers.newDocument(); break;
      case 'sample': nativeHandlers.openSample(); break;
      case 'save': doSave(false); break;
      case 'saveAs': doSave(true); break;
      case 'exportHTML': doExport('html'); break;
      case 'exportPDF': doExport('pdf'); break;
      case 'exportDOCX': doExport('docx'); break;
      case 'exportPNG': doExport('png'); break;
      case 'toggleSidebar': toggleSidebar(); break;
      case 'undo': curWysiwyg()?.el && document.execCommand('undo'); curSource()?.view?.focus(); break;
      case 'redo': curWysiwyg()?.el && document.execCommand('redo'); break;
      case 'preferences': toggleInspector(); break;
      case 'help': showHelp(); break;
      case 'pastePlain': pastePlain(); break;
      case 'closeTab': nativeHandlers.closeTab(); break;
      case 'closeOtherTabs': nativeHandlers.closeOtherTabs(); break;
      case 'nextTab': nativeHandlers.switchTab({ delta: 1 }); break;
      case 'prevTab': nativeHandlers.switchTab({ delta: -1 }); break;
      case 'find': showFindBar(); break;
      default: break;
    }
  },

  format(p) {
    const map = {
      bold: 'bold', italic: 'italic', underline: 'underline', code: 'code',
      h1: 'h1', h2: 'h2', h3: 'h3', p: 'p', ul: 'ul', ol: 'ol',
      quote: 'quote', table: 'table', mermaid: 'mermaid', math: 'math', hr: 'hr',
    };
    const cmd = map[p.name];
    const w = curWysiwyg();
    if (!cmd || !w) return;
    if (cmd === 'quote') { w.exec.snippet('\n> 引用内容\n'); return; }
    w.exec[cmd]?.();
  },

  nativeToast(p) { toast(p.text, p.kind); },
  exportDone(p) { toast(`已导出到 ${p.name}`, 'ok'); },

  saveCancelled(p) {
    // 用户在原生保存面板里点了取消：
    // 如果是"保存后关闭 Tab"的流程，把 pendingCloseAfterSave 清掉，不关 Tab
    if (pendingCloseAfterSave && (!p.tabId || pendingCloseAfterSave === p.tabId)) {
      pendingCloseAfterSave = null;
      toast('保存已取消', 'warn');
    }
  },

  assetSaved(p) { toast(`图片已保存：${p.name}`, 'ok'); },
  assetList(p) {
    // 原生把磁盘 assets/ 目录下的图片以 base64 dataURL 形式回传，统一加入 MDWriterAssets
    const files = p.files || [];
    let added = 0;
    for (const f of files) {
      if (f.dataURL && f.name) {
        window.MDWriterAssets.add(f.name, f.dataURL);
        added++;
      }
    }
    if (added > 0 && state.libraryView === 'images') renderSidebar();
  },
};

function pastePlain() {
  navigator.clipboard.readText().then((text) => {
    if (!text) return;
    const src = curSource();
    const w = curWysiwyg();
    if (state.mode === 'source' && src) {
      const pos = src.view.state.selection.main.head;
      const cur = src.getValue();
      src.setValue(cur.slice(0, pos) + text + cur.slice(pos));
      src.view.focus();
    } else if (w) {
      w.exec.snippet(text);
    }
    markDirty();
  }).catch(() => toast('无法读取剪贴板', 'warn'));
}

function toggleSidebar() {
  state.sidebar = !state.sidebar;
  document.body.classList.toggle('no-sidebar', !state.sidebar);
  renderSidebar();
}

function toggleInspector() {
  document.body.classList.toggle('show-inspector');
}

/* ============================================================
 * 查找 / 替换（Cmd+F 唤起的浮动栏）
 * ============================================================ */

let findBar = null;
let findState = { q: '', matches: [], idx: 0 };

function showFindBar() {
  if (!findBar) {
    findBar = document.createElement('div');
    findBar.className = 'find-bar';
    findBar.innerHTML = `
      <input id="find-input" type="text" placeholder="查找…" autocomplete="off" spellcheck="false">
      <span id="find-count" class="find-count">0</span>
      <button id="find-prev" title="上一个">↑</button>
      <button id="find-next" title="下一个">↓</button>
      <button id="find-replace-toggle" title="替换">⇄</button>
      <button id="find-close" title="关闭">×</button>
      <div id="find-replace-row" class="find-replace-row" hidden>
        <input id="replace-input" type="text" placeholder="替换为…" autocomplete="off" spellcheck="false">
        <button id="find-replace-one" title="替换当前">替换</button>
        <button id="find-replace-all" title="替换全部">全部</button>
      </div>
    `;
    document.body.appendChild(findBar);

    const input = findBar.querySelector('#find-input');
    const replace = findBar.querySelector('#replace-input');
    const prev = findBar.querySelector('#find-prev');
    const next = findBar.querySelector('#find-next');
    const close = findBar.querySelector('#find-close');
    const toggle = findBar.querySelector('#find-replace-toggle');
    const row = findBar.querySelector('#find-replace-row');
    const replaceOne = findBar.querySelector('#find-replace-one');
    const replaceAll = findBar.querySelector('#find-replace-all');

    input.addEventListener('input', () => runFind(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { hideFindBar(); }
    });
    replace.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOneFunc(); }
    });
    prev.addEventListener('click', () => gotoMatch(-1));
    next.addEventListener('click', () => gotoMatch(1));
    close.addEventListener('click', hideFindBar);
    toggle.addEventListener('click', () => { row.hidden = !row.hidden; if (!row.hidden) replace.focus(); });
    replaceOne.addEventListener('click', replaceOneFunc);
    replaceAll.addEventListener('click', replaceAllFunc);
  }

  findBar.classList.add('show');
  const input = findBar.querySelector('#find-input');
  // 预填当前选区文本
  const sel = window.getSelection()?.toString() || '';
  if (sel) input.value = sel;
  input.focus();
  input.select();
  runFind(input.value);
}

/* ============================================================
 * 未保存确认对话框（macOS 风格：保存 / 不保存 / 取消）
 * ============================================================ */

function showDirtyConfirm(tabName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">保存对「${escapeHTML(tabName)}」的修改吗？</div>
        <div class="modal-body">关闭前未保存的修改将会丢失。</div>
        <div class="modal-actions">
          <button data-act="cancel" autofocus>取消</button>
          <button data-act="discard">不保存</button>
          <button data-act="save" class="primary">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (act) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(act);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close('cancel');
      else if (e.key === 'Enter') close(overlay.querySelector('[autofocus]') === document.activeElement ? 'cancel' : 'save');
    };
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) close(btn.dataset.act);
      else if (e.target === overlay) close('cancel');
    });
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[autofocus]')?.focus();
  });
}

function hideFindBar() {
  if (!findBar) return;
  findBar.classList.remove('show');
  clearFindMarks();
  // 焦点还给编辑器
  const tab = activeTab();
  if (state.mode === 'wysiwyg') tab?.wysiwyg?.focus?.();
  else tab?.source?.focus?.();
}

/** 查找匹配：wysiwyg 用 Range，source 用 CodeMirror 选区 */
function runFind(q) {
  clearFindMarks();
  findState.q = q || '';
  findState.matches = [];
  findState.idx = 0;
  if (!findState.q) {
    if (findBar) findBar.querySelector('#find-count').textContent = '0';
    return;
  }
  const tab = activeTab();
  if (!tab) return;

  if (state.mode === 'wysiwyg') {
    const root = tab.wysiwyg.el;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    const qLower = findState.q.toLowerCase();
    for (const tn of nodes) {
      const text = tn.nodeValue.toLowerCase();
      let from = 0, idx;
      while ((idx = text.indexOf(qLower, from)) !== -1) {
        findState.matches.push({ node: tn, start: idx, end: idx + qLower.length });
        from = idx + qLower.length;
      }
    }
  } else if (state.mode === 'source' && tab.source?.view) {
    const view = tab.source.view;
    const doc = view.state.doc.toString().toLowerCase();
    const qLower = findState.q.toLowerCase();
    let from = 0, idx;
    while ((idx = doc.indexOf(qLower, from)) !== -1) {
      findState.matches.push({ from: idx, to: idx + qLower.length });
      from = idx + qLower.length;
    }
  }

  findBar.querySelector('#find-count').textContent =
    findState.matches.length ? `1/${findState.matches.length}` : '0';
  if (findState.matches.length) gotoMatch(0);
}

function clearFindMarks() {
  if (state.mode === 'wysiwyg') {
    document.querySelectorAll('.find-mark').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }
  // source 模式 CodeMirror 自带高亮由视口自动失效
}

function gotoMatch(delta) {
  if (!findState.matches.length) return;
  if (state.mode === 'wysiwyg') {
    clearFindMarks();
    for (let i = 0; i < findState.matches.length; i++) {
      if (i === findState.idx) continue;
      wrapMatch(findState.matches[i], false);
    }
    wrapMatch(findState.matches[findState.idx], true);
    // 滚动到可视区
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const host = activeTab().wysiwyg.el;
      const hostRect = host.getBoundingClientRect();
      const r = range.getBoundingClientRect();
      if (r.top < hostRect.top || r.bottom > hostRect.bottom) {
        host.scrollTop += (r.top + r.bottom) / 2 - (hostRect.top + hostRect.bottom) / 2;
      }
    }
  } else if (state.mode === 'source' && activeTab()?.source?.view) {
    const view = activeTab().source.view;
    const m = findState.matches[findState.idx];
    if (m) {
      view.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true });
      view.focus();
    }
  }
  findState.idx = (findState.idx + delta + findState.matches.length) % findState.matches.length;
  findBar.querySelector('#find-count').textContent =
    `${findState.idx + 1}/${findState.matches.length}`;
}

function wrapMatch(m, active) {
  const tn = m.node;
  if (!tn || !tn.parentNode) return;
  const before = tn.nodeValue.slice(0, m.start);
  const mid = tn.nodeValue.slice(m.start, m.end);
  const after = tn.nodeValue.slice(m.end);
  const beforeNode = document.createTextNode(before);
  const mark = document.createElement('mark');
  mark.className = 'find-mark' + (active ? ' active' : '');
  mark.textContent = mid;
  const afterNode = document.createTextNode(after);
  const parent = tn.parentNode;
  parent.insertBefore(beforeNode, tn);
  parent.insertBefore(mark, tn);
  parent.insertBefore(afterNode, tn);
  parent.removeChild(tn);
  if (active) {
    const r = document.createRange();
    r.selectNodeContents(mark);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

function replaceOneFunc() {
  if (state.mode === 'wysiwyg') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const replacement = findBar.querySelector('#replace-input').value;
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    runFind(findState.q);
  } else if (state.mode === 'source' && activeTab()?.source?.view) {
    const view = activeTab().source.view;
    const m = findState.matches[findState.idx];
    const replacement = findBar.querySelector('#replace-input').value;
    if (m) {
      view.dispatch({
        changes: { from: m.from, to: m.to, insert: replacement },
      });
      runFind(findState.q);
    }
  }
}

function replaceAllFunc() {
  const replacement = findBar.querySelector('#replace-input').value;
  if (state.mode === 'wysiwyg') {
    const root = activeTab().wysiwyg.el;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.toLowerCase().indexOf(findState.q.toLowerCase());
      if (i !== -1) targets.push(n);
    }
    targets.forEach((tn) => { tn.nodeValue = tn.nodeValue.split(findState.q).join(replacement); });
    runFind(findState.q);
    toast(`已替换 ${targets.length} 处`, 'ok');
  } else if (state.mode === 'source' && activeTab()?.source?.view) {
    const view = activeTab().source.view;
    const text = view.state.doc.toString();
    const lower = text.toLowerCase();
    const qLower = findState.q.toLowerCase();
    const changes = [];
    let from = 0, idx;
    while ((idx = lower.indexOf(qLower, from)) !== -1) {
      changes.push({ from: idx, to: idx + qLower.length, insert: replacement });
      from = idx + qLower.length;
    }
    changes.reverse().forEach((c) => view.dispatch({ changes: c }));
    runFind(findState.q);
    toast(`已替换 ${changes.length} 处`, 'ok');
  }
}

function showHelp() {
  const md = `# Markdown 语法速查

## 标题
\`\`\`
# 一级标题
## 二级标题
### 三级标题
\`\`\`

## 强调
**粗体**  *斜体*  ~~删除线~~  \`行内代码\`

## 列表
- 无序列表
- 第二项
  - 嵌套项

1. 有序列表
2. 第二项

- [ ] 待办（未完成）
- [x] 待办（已完成）

## 引用
> 这是一段引用
> 可以有多行

## 表格
| 列A | 列B |
| --- | --- |
| 值1 | 值2 |

## 代码
\`\`\`python
def hello():
    print("hi")
\`\`\`

## 图片
![图片说明](assets/example.png)

## Mermaid 流程图
\`\`\`mermaid
graph LR
  A[开始] --> B{判断}
  B -->|是| C[执行]
  B -->|否| D[结束]
\`\`\`

## 公式
行内公式：$E = mc^2$

块级公式：
$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$
`;
  setMarkdown(md);
  setMode('source');
  toast('已插入语法速查文档', 'ok');
}

/* ============================================================
 * UI 构建
 * ============================================================ */

function buildThemeCards() {
  const el = $('theme-cards');
  if (!el) return;
  el.innerHTML = THEMES.map((t) => `
    <button class="theme-card${t.id === state.themeId ? ' active' : ''}" data-theme-card="${t.id}" title="${t.desc}">
      <span class="theme-dot" style="background:${t.vars['--t-bg']};border-color:${t.vars['--t-border']}"></span>
      <span class="theme-name">${t.label}</span>
    </button>`).join('');

  el.addEventListener('click', (e) => {
    const card = e.target.closest('[data-theme-card]');
    if (!card) return;
    state.themeId = card.dataset.themeCard;
    applyThemeVars();
    scheduleAutosave();
  });
}

function buildFontControls() {
  const fontSel = $('font-select');
  const sizeSel = $('size-select');
  if (!fontSel || !sizeSel) return;

  fontSel.innerHTML = FONTS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
  sizeSel.innerHTML = FONT_SIZES.map((s) => `<option value="${s}">${s}px</option>`).join('');
  fontSel.value = state.fontId;
  sizeSel.value = String(state.fontSize);

  fontSel.addEventListener('change', () => {
    state.fontId = fontSel.value;
    applyThemeVars();
    scheduleAutosave();
  });
  sizeSel.addEventListener('change', () => {
    state.fontSize = Number(sizeSel.value);
    applyThemeVars();
    scheduleAutosave();
  });
}

function wireToolbar() {
  const bar = $('toolbar');
  if (!bar) return;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;

    if (cmd === 'mode') { setMode(btn.dataset.value); return; }
    if (cmd === 'newDoc') { nativeHandlers.newDocument(); return; }
    if (cmd === 'sidebar') { toggleSidebar(); return; }
    if (cmd === 'zoom') { setZoom(Number(btn.dataset.delta)); return; }
    if (cmd === 'export') { doExport(btn.dataset.value); return; }
    if (cmd === 'library') {
      state.libraryView = btn.dataset.value;
      document.querySelectorAll('[data-library]').forEach((b) => b.classList.toggle('active', b.dataset.library === state.libraryView));
      renderSidebar();
      return; }

    // 其余走所见即所得命令
    if (state.mode === 'source') {
      // 源码模式下，格式命令插入对应 markdown
      const md = {
        bold: '**粗体**', italic: '*斜体*', code: '`代码`',
        h1: '\n# 标题\n', h2: '\n## 标题\n', h3: '\n### 标题\n',
        p: '\n正文\n', ul: '\n- 项目\n', ol: '\n1. 项目\n',
        quote: '\n> 引用\n', table: '\n| 列A | 列B |\n| --- | --- |\n| | |\n',
        hr: '\n---\n', mermaid: '\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n',
        math: '\n$$\nE = mc^2\n$$\n',
      }[cmd];
      if (md && curSource()) {
        const src = curSource();
        const pos = src.view.state.selection.main.head;
        const cur = src.getValue();
        src.setValue(cur.slice(0, pos) + md + cur.slice(pos));
        src.view.focus();
        markDirty();
      }
      return;
    }

    const w = curWysiwyg();
    if (w) {
      if (cmd === 'quote') { w.exec.snippet('\n> 引用内容\n'); return; }
      w.exec[cmd]?.();
    }
  });

  // 侧边栏切换
  $('side-tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-library]');
    if (!b) return;
    state.libraryView = b.dataset.library;
    document.querySelectorAll('[data-library]').forEach((x) => x.classList.toggle('active', x.dataset.library === state.libraryView));
    renderSidebar();
  });

  // 点击侧边栏图片插入
  $('sidebar-body')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-url]');
    if (!item) return;
    const md = `![${item.dataset.url.split('/').pop()}](${item.dataset.url})`;
    const src = curSource();
    const w = curWysiwyg();
    if (state.mode === 'source' && src) {
      const pos = src.view.state.selection.main.head;
      const cur = src.getValue();
      src.setValue(cur.slice(0, pos) + md + cur.slice(pos));
      src.view.focus();
    } else if (w) {
      w.exec.snippet(md);
    }
    markDirty();
  });

  // 目录跳转
  $('sidebar-body')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) {
      if (state.mode === 'wysiwyg') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const pre = $('preview');
        pre?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const el = $('preview')?.querySelector(a.getAttribute('href'));
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
}

/* ============================================================
 * 示例文档
 * ============================================================ */

const SAMPLE_DOC = `# MD Writer 使用指南

欢迎使用 **MD Writer** —— 一个原生的 macOS Markdown 编辑器，支持像 Word 一样直接排版，也能随时切到源码。

> 左边写，右边看。所有格式一键导出：HTML、PDF、Word、PNG。

## 多标签页

每个文件都是独立标签页，内容、撤销栈、滚动位置互不干扰。

| 快捷键 | 操作 |
| --- | --- |
| \`⌘N\` | 新建标签页 |
| \`⌘O\` | 打开文件（自动开新标签） |
| \`⌘W\` | 关闭当前标签页 |
| \`⌥⇧⌘W\` | 关闭其他标签页 |
| \`⇧⌘]\` / \`⇧⌘[\` | 下一个 / 上一个标签页 |
| \`⌘1\` … \`⌘9\` | 跳转到第 N 个标签页 |

> 重复打开同一文件会自动切到已有标签，不会重复打开。
> 也可以用鼠标中键关闭标签、双击标签栏空白处新建。

## 三个编辑模式

| 快捷键 | 模式 | 说明 |
| --- | --- | --- |
| \`⌥⌘1\` | 所见即所得 | 像 Word 一样排版，所见即所得 |
| \`⌥⌘2\` | Markdown 源码 | 带语法高亮的源码编辑 |
| \`⌥⌘3\` | 分栏 | 左边源码，右边实时预览 |

## 常用快捷键

- **\`⌘B\` / \`⌘I\` / \`⌘U\`** — 粗体 / 斜体 / 下划线
- **\`⌘S\`** — 保存当前标签，**\`⇧⌘S\`** — 另存为
- **\`⌘⇧E\`** — 导出 HTML，**\`⌥⌘E\`** — 导出 Word
- **\`⌘⇧M\`** — 插入 Mermaid 流程图
- **\`⌘⇧G\`** — 插入图片（也可直接粘贴或拖入）
- **\`⌘,\`** — 打开检视器，换主题 / 字体 / 字号

## 排版元素

### 列表与待办

- [x] 支持所见即所得编辑
- [x] 支持源码 / 分栏切换
- [ ] 支持协同编辑（规划中）

1. 有序列表
2. 第二项
   - 嵌套项

### 代码高亮

\`\`\`javascript
function hello(name) {
  return \`你好，\${name}！\`;
}
console.log(hello("Markdown"));
\`\`\`

### 流程图

\`\`\`mermaid
graph TD
  A[写 Markdown] --> B{需要配图?}
  B -->|是| C[Mermaid 画图]
  B -->|否| D[直接排版]
  C --> D
  D --> E[导出]
\`\`\`

### 数学公式

行内公式：欧拉恒等式 $e^{i\\pi} + 1 = 0$

块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## 引用与强调

> Markdown 的优势在于：源文件是纯文本，任何编辑器都能打开，任何平台都能迁移。

可以用 **粗体** 强调重点，用 *斜体* 轻轻带过，用 ~~删除线~~ 标记废弃内容，用 ==高亮== 标注重点。

---

准备好了就开始写。右侧的「目录」会自动跟着标题更新。
`;

/* ============================================================
 * 启动
 * ============================================================ */

function boot() {
  if (window.__booted) return;
  window.__booted = true;

  buildThemeCards();
  buildFontControls();
  wireToolbar();
  wireTabBar();
  applyThemeVars();
  setMode('wysiwyg');

  // 恢复上次的 Tab 列表；没有草稿则开一个使用说明
  const draft = restoreDraft();
  // 启动恢复阶段屏蔽 setTitle，避免批量触发原生 titlebar 抖动
  suppressDirtyTitle = true;
  try {
    if (draft?.tabs?.length) {
      state.themeId = draft.themeId || state.themeId;
      state.fontId = draft.fontId || state.fontId;
      state.fontSize = draft.fontSize || state.fontSize;
      state.themeMode = draft.themeMode || state.themeMode;
      state.tocDepth = draft.tocDepth || state.tocDepth;
      state.sidebar = draft.sidebar !== false; // 默认 true
      state.libraryView = draft.libraryView || state.libraryView;
      document.body.classList.toggle('no-sidebar', !state.sidebar);

      for (const t of draft.tabs) {
        openTab({
          name: t.name || '未命名',
          path: t.path || '',
          md: t.md || '',
          dirty: !!t.dirty,
          activate: false,
        });
      }
      const idx = Math.min(draft.activeIndex ?? 0, state.tabs.length - 1);
      activateTab(state.tabs[idx].id);
      toast(`已恢复 ${state.tabs.length} 个文档`, 'ok');
      // 给用户 8 秒的"撤销恢复"机会
      offerRestoreUndo();
    } else {
      // 首次启动：给一份使用说明
      openTab({ name: '使用说明.md', md: SAMPLE_DOC });
      toast('就绪。⌘N 新建，⌘O 打开，每个文件都是独立标签页', 'ok');
    }
  } finally {
    suppressDirtyTitle = false;
  }
  // 统一发一次 setTitle
  updateDirty();

  renderTabBar();
  updateStats();

  // 启动时把磁盘 assets/ 里的图片加载到内存资源库，
  // 让侧边栏图片库立即可用，而不是只有本次会话粘贴过的图片
  loadAssetsFromDisk();

  // 拖拽图片到窗口：插入到当前 Tab
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
    const tabId = state.activeTabId;
    files.forEach((f) => handleImageFile(f, tabId));
  });

  // 系统主题变化
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeVars);

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === ',') {
      e.preventDefault();
      toggleInspector();
      return;
    }
    // ⌘W 关闭当前 Tab
    if (meta && e.key.toLowerCase() === 'w' && !e.shiftKey) {
      e.preventDefault();
      nativeHandlers.closeTab();
      return;
    }
    // ⌘T 新建 Tab
    if (meta && e.key.toLowerCase() === 't' && !e.shiftKey) {
      e.preventDefault();
      nativeHandlers.newDocument();
      return;
    }
    // ⌘⇧] / ⌘⇧[ 切换 Tab
    if (meta && e.shiftKey && (e.key === ']' || e.key === '}')) {
      e.preventDefault();
      nativeHandlers.switchTab({ delta: 1 });
      return;
    }
    if (meta && e.shiftKey && (e.key === '[' || e.key === '{')) {
      e.preventDefault();
      nativeHandlers.switchTab({ delta: -1 });
      return;
    }
    // ⌘1..9 跳到第 N 个 Tab（浏览器环境下也能用）
    if (meta && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      nativeHandlers.switchTab({ index: Number(e.key) });
      return;
    }
    // ⌥⌘1..3 切换视图模式（与 Tab 快捷键区分开）
    if (meta && e.altKey && /^[1-3]$/.test(e.key)) {
      e.preventDefault();
      setMode(['wysiwyg', 'source', 'split'][Number(e.key) - 1]);
    }
  });

  // 检视器：预览目录开关
  $('opt-toc')?.addEventListener('change', (e) => {
    state.toc = e.target.checked;
    renderPreview();
  });
  // 检视器：目录深度
  const tocDepthSel = $('toc-depth-select');
  if (tocDepthSel) {
    tocDepthSel.value = String(state.tocDepth);
    tocDepthSel.addEventListener('change', (e) => {
      state.tocDepth = Number(e.target.value);
      renderPreview();
      renderSidebar();
      scheduleAutosave();
    });
  }

  // 光标位置实时更新（节流）
  let cursorTimer = null;
  const bumpCursor = () => {
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => updateCursorPos(activeTab(), currentMarkdown()), 120);
  };
  document.addEventListener('selectionchange', bumpCursor);
  document.addEventListener('keyup', bumpCursor);
  document.addEventListener('mouseup', bumpCursor);
}

/** Tab 栏交互：点击切换、点 × 关闭、中键关闭、拖拽排序 */
function wireTabBar() {
  const bar = $('tab-bar');
  if (!bar) return;

  let dragId = null;

  bar.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      e.stopPropagation();
      // 点 × 直接关，不弹确认（这是用户明确意图）
      closeTab(closeBtn.dataset.close, false);
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) activateTab(tab.dataset.tab);
  });

  // 中键关闭 Tab（macOS 习惯）
  bar.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      e.preventDefault();
      closeTab(tab.dataset.tab, false);
    }
  });

  // 双击 Tab 空白处新建
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab')) return;
    nativeHandlers.newDocument();
  });

  /* ---------- 拖拽排序 ---------- */
  bar.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    dragId = tab.dataset.tab;
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 需要设置数据才会触发 drag
    e.dataTransfer.setData('text/plain', dragId);
  });

  bar.addEventListener('dragend', (e) => {
    e.target.closest('.tab')?.classList.remove('dragging');
    bar.querySelectorAll('.tab').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
    dragId = null;
  });

  bar.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('[data-tab]');
    bar.querySelectorAll('.tab').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
    if (!target || target.dataset.tab === dragId) return;

    // 判断落在左半还是右半，决定插到前面还是后面
    const r = target.getBoundingClientRect();
    const after = (e.clientX - r.left) > r.width / 2;
    target.classList.add(after ? 'drop-after' : 'drop-before');
  });

  bar.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const target = e.target.closest('[data-tab]');
    if (!target || target.dataset.tab === dragId) return;

    const r = target.getBoundingClientRect();
    const after = (e.clientX - r.left) > r.width / 2;
    let to = state.tabs.findIndex((t) => t.id === target.dataset.tab);
    // 若落在后面，插入位置要 +1（移除源后索引会前移）
    if (after) to += 1;

    const movingId = dragId;
    dragId = null;
    moveTab(movingId, to);
  });
}

// 原生环境下由 ready 触发；浏览器预览下直接启动
if (isNative) {
  // 兜底：若原生 ready 未到达，1.5s 后自行启动
  setTimeout(boot, 1500);
} else {
  boot();
}

// 供原生在合适时机再次触发
window.__mdwriterBoot = boot;