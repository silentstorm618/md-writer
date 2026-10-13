/**
 * Markdown -> HTML 渲染引擎。
 * 关键点：与导出管线共用同一套渲染，保证「所见即所得」和导出结果一致。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import { t as tr } from './i18n.js';

/* ---------- 工具 ---------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 转义 HTML 属性值：除了 & < > 外还要处理 " '，避免属性注入闭合 */
function escapeAttr(s) {
  return escapeHtml(s);
}

function sanitizeUrl(url) {
  const s = String(url || '').trim();
  // 拦截已知危险 scheme / 子类型：
  //   javascript: / vbscript:      — 脚本执行
  //   data:text/html               — 文档可执行脚本
  //   data:image/svg+xml           — SVG 可内嵌 <script>、onload 等，XSS 入口
  //   file:                        — 任意本地文件读取，与 allowFileAccessFromFileURLs 串联更危险
  // 其他 data:image/(png|jpe?g|gif|webp) 仍允许（图片内嵌用 base64 是合理用法）。
  if (/^(javascript|vbscript):/i.test(s)) return '#';
  if (/^data:text\/html/i.test(s)) return '#';
  if (/^data:image\/svg/i.test(s)) return '#';
  if (/^file:/i.test(s)) return '#';
  return s;
}

/* ---------- 数学公式 ---------- */

/**
 * 文本 -> 数学片段。
 * 约定：$...$ 行内公式，$$...$$ 独立公式。
 * 先把公式抠出来占位，避免 marked 内部的转义把反斜杠吃掉。
 */
function protectMath(text) {
  const store = [];
  const put = (html) => {
    store.push(html);
    return `\u0000MATH${store.length - 1}\u0000`;
  };

  // 块级 $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    try {
      return put(katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      return put(`<pre class="md-math-error">${tr('render.mathError', { expr: escapeHtml(expr) })}</pre>`);
    }
  });

  // 行内 $...$：要求内容不含换行、且不以空白开头
  text = text.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, expr) => {
    try {
      return put(katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      return put(`<code class="md-math-error">${escapeHtml(expr)}</code>`);
    }
  });

  return { text, store };
}

function restoreMath(text, store) {
  return text.replace(/\u0000MATH(\d+)\u0000/g, (_, i) => store[Number(i)] ?? '');
}

/* ---------- 渲染器 ---------- */

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }) {
  const language = (lang || '').match(/^\S*/)?.[0] || '';

  // Mermaid 单独处理，导出时会被替换为 SVG
  if (language === 'mermaid') {
    return `<div class="md-mermaid" data-mermaid="${escapeHtml(text)}">${escapeHtml(text)}</div>`;
  }

  let body;
  try {
    body = language && hljs.getLanguage(language)
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value
      : hljs.highlightAuto(text).value;
  } catch {
    body = escapeHtml(text);
  }
  const label = language ? `<span class="md-code-lang">${escapeHtml(language)}</span>` : '';
  return `<pre class="md-code">${label}<code class="hljs${language ? ` language-${escapeHtml(language)}` : ''}">${body}</code></pre>`;
};

renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const external = /^(https?:)?\/\//i.test(href || '');
  const safe = sanitizeUrl(href);
  return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ''}${
    external ? ' target="_blank" rel="noreferrer noopener"' : ''
  }>${text}</a>`;
};

renderer.image = function ({ href, title, text }) {
  const safe = sanitizeUrl(href);
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text || '')}"${
    title ? ` title="${escapeHtml(title)}"` : ''
  } loading="lazy">`;
};

renderer.checkbox = function ({ checked }) {
  return `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
};

renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  return `<h${depth} id="${slugify(this.parser.parse(tokens, this.parser.textRenderer))}">${text}</h${depth}>`;
};

marked.use({ renderer, gfm: true, breaks: false });

/** 标题锚点 slug */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/* ---------- 净化 ---------- */

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'align', 'loading', 'checked', 'disabled', 'type', 'open', 'id', 'start', 'data-mermaid', 'class'],
  // 只放行安全 scheme：https/http(s)、mailto、tel、片段、相对路径（含项目内 assets/）。
  // 不放行 file:（任意本地文件读取）、data:（DOM 层兜底，data:image/svg+xml 仍有 XSS 风险）。
  // data:image 仅限 png/jpeg/gif/webp，避免 SVG 通过 data: 进来。
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{1,2}\/|assets\/|data:image\/(?:png|jpe?g|gif|webp)[;,])/i,
  // 显式禁掉 SVG / math：即便 DOMPurify 默认会过滤 onload，标签本身仍可能含
  // foreignObject / xlink:href 等二次攻击面。我们没有 SVG 用例，直接禁掉最稳。
  FORBID_TAGS: ['svg', 'math', 'foreignObject'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onanimationstart'],
};

/* ---------- 对外 API ---------- */

/**
 * 把 markdown 渲染成 HTML 字符串（含公式）。
 * @param {string} md
 * @param {{sanitize?: boolean, mermaidMode?: boolean}} opts
 */
export function renderMarkdown(md, opts = {}) {
  const { sanitize = true } = opts;
  if (!md) return '';

  const { text: protectedText, store } = protectMath(String(md));
  let html = marked.parse(protectedText);

  html = restoreMath(html, store);

  if (sanitize) {
    html = DOMPurify.sanitize(html, PURIFY_CONFIG);
  }
  return html;
}

/** 渲染到 DOM 元素，并异步处理 mermaid */
export async function renderInto(el, md, opts = {}) {
  el.innerHTML = renderMarkdown(md, opts);
  await renderMermaidIn(el);
  return el;
}

/* ---------- Mermaid ---------- */

let mermaidPromise = null;
let mermaidReady = false;

/** 懒加载 mermaid（首屏不拖慢） */
export async function ensureMermaid() {
  if (mermaidReady) return true;
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      try {
        const mod = await import('mermaid');
        const mermaid = mod.default;
        // mermaid 不支持 CSS 变量；用 getComputedStyle 取真实字体栈
        const fontFamily = getComputedStyle(document.documentElement)
          .getPropertyValue('--t-font-family').trim()
          || '-apple-system, "PingFang SC", sans-serif';
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
          // strict：禁用 mermaid 渲染产物的 click 与外链脚本能力。
          // 避免恶意 .md 文件通过 mermaid 语法（节点 click、链接）触发脚本执行
          // 或在导出的 SVG / PNG 里留下可被二次打开执行的内容。
          securityLevel: 'strict',
          fontFamily,
        });
        window.__mermaid = mermaid;
        mermaidReady = true;
        return true;
      } catch (e) {
        console.warn('[md-writer] mermaid 加载失败', e);
        return false;
      }
    })();
  }
  return mermaidPromise;
}

/** 把容器内的 .md-mermaid 占位替换为 SVG */
export async function renderMermaidIn(container) {
  const nodes = container.querySelectorAll('.md-mermaid:not([data-processed])');
  if (!nodes.length) return;

  const ok = await ensureMermaid();
  if (!ok) return;

  for (const node of nodes) {
    const code = node.dataset.mermaid || node.textContent;
    try {
      const { svg } = await window.__mermaid.render(
        `mmd_${Math.random().toString(36).slice(2, 9)}`,
        code
      );
      node.innerHTML = svg;
      node.dataset.processed = '1';
      node.classList.add('md-mermaid-ok');
    } catch (e) {
      node.classList.add('md-mermaid-error');
      node.innerHTML = `<pre class="md-mermaid-src">${escapeHtml(code)}</pre>
        <div class="md-mermaid-tip">${tr('render.mermaidError', { msg: escapeHtml(e.message || '') })}</div>`;
    }
  }
}

/** 统计信息：字数、行数、阅读时长 */
export function stats(md) {
  const text = String(md || '');
  const chars = text.replace(/\s+/g, '').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // 中文按字数、英文按词数估算阅读时间
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const minutes = Math.max(1, Math.round(cjk / 400 + (words - cjk / 2) / 200));
  return {
    chars,
    words,
    lines: text ? text.split('\n').length : 0,
    minutes,
  };
}

export { escapeHtml, escapeAttr, sanitizeUrl };