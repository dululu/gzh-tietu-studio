#!/usr/bin/env node
// 溢出检查（配套 检查溢出.sh 使用）
//
// 背景：本工具看不了图，"内容区比它该有的高度高出多少"只能量出来。
// 模板给内容区留的高度是固定的：标题两行 + 副标题 + 页脚要占掉多少，
// 剩下的才归 .content。内部元素一多（duo 的主体图 + 金句 + 四宫格），
// 超出的部分会盖到页脚上——肉眼看图很难发现，量一下就很明确。
//
// 用法（由 检查溢出.sh 调用，一般不单独跑）：
//   node 检查溢出.js prep  <输出目录>   # 把探针注入页面，输出到 <输出目录>/.ovf
//   node 检查溢出.js parse              # 从 stdin 读 Chrome --dump-dom 的结果

const fs = require('fs');
const path = require('path');

const PROBE = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    function d(el) { return el ? (el.scrollHeight - el.clientHeight) : -9999; }
    var bad = [];
    document.querySelectorAll('.content *').forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cs.overflow !== 'visible' && el.scrollHeight - el.clientHeight > 2) {
        bad.push(el.className || el.tagName);
      }
    });
    // 用纯文本格式回传：--dump-dom 会把 title 里的引号转义成 &quot;，JSON 反而不好解
    document.title = 'METRICS c=' + d(document.querySelector('.content'))
      + ' k=' + d(document.querySelector('.card'))
      + ' p=' + d(document.querySelector('.poster'))
      + ' bad=' + (bad.slice(0, 5).join('|') || '-')
      + ' END';
  }, 900);
});
<\/script>`;

const mode = process.argv[2];

if (mode === 'prep') {
  const out = path.resolve(process.argv[3] || '.');
  const pages = path.join(out, '.pages');
  const dst = path.join(out, '.ovf');
  if (!fs.existsSync(pages)) {
    console.error('找不到 ' + pages + '（先跑一次 批量出图.sh）');
    process.exit(1);
  }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  const list = fs.readdirSync(pages).filter(f => f.endsWith('.html') && !f.startsWith('_'));
  list.forEach(f => {
    const html = fs.readFileSync(path.join(pages, f), 'utf8').replace(/<\/body>/i, PROBE + '</body>');
    fs.writeFileSync(path.join(dst, f), html);
  });
  console.log(dst);
  process.exitCode = 0;
} else if (mode === 'parse') {
  let s = '';
  process.stdin.on('data', d => (s += d)).on('end', () => {
    const m = s.match(/METRICS (c=-?\d+) (k=-?\d+) (p=-?\d+) bad=(\S*?) END/);
    if (!m) { console.log('  ❌ 没读到指标（页面没跑起来？）'); return; }
    const c = +m[1].slice(2), k = +m[2].slice(2), p = +m[3].slice(2);
    // 小幅超出（几个 px）会落在卡片 40px 的底部内边距里，不构成遮挡；
    // 超过 4px 就当问题看。
    const ok = c <= 4 && k <= 0 && p <= 0;
    console.log('  ' + (ok ? '✅ 放得下' : '⚠️ 溢出') +
      '  内容区 +' + c + 'px  卡片 +' + k + 'px  画布 +' + p + 'px' +
      (m[4] && m[4] !== '-' ? '\n     内部被裁: ' + m[4].split('|').join(', ') : ''));
  });
} else {
  console.error('用法: node 检查溢出.js prep <输出目录>  |  node 检查溢出.js parse');
  process.exitCode = 1;
}
