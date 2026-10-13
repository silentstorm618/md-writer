/**
 * 富文本 -> Markdown（turndown）。
 * 懒加载：只在首次粘贴富文本时下载并实例化。
 *
 * 提供：
 *   getTurndown() -> Promise<TurndownService>
 *   htmlToMarkdownSync(html) -> string | null  （turndown 未就绪时返回 null）
 */

let _instance = null;

export async function getTurndown() {
  if (_instance) return _instance;
  try {
    const mod = await import('turndown');
    const TurndownService = mod.default;
    _instance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });
    // 行内公式占位保护：避免被 turndown 当文本吃掉
    _instance.addRule('mathInline', {
      filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('md-math'),
      replacement: (content, node) => `$${(node.getAttribute('data-latex') || content).trim()}$`,
    });
    _instance.addRule('mathBlock', {
      filter: (node) => node.nodeName === 'P' && node.classList.contains('md-math-block'),
      replacement: (content, node) => `\n$$\n${(node.getAttribute('data-latex') || content).trim()}\n$$\n`,
    });
    return _instance;
  } catch (e) {
    console.warn('[md-writer] turndown 加载失败', e);
    return null;
  }
}

/** 同步版本：turndown 已就绪就转换；否则返回 null 让上层走 sanitize HTML 路径 */
export function htmlToMarkdownSync(html) {
  if (!_instance) return null;
  return _instance.turndown(html);
}
