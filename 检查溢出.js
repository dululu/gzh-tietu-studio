#!/usr/bin/env node
// 溢出检查 + 真图清点（配套 检查溢出.sh / 批量出图.sh 使用）
//
// 背景：本工具看不了图，"内容区比它该有的高度高出多少""图到底渲染出来没有"
// 只能量。模板给内容区留的高度是固定的：标题两行 + 副标题 + 页脚要占掉多少，
// 剩下的才归 .content。内部元素一多（duo 的主体图 + 金句 + 四宫格），
// 超出的部分会盖到页脚上——肉眼看图很难发现，量一下就很明确。
//
// 三种用法：
//   node 检查溢出.js from-dumps <输出目录>   # 读 .pages/.dumps/ 里的体检结果（**常用**）
//   node 检查溢出.js prep  <输出目录>        # 老路：注入探针页到 <输出目录>/.ovf
//   node 检查溢出.js parse                   # 从 stdin 读 Chrome --dump-dom 的结果
//
// from-dumps 是首选：出图时已经顺手把指标捎回来了（见 度量.js），这里是**纯读文件**，
// 一次 Chrome 都不启。prep/parse 保留是给"没走出图流程、页面是手工生成的"那种情况兜底。

const fs = require('fs');
const path = require('path');
const { PROBE, parseMetrics, formatLine } = require('./度量.js');

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

const mode = process.argv[2];

if (mode === 'from-dumps') {
  const out = path.resolve(process.argv[3] || '.');
  const pageDir = path.join(out, '.pages');
  const dumpDir = path.join(pageDir, '.dumps');
  if (!fs.existsSync(dumpDir)) {
    console.error('没有 ' + dumpDir + ' —— 这批图不是用 批量出图.sh / 批量出图.js 出的。');
    console.error('改用探针模式：./检查溢出.sh ' + path.relative(process.cwd(), out));
    process.exit(2);
  }
  // 顺序跟着 _manifest.txt（和出图顺序一致）；没有清单就按文件名排
  const manifest = path.join(pageDir, '_manifest.txt');
  let list;
  if (fs.existsSync(manifest)) {
    list = readText(manifest).split('\n').map(s => s.trim()).filter(Boolean)
      .map(f => f.replace(/\.html$/i, ''));
  } else {
    list = fs.readdirSync(dumpDir).filter(f => f.endsWith('.html'))
      .map(f => f.replace(/\.html$/i, '')).sort();
  }

  let okN = 0;
  list.forEach(slug => {
    const kb = Math.round(sizeOf(path.join(out, slug + '.png')) / 1024);
    const r = formatLine(parseMetrics(readText(path.join(dumpDir, slug + '.html'))));
    const good = r.ok && kb > 0;
    if (good) okN++;
    console.log(`  ${slug}.png   ${kb} KB`);
    console.log(`      ${kb > 0 ? r.text : '❌ 没产出截图'}`);
  });
  console.log('');
  if (okN === list.length && list.length) {
    console.log(`体检 ${okN}/${list.length} 张通过（放得下 · 真图数对得上 · 无缺图）`);
  } else {
    console.log(`体检 ${okN}/${list.length} 张通过 —— 有问题的那几张看上面的行`);
  }
  process.exitCode = okN === list.length && list.length ? 0 : 1;

} else if (mode === 'prep') {
  const out = path.resolve(process.argv[3] || '.');
  const pages = path.join(out, '.pages');
  const dst = path.join(out, '.ovf');
  if (!fs.existsSync(pages)) {
    console.error('找不到 ' + pages + '（先跑一次 批量出图.sh）');
    process.exit(1);
  }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  // 页面本身已经带探针（批量出图.js 注入的），这里直接复制即可；老页面没有就补一个。
  // 只排除清单和 .dumps 目录这类非页面文件。
  const list = fs.readdirSync(pages).filter(f =>
    f.endsWith('.html') && !f.startsWith('_') && !f.startsWith('.'));
  list.forEach(f => {
    let html = fs.readFileSync(path.join(pages, f), 'utf8');
    if (!html.includes('METRICS')) html = html.replace(/<\/body>/i, PROBE + '</body>');
    fs.writeFileSync(path.join(dst, f), html);
  });
  console.log(dst);
  process.exitCode = 0;

} else if (mode === 'parse') {
  let s = '';
  process.stdin.on('data', d => (s += d)).on('end', () => {
    console.log(formatLine(parseMetrics(s)).text);
  });

} else {
  console.error('用法: node 检查溢出.js from-dumps <输出目录>');
  console.error('      node 检查溢出.js prep <输出目录>  |  node 检查溢出.js parse');
  process.exitCode = 1;
}
