/**
 * 生成 App 图标：
 *   1) 生成一份1024 的主 SVG（矢量风格，精准可控）
 *   2) 用 build/render-icon.swift（WKWebView 快照）导出各尺寸 PNG
 *   3) iconutil 组装成 native/AppIcon.icns
 * 纯代码绘制，不消耗 AI 生图额度。
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = resolve(ROOT, 'build/icon');
const SET = resolve(TMP, 'AppIcon.iconset');
mkdirSync(TMP, { recursive: true });
mkdirSync(SET, { recursive: true });

/** 主图标：圆角底板 + 文档 + Markdown 标记 + 铅笔 */
const S = 1024;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#6D9BFF"/>
      <stop offset="50%" stop-color="#4A6FE3"/>
      <stop offset="100%" stop-color="#3A4FBF"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#E8EEFC"/>
    </linearGradient>
    <linearGradient id="pen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFD97A"/>
      <stop offset="100%" stop-color="#F0A02A"/>
    </linearGradient>
    <filter id="sh" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#16255C" flood-opacity="0.30"/>
    </filter>
  </defs>

  <rect width="${S}" height="${S}" rx="229" ry="229" fill="url(#bg)"/>
  <rect width="${S}" height="${S*0.52}" rx="229" ry="229" fill="#FFFFFF" opacity="0.10"/>

  <!-- 文档主体 -->
  <g filter="url(#sh)">
    <path d="M 268 150 L 640 150 L 756 266 L 756 856 L 268 856 Z" fill="url(#paper)"/>
    <path d="M 640 150 L 640 266 L 756 266 Z" fill="#C3D0F4"/>
  </g>

  <!-- 标题条 -->
  <rect x="316" y="212" width="188" height="28" rx="14" fill="#4A6FE3"/>

  <!-- 正文行 -->
  <g stroke="#9BA8C6" stroke-width="24" stroke-linecap="round">
    <line x1="316" y1="292" x2="700" y2="292"/>
    <line x1="316" y1="352" x2="700" y2="352"/>
    <line x1="316" y1="412" x2="628" y2="412"/>
  </g>

  <!-- Markdown M -->
  <g stroke="#4A6FE3" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M 322 800 L 322 660 L 400 726 L 478 660 L 478 800"/>
  </g>
  <!-- Markdown 下划横线 -->
  <line x1="530" y1="800" x2="700" y2="800" stroke="#F0A02A" stroke-width="30" stroke-linecap="round"/>

  <!-- 铅笔 -->
  <g transform="rotate(-45 700 700)">
    <rect x="666" y="470" width="76" height="300" rx="18" fill="url(#pen)"/>
    <path d="M 666 770 L 704 856 L 742 770 Z" fill="#2F2A18"/>
    <rect x="666" y="506" width="76" height="26" fill="#FFFFFF" opacity="0.40"/>
    <rect x="666" y="470" width="76" height="40" rx="18" fill="#E86A5C"/>
  </g>
</svg>`;

const masterSvg = resolve(TMP, 'icon.svg');
writeFileSync(masterSvg, svg);
console.log('[icon] 主 SVG 已生成');

// 每次都重新编译渲染器，确保 Swift 侧的像素尺寸修复生效
const renderer = resolve(TMP, 'render-icon');
execSync(`swiftc -O -o "${renderer}" "${resolve(ROOT, 'build/render-icon.swift')}"`, { shell: '/bin/bash' });

// 渲染各尺寸
execSync(`"${renderer}" "${masterSvg}" "${TMP}"`, { shell: '/bin/bash' });

// 组装 iconset（@2x = 普通尺寸的 2 倍）
// 渲染器已按精确像素输出，直接复制即可
const jobs = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
];
let copied = 0;
for (const [size, name] of jobs) {
  const src = resolve(TMP, `icon_${size}.png`);
  if (!existsSync(src)) continue;
  copyFileSync(src, resolve(SET, name));
  copied++;
}

const icns = resolve(ROOT, 'native/AppIcon.icns');
// iconutil 需要写系统临时目录，在受限环境下会被拦；改用 Python 直接组装二进制
execSync(`python3 "${resolve(ROOT, 'build/make-icns.py')}" "${SET}" "${icns}"`, { shell: '/bin/bash' });
console.log(`[icon] ✅ ${copied} 个尺寸已渲染`);