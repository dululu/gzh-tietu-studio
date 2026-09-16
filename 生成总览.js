#!/usr/bin/env node
/**
 * 贴图总览页生成器
 *
 * 用法:  node 生成总览.js [数据源.json] [输出目录] [标题]
 * 默认:  node 生成总览.js 贴图示例.json 贴图输出
 *
 * 读数据源里的 name，按 输出目录/<name>.png 引用图片，生成一张九宫格式总览页。
 * 只生成 HTML；要 PNG 总览就用 Chrome 截它（见 贴图排版手册.md 用法 5）。
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('--'));

// 和 批量出图.js 同一套约定：数据和输出按当前工作目录找，示例数据在脚本目录里兜底。
function resolveInput(name, fallbacks) {
  const tries = [path.resolve(process.cwd(), name), path.resolve(HERE, name)]
    .concat((fallbacks || []).map(f => path.resolve(HERE, f)));
  for (const p of tries) if (fs.existsSync(p)) return p;
  return tries[0];
}
const srcFile = resolveInput(positional[0] || '贴图示例.json', ['examples/数据-九种版式示例.json']);
const outDir = path.resolve(process.cwd(), positional[1] || '贴图输出');
const title = positional[2] || '贴图版式总览';
// 张数不再固定 9，列数跟着可调：--cols=5 出一行 5 张，免得多出来的张数把图撑得很高。
// 总览截图脚本用 --window-size 传的宽度要和下面的 COLW + 两侧 44px 内边距对齐（见 总览截图.sh）。
const colsArg = (argv.find(a => a.startsWith('--cols=')) || '').split('=')[1];
const COLS = Math.max(1, Math.min(8, parseInt(colsArg, 10) || 3));
const COLW = COLS * 354 + (COLS - 1) * (COLS >= 5 ? 20 : 28);

if (!fs.existsSync(srcFile)) throw new Error('数据源不存在: ' + srcFile);
const rows = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
if (!Array.isArray(rows) || !rows.length) throw new Error('数据源必须是非空数组');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeName = (s, i) => String(s == null ? '' : s).trim().replace(/[\\/:*?"<>|\s]+/g, '_')
  || String(i + 1).padStart(2, '0');

// 3 列以上在 810px 宽的图上会看不清细节，固定 3 列
const cards = rows.map((row, i) => {
  const slug = safeName(row.name, i);
  const png = path.join(outDir, slug + '.png');
  const missing = fs.existsSync(png) ? '' : ' missing';
  return `    <figure class="card${missing}">
      <img src="./${esc(slug)}.png" alt="">
      <figcaption><span>${esc(slug.replace(/_/g, ' '))}</span><em>${esc(row.layout || '')} · ${esc(row.theme || 'blue')}</em></figcaption>
    </figure>`;
}).join('\n');

const missing = rows.filter((row, i) => !fs.existsSync(path.join(outDir, safeName(row.name, i) + '.png')));
const note = missing.length
  ? `缺图 ${missing.length} 张，先跑 批量出图.sh`
  : `共 ${rows.length} 张，PNG 出自 批量出图.sh`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #EDF1F6; padding: 44px;
         font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  h1, .sub { max-width: ${COLW}px; margin: 0 auto; }
  h1 { font-size: 26px; color: #10294B; margin-bottom: 8px; }
  .sub { font-size: 15px; color: #7A8798; margin-bottom: 30px; }
  .grid { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: ${COLS >= 5 ? 20 : 28}px;
          max-width: ${COLW}px; margin: 0 auto; }
  figure { display: flex; flex-direction: column; gap: 10px; }
  img { width: 100%; height: auto; display: block; border-radius: 12px; background: #fff;
        box-shadow: 0 8px 22px rgba(16,24,40,.14); }
  .card.missing img { border: 2px dashed #C0392B; min-height: 200px; }
  figcaption { display: flex; justify-content: space-between; gap: 10px;
               font-size: 15px; color: #1D2939; }
  figcaption em { font-style: normal; font-size: 13px; color: #7A8798; white-space: nowrap; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(note)}</p>
  <div class="grid">
${cards}
  </div>
</body>
</html>
`;

const out = path.join(outDir, '_总览.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`总览  ${out}   ${rows.length} 张`);
if (missing.length) {
  missing.forEach(row => console.log('  缺图: ' + row.name));
  process.exitCode = 1;
}
