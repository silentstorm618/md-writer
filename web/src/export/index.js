/**
 * 导出管线：MD / HTML / PDF / DOCX / PNG
 * 所有导出共用同一份渲染结果，保证与预览一致。
 */
import { renderMarkdown, ensureMermaid, renderMermaidIn, slugify } from '../core/renderer.js';
import { themeById, fontById, themeVars, contentCSS } from '../core/theme.js';
// 导出产物里的文案（目录标题、默认文件名等）跟随界面语言
import { t as tr, getLang } from '../core/i18n.js';

/* ============================================================
 * 1. HTML 单文件
 * ============================================================ */

/** 把 HTML 里的图片转成 base64 data URI（可离线单文件打开） */
async function inlineImages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      const b64 = await fetchAsBase64(src);
      if (b64) img.setAttribute('src', b64);
    } catch {
      /* 保持原样 */
    }
  }));
  return doc.body.innerHTML;
}

async function fetchAsBase64(url) {
  // 已是 data URI
  if (url.startsWith('data:')) return url;
  // blob: URL
  if (url.startsWith('blob:')) {
    const blob = await (await fetch(url)).blob();
    return await blobToDataURL(blob);
  }
  // 相对路径 / file:// —— 尝试读取
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/**
 * 导出单文件 HTML。
 * @param {object} opts { title, themeId, fontId, fontSize, md, inlineImg, toc }
 */
export async function exportHTML(opts) {
  const {
    title = tr('export.untitledDoc'), md = '', themeId = 'tech', fontId = 'system',
    fontSize = 16, inlineImg = true, toc = true,
  } = opts;

  const theme = themeById(themeId);
  const font = fontById(fontId);

  // 在离屏容器里渲染，确保 mermaid 转成 SVG
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:820px;background:' + theme.vars['--t-bg'] + ';';
  document.body.appendChild(holder);

  let body = renderMarkdown(md);
  if (toc) body = buildTOC(md) + body;
  holder.innerHTML = `<div class="md-body">${body}</div>`;

  await ensureMermaid();
  await renderMermaidIn(holder);

  let finalHTML = holder.innerHTML;
  if (inlineImg) finalHTML = await inlineImages(finalHTML);

  const css = `
${themeVars(theme, font, fontSize)}
${contentCSS()}
/* 页面容器 */
html { background: ${theme.vars['--t-bg']}; }
body {
  margin: 0;
  background: ${theme.vars['--t-bg']};
  color: ${theme.vars['--t-fg']};
  font-family: var(--t-font-family);
}
/* 打印优化 */
@media print {
  body { background: #fff; }
  .md-body { max-width: 100%; padding: 0; }
  h1, h2, h3 { break-after: avoid; }
  pre, table, img, blockquote { break-inside: avoid; }
  a { color: inherit; border: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: .8em; color: #888; }
}
@media (max-width: 640px) {
  .md-body { padding: 24px 16px 48px; }
}
:root { color-scheme: ${themeId === 'dark' ? 'dark' : 'light'}; }
`;

  holder.remove();

  const doc = `<!DOCTYPE html>
<html lang="${getLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="md-body exported">
${finalHTML}
</div>
</body>
</html>`;

  return doc;
}

/* ============================================================
 * 2. 目录生成
 * ============================================================ */

export function buildTOC(md, maxDepth = 3) {
  const lines = String(md).split('\n');
  const heads = [];
  let inCode = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const depth = m[1].length;
      if (depth <= maxDepth) {
        const text = m[2].replace(/[*_`~]/g, '').trim();
        if (text) heads.push({ depth, text });
      }
    }
  }

  if (heads.length < 2) return '';

  // 同名同层级的标题只保留第一个，避免目录重复
  const seen = new Set();
  const unique = heads.filter((h) => {
    const k = `${h.depth}:${h.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const slugifyLocal = slugify;

  /**
   * 按区间递归：render(start, end, depth) 处理 unique[start..end-1] 内
   * 所有深度 >= depth 的标题，把 depth===depth 的作为 li、把 depth>depth
   * 的递归到子 ul。能正确处理"H1 → H3 → H4 跳过 H2"这种跨级标题。
   */
  const render = (start, end, depth) => {
    const items = [];
    let k = start;
    while (k < end) {
      if (unique[k].depth === depth) {
        const myIdx = k;
        k++;
        let j = myIdx + 1;
        while (j < end && unique[j].depth > depth) j++;
        // 子递归用区间里实际的最小深度，处理"H1→H3→H4 跨级"也能保留
        const subDepth = (j > myIdx + 1) ? unique[myIdx + 1].depth : depth + 1;
        const sub = (j > myIdx + 1) ? render(myIdx + 1, j, subDepth) : '';
        items.push(`<li><a href="#${slugifyLocal(unique[myIdx].text)}" class="lv${depth}">${escapeHTML(unique[myIdx].text)}</a>${sub}</li>`);
      } else {
        k++;
      }
    }
    return items.length ? '<ul>' + items.join('') + '</ul>' : '';
  };

  const minDepth = unique.reduce((m, h) => Math.min(m, h.depth), Infinity);
  const toc = render(0, unique.length, minDepth);

  return `<nav class="md-toc"><div class="md-toc-title">${tr('export.tocTitle')}</div>${toc}</nav>`;
}

/* ============================================================
 * 3. PNG 长图
 * ============================================================ */

/** 用 html2canvas 把预览渲染成整幅长图 */
export async function exportPNG(opts) {
  const { sourceEl, scale = 2, themeId = 'tech' } = opts;
  const html2canvas = (await import('html2canvas')).default;

  const canvas = await html2canvas(sourceEl, {
    scale,
    backgroundColor: themeById(themeId).vars['--t-bg'],
    useCORS: true,
    logging: false,
    windowWidth: sourceEl.scrollWidth,
    height: sourceEl.scrollHeight,
  });

  return canvas.toDataURL('image/png');
}

/* ============================================================
 * 4. PDF（通过离屏窗口调用原生打印）
 * ============================================================ */

/**
 * 生成 PDF。
 * 优先走原生的「打印到 PDF」，质量最好；
 * 若不在原生环境（如浏览器预览），退回到 window.print()。
 */
export async function exportPDF(opts) {
  const html = await exportHTML({ ...opts, inlineImg: true });
  const bridge = window.MDWriter?.bridge;

  if (bridge?.printHTML) {
    bridge.printHTML(html);
    return { mode: 'native-print' };
  }
  // 回退
  openPrintWindow(html);
  return { mode: 'browser-print' };
}

function openPrintWindow(html) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

/* ============================================================
 * 5. DOCX
 * ============================================================ */

/**
 * 生成真正的 .docx（可回 Word 继续编辑）。
 * 用 docx 库按块构建，图片以 ImageRun 嵌入。
 */
export async function exportDOCX(opts) {
  const {
    title = tr('export.untitledDoc'), md = '', fontId = 'system', fontSize = 16,
  } = opts;

  const docxMod = await loadDocx();
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, ImageRun,
    LevelFormat, BorderStyle, ShadingType,
  } = docxMod;

  const font = fontById(fontId);
  // docx 只认字体名，取 fontFamily 的第一个可用名
  const fontName = font.stack.split(',')[0].replace(/["']/g, '').trim();
  const size = Math.round(fontSize * 2); // pt = px * 0.75 → docx 用半磅

  const blocks = parseMarkdownBlocks(md);
  const children = [];

  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const levels = [
          HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
        ];
        children.push(new Paragraph({
          text: b.text,
          heading: levels[Math.min(b.depth, 6) - 1],
          spacing: { before: 240, after: 120 },
        }));
        break;
      }
      case 'paragraph':
        children.push(new Paragraph({
          children: inlineToRuns(b.runs, { fontName, size }, TextRun),
          spacing: { after: 140, line: 320 },
        }));
        break;
      case 'quote':
        children.push(new Paragraph({
          children: inlineToRuns(b.runs, { fontName, size }, TextRun),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 12 } },
          spacing: { before: 120, after: 140 },
        }));
        break;
      case 'code':
        // Mermaid：先用 mermaid 库渲染成 SVG，再尝试 svg2png 转 PNG 嵌入
        if (b.lang === 'mermaid') {
          try {
            const png = await renderMermaidToPng(b.text);
            if (png) {
              const dims = await readPngSize(png);
              children.push(new Paragraph({
                children: [new ImageRun({
                  data: png,
                  transformation: { width: 480, height: dims.height * (480 / dims.width) },
                })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 160, after: 160 },
              }));
            } else {
              children.push(new Paragraph({ children: [new TextRun({ text: tr('export.mermaidPlaceholder'), italics: true, size: size - 2 })] }));
            }
          } catch {
            children.push(new Paragraph({ children: [new TextRun({ text: tr('export.mermaidPlaceholder'), italics: true, size: size - 2 })] }));
          }
          break;
        }
        children.push(new Paragraph({
          children: [new TextRun({ text: b.text, font: 'Courier New', size: size - 2 })],
          shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
          },
          spacing: { before: 120, after: 140 },
        }));
        break;
      case 'list': {
        for (const item of b.items) {
          // 任务列表项：在行首加 "[x]" 或 "[ ]" 视觉提示，Word 没有原生 checkbox
          let runsArr = inlineToRuns(item.runs, { fontName, size }, TextRun);
          if (item.task) {
            runsArr = [
              new TextRun({ text: item.checked ? '☑ ' : '☐ ', font: 'Segoe UI Symbol', size }),
              ...runsArr,
            ];
          }
          children.push(new Paragraph({
            children: runsArr,
            bullet: b.ordered ? undefined : { level: b.level },
            numbering: b.ordered ? { reference: 'md-ol', level: b.level } : undefined,
            spacing: { after: 60 },
          }));
        }
        break;
      }
      case 'hr':
        children.push(new Paragraph({
          text: '',
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
          spacing: { before: 160, after: 160 },
        }));
        break;
      case 'image': {
        try {
          const data = await loadImageBuffer(b.src);
          if (data) {
            children.push(new Paragraph({
              children: [new ImageRun({ data, transformation: { width: 480, height: data.height * (480 / data.width) } })],
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 160 },
            }));
          } else {
            children.push(new Paragraph({ children: [new TextRun({ text: `[图片: ${b.alt || b.src}]`, italics: true, size: size - 2 })] }));
          }
        } catch {
          children.push(new Paragraph({ children: [new TextRun({ text: `[图片: ${b.alt || b.src}]`, italics: true, size: size - 2 })] }));
        }
        break;
      }
      case 'table': {
        try {
          const rows = b.rows.map((r) => new TableRow({
            children: r.map((cell) => new TableCell({
              children: [new Paragraph({ children: inlineToRuns(parseInline(cell), { fontName, size }, TextRun) })],
              shading: b.header && r === b.rows[0] ? { fill: 'F0F0F0' } : undefined,
            })),
          }));
          children.push(new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }));
          children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        } catch { /* 忽略异常表格 */ }
        break;
      }
      default:
        break;
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'md-ol',
        levels: [0, 1, 2].map((l) => ({
          level: l,
          format: LevelFormat.DECIMAL,
          text: `%${l + 1}.`,
          alignment: AlignmentType.START,
        })),
      }],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } },
      },
      children: children.length ? children : [new Paragraph({ text: '' })],
    }],
    styles: {
      default: {
        document: { run: { font: fontName, size } },
      },
    },
  });

  return await Packer.toBlob(doc);
}

/** 用 mermaid 库渲染源码，再把 SVG 转成 PNG buffer（docx 不接受 SVG） */
async function renderMermaidToPng(code) {
  try {
    const { ensureMermaid, renderMermaidIn } = await import('../core/renderer.js');
    await ensureMermaid();
    // 拿到 SVG 字符串：mermaid.render() 返回 { svg }
    const id = `mmd_docx_${Math.random().toString(36).slice(2, 9)}`;
    const { svg } = await window.__mermaid.render(id, code);
    // SVG -> PNG：写入离屏 <img> 再画到 canvas
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const scale = 2; // 2x 高清
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || 800) * scale;
      canvas.height = Math.max(1, img.naturalHeight || 600) * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn('[md-writer] mermaid 转 PNG 失败', e);
    return null;
  }
}

/** 读 PNG 尺寸（给 ImageRun 用） */
function readPngSize(buf) {
  // PNG IHDR：宽在第 16-19 字节，高在 20-23 字节
  const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
  const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
  return { width: w >>> 0, height: h >>> 0 };
}

async function loadImageBuffer(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    // 读取尺寸
    const dims = await readImageSize(blob);
    return { buffer: buf, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

function readImageSize(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 480, height: img.naturalHeight || 320 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 480, height: 320 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** 行内语法 -> TextRun 数组 */
function inlineToRuns(runs, { fontName, size }, TextRun) {
  const out = [];
  for (const r of runs || []) {
    const base = {
      text: r.text,
      font: r.code ? 'Courier New' : fontName,
      size: r.code ? size - 2 : size,
      bold: r.bold || undefined,
      italics: r.italic || undefined,
      strike: r.strikethrough || undefined,
    };
    out.push(new TextRun(base));
  }
  return out.length ? out : [new TextRun({ text: '', font: fontName, size })];
}

async function loadDocx() {
  return await import('docx');
}

/* ============================================================
 * Markdown 分块解析（DOCX 用）
 * ============================================================ */

export function parseMarkdownBlocks(md) {
  const lines = String(md).split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 代码块
    const fence = line.match(/^```(\S*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', text: buf.join('\n'), lang: fence[1] });
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', depth: h[1].length, text: stripInline(h[2]) });
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && lines[i + 1]?.match(/^\s*\|?[\s:|-]+\|[\s:|-]*$/)) {
      const toRow = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const rows = [toRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) { rows.push(toRow(lines[i])); i++; }
      blocks.push({ type: 'table', rows, header: true });
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'quote', runs: parseInline(buf.join(' ')) });
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const isTask = raw.match(/^\[([ xX])\]\s+/);
        items.push({
          runs: parseInline(isTask ? raw.replace(/^\[([ xX])\]\s+/, '') : raw),
          task: !!isTask,
          checked: isTask && isTask[1].toLowerCase() === 'x',
        });
        i++;
      }
      blocks.push({ type: 'list', ordered, items, level: 0 });
      continue;
    }

    // 单独图片行
    const imgOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (imgOnly) {
      blocks.push({ type: 'image', alt: imgOnly[1], src: imgOnly[2] });
      i++;
      continue;
    }

    // 段落
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
      blocks.push({ type: 'paragraph', runs: parseInline(buf.join('\n')) });
    } else {
      i++;
    }
  }

  return blocks;
}

/** 行内 Markdown -> run 序列 */
function parseInline(text) {
  const runs = [];
  const re = /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))/g;
  let last = 0;
  let m;
  const t = String(text);

  while ((m = re.exec(t)) !== null) {
    if (m.index > last) runs.push({ text: t.slice(last, m.index) });
    if (m[2]) runs.push({ text: m[2], bold: true, italic: true });
    else if (m[4]) runs.push({ text: m[4], bold: true });
    else if (m[6]) runs.push({ text: m[6], italic: true });
    else if (m[8]) runs.push({ text: m[8], strikethrough: true });
    else if (m[10]) runs.push({ text: m[10], code: true });
    else if (m[12]) runs.push({ text: m[12], link: true, href: m[13] });
    last = re.lastIndex;
  }
  if (last < t.length) runs.push({ text: t.slice(last) });
  return runs;
}

function stripInline(s) {
  return String(s).replace(/[*_`~]/g, '');
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}