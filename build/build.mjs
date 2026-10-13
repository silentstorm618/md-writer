/**
 * 构建脚本：用 esbuild 把前端源码打成一个自包含的 bundle，
 * 输出到 native/MDWriter.app/Contents/Resources/web/。
 */
import * as esbuild from 'esbuild';
import { mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'native/MDWriter.app/Contents/Resources/web');
const watch = process.argv.includes('--watch');

mkdirSync(OUT, { recursive: true });

/** esbuild 插件：把 KaTeX 的字体/CSS 以 base64 内联，避免运行时去读 node_modules */
const inlineAssets = {
  name: 'inline-assets',
  setup(build) {
    build.onLoad({ filter: /katex\/dist\/katex\.min\.css$/ }, async (args) => {
      const fs = await import('node:fs/promises');
      let css = await fs.readFile(args.path, 'utf8');
      const dir = dirname(args.path);
      const files = await fs.readdir(dir);
      const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/.test(f));
      for (const f of fonts) {
        const buf = await fs.readFile(`${dir}/${f}`);
        const ext = f.endsWith('.woff2') ? 'woff2' : f.endsWith('.woff') ? 'woff' : f.endsWith('.ttf') ? 'truetype' : 'opentype';
        const b64 = buf.toString('base64');
        css = css.replaceAll(`url(fonts/${f})`, `url(data:font/${ext};base64,${b64})`);
      }
      return { contents: css, loader: 'css' };
    });
  },
};

const options = {
  entryPoints: [resolve(ROOT, 'web/src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['safari16'],
  outfile: resolve(OUT, 'app.js'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'dataurl', '.png': 'dataurl' },
  plugins: [inlineAssets],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[md-writer] watching…');
} else {
  await esbuild.build(options);
}

// 静态资源
if (existsSync(resolve(ROOT, 'web/assets'))) {
  cpSync(resolve(ROOT, 'web/assets'), OUT, { recursive: true });
}
cpSync(resolve(ROOT, 'web/index.html'), resolve(OUT, 'index.html'));

// highlight.js 主题样式随包走
const hljsThemes = ['github.css', 'github-dark.css'];
for (const t of hljsThemes) {
  const src = resolve(ROOT, 'node_modules/highlight.js/styles', t);
  if (existsSync(src)) {
    mkdirSync(resolve(OUT, 'hljs'), { recursive: true });
    cpSync(src, resolve(OUT, 'hljs', t));
  }
}

console.log('[md-writer] build done →', OUT);