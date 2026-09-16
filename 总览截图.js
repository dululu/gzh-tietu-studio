#!/usr/bin/env node
// 拼版页量高（配套 总览截图.sh / 预览截图.sh 使用）
//
// 背景：_总览.html（或 svg输出里的 _预览.html）的高度取决于"几张图、几张一行"，
// 写死窗口尺寸不是留一大片底色就是截掉最后一行。先让页面自己报出
// documentElement.scrollHeight，再拿这个数去截图。
//
// 用法（由 .sh 调用，一般不单独跑）：
//    node 总览截图.js prep  <输出目录> [页面文件名=_总览.html]   # 注入探针，打印探针页路径
//    node 总览截图.js parse                                      # 从 stdin 读 --dump-dom 结果，打印整页高度
//
// 探针页必须和被量的页面放在同一个目录：页面里的图片是相对路径，
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
  const page = process.argv[4] || '_总览.html';
  const src = path.join(out, page);
  if (!fs.existsSync(src)) {
    console.error('找不到 ' + src + '（先跑对应生成脚本）');
    process.exit(1);
  }
  const dst = path.join(out, '.ovz_' + page);
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
  console.error('用法: node 总览截图.js prep <输出目录> [页面文件名]  |  node 总览截图.js parse');
  process.exitCode = 1;
}
