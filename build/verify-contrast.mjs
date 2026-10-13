/**
 * 配色可读性校验：所有主题的正文/次要文字/强调色都必须满足 WCAG 对比度。
 * 截图里的问题正是「深底黑字」——正文对比度只有 1.6:1。
 */
import { THEMES, contrastRatio } from '../web/src/core/theme.js';
import { DARK, LIGHT } from '../web/src/ui/source-editor.js';

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};

console.log('=== 主题对比度校验（WCAG）===');
for (const t of THEMES) {
  const v = t.vars;
  const body = contrastRatio(v['--t-fg'], v['--t-bg']);
  const muted = contrastRatio(v['--t-muted'], v['--t-bg']);
  const accent = contrastRatio(v['--t-accent'], v['--t-bg']);
  const code = contrastRatio(v['--t-fg'], v['--t-code-bg']);
  const quote = contrastRatio(v['--t-fg'], v['--t-quote-bg']);

  console.log(`\n【${t.label}】底 ${v['--t-bg']} 字 ${v['--t-fg']}`);
  console.log(`  正文 ${body.toFixed(2)}:1 | 次要 ${muted.toFixed(2)}:1 | 强调 ${accent.toFixed(2)}:1 | 代码区 ${code.toFixed(2)}:1 | 引用区 ${quote.toFixed(2)}:1`);

  // 正文：AA 标准 4.5:1（正常文本）
  ck(`${t.label} 正文 ≥4.5:1`, body >= 4.5, `${body.toFixed(2)}:1`);
  // 次要文字：至少 3:1（大号/辅助文本）
  ck(`${t.label} 次要 ≥3:1`, muted >= 3, `${muted.toFixed(2)}:1`);
  // 强调色：至少 3:1
  ck(`${t.label} 强调 ≥3:1`, accent >= 3, `${accent.toFixed(2)}:1`);
  // 代码块与引用区里的文字也要看得清
  ck(`${t.label} 代码区 ≥4.5:1`, code >= 4.5, `${code.toFixed(2)}:1`);
  ck(`${t.label} 引用区 ≥4.5:1`, quote >= 4.5, `${quote.toFixed(2)}:1`);
}

console.log('\n=== CodeMirror 编辑器配色 ===');
const cmBody = contrastRatio(DARK.base, DARK.bg);
const cmCursor = contrastRatio(DARK.cursor, DARK.bg);
const cmGutter = contrastRatio(DARK.gutter, DARK.bg);
console.log(`深色：正文 ${cmBody.toFixed(2)}:1 | 光标 ${cmCursor.toFixed(2)}:1 | 行号 ${cmGutter.toFixed(2)}:1`);
ck('CM 深色正文 ≥4.5:1', cmBody >= 4.5, `${cmBody.toFixed(2)}:1`);
ck('CM 深色光标 ≥3:1', cmCursor >= 3, `${cmCursor.toFixed(2)}:1`);
ck('CM 深色行号 ≥3:1', cmGutter >= 3, `${cmGutter.toFixed(2)}:1`);

const cmLightBody = contrastRatio(LIGHT.base, LIGHT.bg);
ck('CM 浅色正文 ≥4.5:1', cmLightBody >= 4.5, `${cmLightBody.toFixed(2)}:1`);

console.log('\n=== 核心回归：截图里的病态配色必须已消除 ===');
// 截图实测：正文 #16181d 压在 #101010 上
const BAD_BG = '#101010', BAD_FG = '#16181d';
const badRatio = contrastRatio(BAD_FG, BAD_BG);
console.log(`  截图实测对比度: ${badRatio.toFixed(2)}:1（截图里正是这个值，导致看不清）`);
ck('确认旧配色确实不可读（对照组）', badRatio < 2, `${badRatio.toFixed(2)}:1`);

// 现在深色主题应该是 #e6e6e6 on #101010
const darkTheme = THEMES.find((t) => t.id === 'dark');
const fixedRatio = contrastRatio(darkTheme.vars['--t-fg'], darkTheme.vars['--t-bg']);
ck('深色主题已修正（≥4.5:1）', fixedRatio >= 4.5, `${fixedRatio.toFixed(2)}:1`);
ck('提升倍数 >3x', fixedRatio / badRatio > 3, `${(fixedRatio / badRatio).toFixed(1)}x`);

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);