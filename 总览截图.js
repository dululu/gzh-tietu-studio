#!/usr/bin/env node
// 总览页量高（配套 总览截图.sh 使用）
//
// 背景：_总览.html 的高度取决于"几张图、几张一行"，写死窗口尺寸不是留一大片底色
// 就是截掉最后一行。先让页面自己报出 documentElement.scrollHeight，再拿这个数去截图。
//
// 用法（由 总览截图.sh 调用，一般不单独跑）：
//    node 总览截图.js prep  <输出目录>   # 注入探针，打印探针页路径
//    node 总览截图.js parse              # 从 stdin 读 Chrome --dump-dom 的结果，打印整页高度
//
// 探针页必须和 PNG 放在同一个目录：_总览.html 里图片是相对路径 ./xxx.png，
// 挪到临时目录后会全部 404，img 高度塌成 0，量出来的页高偏小、截图会截掉最后一行。

const fs = require('fs');
const path = require('path');

const PROBE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    // scrollHeight 会随窗口宽度变化（换行、网格列宽），所以量高和截图必须同宽。
    document.title = 'HEIGHT ' + document.documentElement.scrollHeight + ' END';
  }, 900);
});
<\/script>`;

const mode = process.argv[2];

if (mode === 'prep') {
  const out = path.resolve(process.argv[3] || '.');
  const src = path.join(out, '_总览.html');
  if (!fs.existsSync(src)) {
    console.error('找不到 ' + src + '（先跑 node 生成总览.js）');
    process.exit(1);
  }
  const dst = path.join(out, '.ovz_总览.html');
  const html = fs.readFileSync(src, 'utf8').replace(/<\/body>/i, PROBE + '</body>');
  fs.writeFileSync(dst, html);
  console.log(dst);
  process.exitCode = 0;
} else if (mode === 'parse') {
  let s = '';
  process.stdin.on('data', d => (s += d)).on('end', () => {
    const m = s.match(/HEIGHT (\d+) END/);
    if (!m) { console.error('没量到页面高度（页面没跑起来？）'); process.exitCode = 1; return; }
    console.log(m[1]);
  });
} else {
  console.error('用法: node 总览截图.js prep <输出目录>  |  node 总览截图.js parse');
  process.exitCode = 1;
}
