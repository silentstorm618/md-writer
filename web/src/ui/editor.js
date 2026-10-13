/**
 * 所见即所得编辑器。
 *
 * 实现思路：
 *  - 编辑区是一个 contenteditable；
 *  - 输入过程中不打断光标（不做全量 re-render），只在结构变化时做局部同步；
 *  - 序列化用浏览器内置的 execCommand('formatBlock'/'bold'/...)，
 *    HTML -> Markdown 用自己的 DOM 序列化器，产出干净的 Markdown。
 */
import { slugify, escapeAttr, sanitizeUrl } from '../core/renderer.js';
import { t as tr } from '../core/i18n.js';

export function createWYSIWYG(host, opts = {}) {
  const { onChange = () => {}, onCommand = () => {}, onPasteHTML = null, ensureTurndown = null } = opts;

  host.classList.add('wysiwyg');
  host.setAttribute('contenteditable', 'true');
  host.setAttribute('spellcheck', 'false');
  host.innerHTML = '<p><br></p>';

  let suppress = false;
  let lastHTML = '';

  /* ---------- 序列化：Markdown -> HTML ---------- */

  /**
   * 行内节点 -> Markdown。
   * marks 数组记录外层强调（如 ['strong','em']），按从内到外的顺序包裹。
   */
  function inlineToMarkdownNodes(nodes, marks = []) {
    let out = '';
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        let t = node.textContent.replace(/\u00a0/g, ' ');
        if (!t) continue;
        // 转义会影响 Markdown 语义的字符
        t = t.replace(/([\\`*_[\]])/g, '\\$1');
        out += applyMarks(t, marks);
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toLowerCase();

      switch (tag) {
        case 'br':
          out += '\n';
          break;
        case 'strong': case 'b':
          out += inlineToMarkdownNodes(node.childNodes, [...marks, 'strong']);
          break;
        case 'em': case 'i':
          out += inlineToMarkdownNodes(node.childNodes, [...marks, 'em']);
          break;
        case 'u':
          // Markdown 无下划线语法，用 HTML 保留（兼容性最好的做法）
          out += `<u>${inlineToMarkdownNodes(node.childNodes, marks)}</u>`;
          break;
        case 's': case 'strike': case 'del':
          out += inlineToMarkdownNodes(node.childNodes, [...marks, 'del']);
          break;
        case 'code':
          out += applyMarks(node.textContent, [...marks, 'code']);
          break;
        case 'a': {
          const href = node.getAttribute('href') || '';
          const text = inlineToMarkdownNodes(node.childNodes, marks) || href;
          out += `[${text}](${href})`;
          break;
        }
        case 'img': {
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || '';
          out += `![${alt}](${src})`;
          break;
        }
        case 'span': {
          if (node.classList.contains('md-math')) {
            const latex = node.dataset?.latex || node.textContent;
            out += node.dataset?.display === 'block' ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
          } else {
            out += inlineToMarkdownNodes(node.childNodes, marks);
          }
          break;
        }
        default:
          out += inlineToMarkdownNodes(node.childNodes, marks);
      }
    }
    return out;
  }

  /** 用 Markdown 强调符号包裹文本：code 优先，其���按 em -> strong -> del */
  function applyMarks(text, marks) {
    if (!text) return text;
    let out = text;
    const has = (m) => marks.includes(m);
    // code 内不能再套其他强调
    if (has('code')) return `\`${out.replace(/`/g, '\\`')}\``;
    if (has('del')) out = `~~${out}~~`;
    if (has('strong')) out = `**${out}**`;
    if (has('em')) out = `*${out}*`;
    return out;
  }

  /** Markdown -> 编辑区的 HTML（所见即所得的初始渲染） */
  function markdownToEditorHTML(md) {
    return renderMarkdownIntoEditor(md);
  }

  /* ---------- 序列化：HTML -> Markdown ---------- */

  function blockToMarkdown(el, depth = 0) {
    const pad = '  '.repeat(depth);

    // 列表项特殊处理
    if (el.matches('li')) {
      const isTask = el.querySelector(':scope > input[type=checkbox]');
      // 直接把原始子节点交给 inlineToMarkdownNodes，让它按元素类型分发
      // （<strong>/<code>/<a> 等才能正确还原成 Markdown 标记）。
      // 注意：不能取 clone.childNodes，那会跳过元素分发导致强调/代码丢失。
      const content = Array.from(el.childNodes).filter((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return true;
        if (n.matches('input[type=checkbox]')) return false;
        // 嵌套列表单独处理
        return !n.matches('ul,ol');
      });
      let text = inlineToMarkdownNodes(content).trim();

      // 嵌套列表
      const nested = Array.from(el.children).filter((c) => c.matches('ul,ol'));
      for (const n of nested) {
        text += '\n' + blockToMarkdown(n, depth + 1);
      }
      return { text, isTask, depth };
    }

    const tag = el.tagName?.toLowerCase();

    switch (tag) {
      case 'h1': return { text: `# ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'h2': return { text: `## ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'h3': return { text: `### ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'h4': return { text: `#### ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'h5': return { text: `##### ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'h6': return { text: `###### ${inlineToMarkdownNodes(el.childNodes).trim()}`, depth };
      case 'blockquote': {
        const inner = Array.from(el.children)
          .map((c) => blockToMarkdown(c, depth).text)
          .filter(Boolean)
          .join('\n');
        return { text: inner.split('\n').map((l) => `> ${l}`).join('\n'), depth };
      }
      case 'pre': {
        const code = el.querySelector('code');
        const text = (code || el).textContent.replace(/\n$/, '');
        const lang = el.querySelector('.md-code-lang')?.textContent?.trim() || '';
        return { text: '```' + lang + '\n' + text + '\n```', depth };
      }
      case 'hr':
        return { text: '---', depth };
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (!rows.length) return { text: '', depth };
        const toCells = (tr) => Array.from(tr.children).map((td) => inlineToMarkdownNodes(td.childNodes).trim().replace(/\|/g, '\\|'));
        const head = toCells(rows[0]);
        const lines = [
          `| ${head.join(' | ')} |`,
          `| ${head.map(() => '---').join(' | ')} |`,
          ...rows.slice(1).map((tr) => `| ${toCells(tr).join(' | ')} |`),
        ];
        return { text: lines.join('\n'), depth };
      }
      case 'ul': case 'ol': {
        const ordered = tag === 'ol';
        const items = Array.from(el.children).filter((c) => c.matches('li'));
        const lines = [];
        items.forEach((li, i) => {
          const r = blockToMarkdown(li, depth);
          const marker = ordered ? `${i + 1}. ` : '- ';
          const taskMark = r.isTask ? `[${r.isTask.checked ? 'x' : ' '}] ` : '';
          lines.push(pad + marker + taskMark + r.text);
        });
        return { text: lines.join('\n'), depth };
      }
      case 'figure': {
        const img = el.querySelector('img');
        const cap = el.querySelector('figcaption');
        if (img) {
          return { text: `![${cap?.textContent?.trim() || ''}](${img.getAttribute('src')})`, depth };
        }
        break;
      }
      default: {
        // 段落类
        const cls = el.className || '';
        if (cls.includes('md-mermaid')) {
          const code = el.dataset?.mermaid || el.textContent?.trim() || '';
          return { text: '```mermaid\n' + code + '\n```', depth };
        }
        if (cls.includes('md-code')) {
          const code = el.querySelector('code')?.textContent || '';
          const lang = el.querySelector('.md-code-lang')?.textContent || '';
          return { text: '```' + lang + '\n' + code + '\n```', depth };
        }
        if (el.querySelector?.('img') && !el.querySelector('p')) {
          const img = el.querySelector('img');
          return { text: `![${img.getAttribute('alt') || ''}](${img.getAttribute('src')})`, depth };
        }
        const text = inlineToMarkdownNodes(el.childNodes).trim();
        return { text, depth };
      }
    }

    // 兜底：取文本
    return { text: inlineToMarkdownNodes(el.childNodes || []).trim(), depth };
  }

  /** 编辑区 HTML -> Markdown */
  function htmlToMarkdown() {
    const blocks = Array.from(host.children);
    const parts = [];
    for (const el of blocks) {
      const { text } = blockToMarkdown(el, 0);
      if (text != null) parts.push(text);
    }
    return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- Markdown -> 编辑器 HTML ---------- */

  /** 轻量渲染，专供编辑器使用（不含 mermaid/katex 异步部分） */
  function renderMarkdownIntoEditor(md) {
    const lines = String(md || '').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      const fence = line.match(/^```(\S*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        if (lang === 'mermaid') {
          out.push(`<div class="md-mermaid" data-mermaid="${escapeAttr(buf.join('\n'))}"><pre class="md-mermaid-src">${escapeHTML(buf.join('\n'))}</pre></div>`);
        } else {
          out.push(`<pre class="md-code"><span class="md-code-lang">${escapeHTML(lang)}</span><code>${escapeHTML(buf.join('\n'))}</code></pre>`);
        }
        continue;
      }

      // 公式块
      if (/^\$\$.*\$?$/.test(line.trim()) && line.trim().startsWith('$$')) {
        const buf = [];
        if (line.trim() !== '$$') {
          buf.push(line.trim().slice(2, -2));
          i++;
        } else {
          i++;
          while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) {
            buf.push(lines[i]);
            i++;
          }
          i++;
        }
        out.push(`<p class="md-math-block" data-latex="${escapeAttr(buf.join('\n'))}">${escapeHTML(buf.join('\n'))}</p>`);
        continue;
      }

      // 表格
      if (line.includes('|') && lines[i + 1]?.match(/^\s*\|?[\s:|-]+\|[\s:|-]*$/)) {
        const rows = [];
        const toRow = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = toRow(line);
        i += 2;
        while (i < lines.length && lines[i].includes('|')) {
          rows.push(toRow(lines[i]));
          i++;
        }
        out.push(
          `<table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('') +
          `</tbody></table>`
        );
        continue;
      }

      // 分隔线
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        const inner = renderMarkdownIntoEditor(buf.join('\n'));
        out.push(`<blockquote>${inner}</blockquote>`);
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          let raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
          // 任务列表
          const task = raw.match(/^\[([ xX])\]\s+/);
          if (task) {
            raw = raw.replace(/^\[([ xX])\]\s+/, '');
            items.push(`<li class="md-task"><input type="checkbox"${task[1].toLowerCase() === 'x' ? ' checked' : ''}>${inlineMd(raw)}</li>`);
          } else {
            items.push(`<li>${inlineMd(raw)}</li>`);
          }
          i++;
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }

      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
        i++;
        continue;
      }

      // 空行
      if (!line.trim()) {
        i++;
        continue;
      }

      // 段落（连续非空行合并）
      const buf = [];
      while (
        i < lines.length && lines[i].trim() &&
        !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i]) &&
        !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.length) {
        out.push(`<p>${inlineMd(buf.join('\n'))}</p>`);
      } else {
        i++;
      }
    }

    return out.join('') || '<p><br></p>';
  }

  /** 行内 Markdown -> HTML（编辑器用） */
  function inlineMd(text) {
    let t = escapeHTML(String(text));
    // 代码
    t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // 图片 —— src 必须走 sanitizeUrl + escapeAttr，阻断 javascript:/data:/file:
    // 防止 ![a](x" onerror=…) 这类写法借未转义的双引号闭合属性注入
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, alt, src, title) => `<img src="${escapeAttr(sanitizeUrl(src))}" alt="${escapeAttr(alt)}"${title ? ` title="${escapeAttr(title)}"` : ''}>`);
    // 链接 —— href 同样过滤
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, label, href, title) => `<a href="${escapeAttr(sanitizeUrl(href))}"${title ? ` title="${escapeAttr(title)}"` : ''}>${label}</a>`);
    // 粗斜体
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    t = t.replace(/~~(.+?)~~/g, '<s>$1</s>');
    // 行内公式
    t = t.replace(/(?<![\w$])\$([^$\n]+?)\$(?![\w$])/g,
      (_, c) => `<span class="md-math" data-latex="${c.replace(/"/g, '&quot;')}">${c}</span>`);
    // 换行
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 事件 ---------- */

  let timer = null;
  function scheduleChange() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const md = htmlToMarkdown();
      onChange(md);
    }, 220);
  }

  host.addEventListener('input', () => {
    if (suppress) return;
    scheduleChange();
  });

  host.addEventListener('blur', () => {
    clearTimeout(timer);
    onChange(htmlToMarkdown());
  });

  // 粘贴：优先把富文本转 Markdown（保证后续以 MD 源码形式存在，避免格式污染）
  // 退路：turndown 还没加载完时，先插入清洗过的 HTML；下一帧再被 onChange 序列化
  host.addEventListener('paste', async (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html && onPasteHTML) {
      let md = onPasteHTML(html);
      // onPasteHTML 返回 null 表示 turndown 未就绪，触发懒加载并先用 sanitize HTML 顶替
      if (md == null && ensureTurndown) {
        // 异步准备 turndown，下一次粘贴生效；当前这次先走 sanitize
        ensureTurndown().catch(() => {});
        document.execCommand('insertHTML', false, sanitizePastedHTML(html));
      } else if (md != null) {
        // 转出来的是 MD 源码片段，直接作为 MD 插入（用 snippet 走 setMarkdown 的渲染路径）
        insertMarkdownSnippet('\n' + md.trim() + '\n');
      } else {
        document.execCommand('insertHTML', false, sanitizePastedHTML(html));
      }
    } else if (html) {
      document.execCommand('insertHTML', false, sanitizePastedHTML(html));
    } else if (text) {
      document.execCommand('insertText', false, text);
    }
    scheduleChange();
  });

  // 图片粘贴
  host.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) opts.onImage?.(file);
    }
  }, true);

  // 图片拖入 + 拦截所有 dragover，避免文件被浏览器打开
  host.addEventListener('dragover', (e) => e.preventDefault());
  host.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => opts.onImage?.(f));
    } else {
      // 非图片：阻止浏览器跳转到该 URL
      e.preventDefault();
    }
  });

  // 回车：空列表项时退出列表（Word 式手感）
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return;
      const li = closest(sel.anchorNode, 'li');
      if (li && !li.textContent.trim() && !li.querySelector('img')) {
        e.preventDefault();
        const parent = li.parentElement;
        li.remove();
        if (parent && !parent.children.length) parent.remove();
        insertParagraphAfter(parent?.previousElementSibling || null);
      }
      return;
    }

    // 快捷键
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    const key = e.key.toLowerCase();
    const map = {
      b: 'bold', i: 'italic', u: 'underline',
      '`': 'code',
    };
    if (key === '`') {
      e.preventDefault();
      execInline('code');
    } else if (['b', 'i', 'u'].includes(key)) {
      e.preventDefault();
      execInline(map[key]);
    } else if (e.key === '`') {
      e.preventDefault();
    } else if (key === 'k') {
      e.preventDefault();
      insertLink();
    }
  });

  function closest(node, sel) {
    let n = node;
    while (n && n !== host) {
      if (n.nodeType === 1 && n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function insertParagraphAfter(after) {
    host.focus();
    if (!after) {
      document.execCommand('insertHTML', false, '<p><br></p>');
      return;
    }
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    after.after(p);
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* ---------- 对外的编辑指令 ---------- */

  function execInline(cmd, value = null) {
    host.focus();
    document.execCommand(cmd, false, value);
    scheduleChange();
  }

  function execBlock(tag) {
    host.focus();
    // execCommand 的 formatBlock 在部分 WebKit 版本需带尖括号
    try { document.execCommand('formatBlock', false, tag); }
    catch { document.execCommand('formatBlock', false, `<${tag}>`); }
    scheduleChange();
  }

  function execList(ordered) {
    host.focus();
    document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
    scheduleChange();
  }

  function insertLink() {
    const sel = window.getSelection();
    const text = sel?.toString() || '';
    const raw = prompt(tr('editor.linkPrompt'), 'https://');
    if (!raw) return;
    // 阻断 javascript: / data: / file: 等危险 scheme，避免 prompt 直接喂出 XSS
    const url = sanitizeUrl(raw);
    host.focus();
    if (text) {
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand('insertHTML', false, `<a href="${escapeAttr(url)}">${escapeAttr(url)}</a>`);
    }
    scheduleChange();
  }

  function insertTable(rows = 3, cols = 3) {
    host.focus();
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) html += `<th>标题 ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td><br></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    scheduleChange();
  }

  function insertMermaid() {
    host.focus();
    const snippet = `\n\`\`\`mermaid\ngraph TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n  C --> D\n\`\`\`\n`;
    insertMarkdownSnippet(snippet);
  }

  function insertMath() {
    host.focus();
    insertMarkdownSnippet('\n$$\nE = mc^2\n$$\n');
  }

  function insertHR() {
    host.focus();
    document.execCommand('insertHTML', false, '<hr><p><br></p>');
    scheduleChange();
  }

  function insertImageHTML(html) {
    host.focus();
    document.execCommand('insertHTML', false, `<p>${html}</p><p><br></p>`);
    scheduleChange();
  }

  /** 插入一段 Markdown 源码（先渲染成 HTML 再插入） */
  function insertMarkdownSnippet(md) {
    const html = renderMarkdownIntoEditor(md.trim());
    host.focus();
    document.execCommand('insertHTML', false, html);
    scheduleChange();
  }

  function sanitizePastedHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,meta,link').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'checked', 'disabled', 'type'].includes(a.name)) {
          el.removeAttribute(a.name);
        }
      });
    });
    return doc.body.innerHTML;
  }

  /* ---------- API ---------- */

  return {
    el: host,
    getMarkdown: () => htmlToMarkdown(),
    /**
     * 程序化载入内容。
     * 注意：这里刻意不触发 onChange —— 载入不是用户编辑，
     * 若回调会让上层把文档标记为「已修改」并回写草稿，
     * 在 setMode/setMarkdown 之间会形成自激回路。
     */
    setMarkdown(md) {
      suppress = true;
      host.innerHTML = renderMarkdownIntoEditor(md);
      lastHTML = host.innerHTML;
      suppress = false;
    },
    getHTML: () => host.innerHTML,
    focus: () => host.focus(),
    /** 卸载：清掉 input 防抖 timer，避免关闭后回调还在跑 */
    destroy() {
      clearTimeout(timer);
      timer = null;
    },
    exec: {
      bold: () => execInline('bold'),
      italic: () => execInline('italic'),
      underline: () => execInline('underline'),
      strike: () => execInline('strikeThrough'),
      code: () => execInline('code'),
      h1: () => execBlock('h1'),
      h2: () => execBlock('h2'),
      h3: () => execBlock('h3'),
      p: () => execBlock('p'),
      ul: () => execList(false),
      ol: () => execList(true),
      link: insertLink,
      table: insertTable,
      mermaid: insertMermaid,
      math: insertMath,
      hr: insertHR,
      imageHTML: insertImageHTML,
      snippet: insertMarkdownSnippet,
    },
  };
}