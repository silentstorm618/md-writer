/**
 * i18n 自检。
 *
 * 目标不是验证"翻译得好不好"，而是防止两类必然发生的回归：
 *   1. 新增 UI 文案时只加了中文，忘了英文（或反过来）
 *   2. HTML 里的 data-i18n="xxx" 或源码里的 tr('xxx') 写错/改了 key
 * 这类错误在运行时会静默显示成中文或 key 本身，只有对比检查能发现。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _dict, t, setLang } from '../web/src/core/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT = _dict();
const ZH = DICT['zh-CN'];
const EN = DICT.en;
const zhKeys = Object.keys(ZH);

let pass = 0, fail = 0;
const lines = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  ✅ ${name}`); }
  else { fail++; lines.push(`  ❌ ${name}${detail ? ' — ' + String(detail).slice(0, 120) : ''}`); }
}

/* ============ 1. 中英 key 一一对应 ============ */
lines.push('\n[1] 中英词典 key 一一对应');

check('中文词典非空', zhKeys.length > 0, `共 ${zhKeys.length} 条`);

const missingEn = zhKeys.filter((k) => !(k in EN));
const extraEn = Object.keys(EN).filter((k) => !(k in ZH));
check('英文词典无缺失 key', missingEn.length === 0, missingEn.join(', '));
check('英文词典无多余 key', extraEn.length === 0, extraEn.join(', '));

// 空串也算缺失：写了一半忘了填
const emptyEn = zhKeys.filter((k) => (EN[k] ?? '') === '');
check('英文词典无空值', emptyEn.length === 0, emptyEn.join(', '));

/* ============ 2. 占位符一致 ============ */
lines.push('\n[2] 占位符（{name} 等）两边一致');

const placeholders = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
const phBad = zhKeys.filter((k) => placeholders(ZH[k]) !== placeholders(EN[k] ?? ''));
check('占位符集合一致', phBad.length === 0, phBad.join(', '));

/* ============ 3. index.html 引用的 key ============ */
lines.push('\n[3] index.html 里 data-i18n* 引用的 key 都存在');

const html = readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const htmlKeys = [...new Set(
  [...html.matchAll(/data-i18n(?:-title|-placeholder|-aria|-html)?="([^"]+)"/g)].map((m) => m[1]),
)];
const badHtml = htmlKeys.filter((k) => !(k in ZH));
check(`HTML 引用 ${htmlKeys.length} 个 key 全部存在`, badHtml.length === 0, badHtml.join(', '));

/* ============ 4. 源码里 tr('...') 的 key ============ */
lines.push('\n[4] 源码里 tr("...") 引用的 key 都存在');

const SRC_FILES = [
  'main.js',
  'core/renderer.js',
  'core/theme.js',
  'export/index.js',
  'ui/editor.js',
  'ui/source-editor.js',
];
const badJs = [];
for (const f of SRC_FILES) {
  let src;
  try {
    src = readFileSync(path.join(ROOT, 'web/src', f), 'utf8');
  } catch {
    continue;   // 文件不存在就跳过
  }
  for (const m of src.matchAll(/\btr\(\s*'([^']+)'/g)) {
    if (!(m[1] in ZH)) badJs.push(`${f} → ${m[1]}`);
  }
}
check('源码引用的 key 全部存在', badJs.length === 0, badJs.join(', '));

/* ============ 5. 拼出来的动态 key ============ */
lines.push('\n[5] 动态拼接的 key（theme.* / font.*）');

for (const id of ['tech', 'wechat', 'minimal', 'parchment', 'dark']) {
  check(`theme.${id} 与 theme.${id}.desc`, `theme.${id}` in ZH && `theme.${id}.desc` in EN);
}
for (const id of ['system', 'songti', 'heiti', 'kai', 'yuanti', 'mono']) {
  check(`font.${id}`, `font.${id}` in ZH && `font.${id}` in EN);
}

/* ============ 6. Swift 词典（L10n） ============ */
lines.push('\n[6] Swift 侧 L10n 词典');

const swift = readFileSync(path.join(ROOT, 'native/main.swift'), 'utf8');
const swiftZh = swift.match(/static let zh: \[String: String\] = \[([\s\S]*?)\n    \]/);
const swiftEn = swift.match(/static let en: \[String: String\] = \[([\s\S]*?)\n    \]/);
if (!swiftZh || !swiftEn) {
  check('能定位到 Swift 词典', false, '正则没匹配上，检查缩进');
} else {
  const keysOf = (block) => [...block.matchAll(/"([a-zA-Z.]+)":/g)].map((m) => m[1]);
  const kz = keysOf(swiftZh[1]);
  const ke = keysOf(swiftEn[1]);
  check(`Swift 中文词典非空（${kz.length} 条）`, kz.length > 0);
  const missSwift = kz.filter((k) => !ke.includes(k));
  const extraSwift = ke.filter((k) => !kz.includes(k));
  check('Swift 英文无缺失', missSwift.length === 0, missSwift.join(', '));
  check('Swift 英文无多余', extraSwift.length === 0, extraSwift.join(', '));

  // 菜单里 L10n.tr("xxx") 的 key 都要在词典里
  const usedSwift = [...new Set([...swift.matchAll(/L10n\.tr\(\s*"([a-zA-Z.]+)"/g)].map((m) => m[1]))];
  const badSwift = usedSwift.filter((k) => !kz.includes(k));
  check(`Swift 引用的 ${usedSwift.length} 个 key 全部存在`, badSwift.length === 0, badSwift.join(', '));
}

/* ============ 7. 切换语言真的生效 ============ */
lines.push('\n[7] 切换语言生效');

setLang('zh-CN', { silent: true });
const zhSaved = t('status.saved');
setLang('en', { silent: true });
const enSaved = t('status.saved');
check('中文 status.saved = 已保存', zhSaved === '已保存', zhSaved);
check('英文 status.saved = Saved', enSaved === 'Saved', enSaved);
check('参数替换生效', t('status.savedAt', { time: '12:34:56' }).includes('12:34:56'), t('status.savedAt', { time: '12:34:56' }));
// 没注入语言、也没存过偏好时，auto 要能解析出一个具体语言而不是空值
setLang('auto', { silent: true });
check('auto 能解析成具体语言', ['已保存', 'Saved'].includes(t('status.saved')), t('status.saved'));

// 复原，避免影响同一进程里的其他用例
setLang('zh-CN', { silent: true });

/* ============ 汇总 ============ */
console.log(lines.join('\n'));
console.log('\n==================================================');
console.log(`i18n 自检：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('==================================================');
process.exit(fail ? 1 : 0);
