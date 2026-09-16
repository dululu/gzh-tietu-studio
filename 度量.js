#!/usr/bin/env node
'use strict';
/**
 * 度量.js —— 页面三项体检：内容区放不放得下、真图渲染了几张、有没有缺图
 *
 * 为什么要单独抽一个文件：
 *   这三项以前要**各起一趟 Chrome**（检查溢出 6 次 + 真图清点 6 次），而这台机器上
 *   每次 Chrome 冷启动 1.8–3.6s，一批 6 张图光校验就花 21s。
 *   实测 `--screenshot` 和 `--dump-dom` **可以在同一次调用里都给**（截图字节数与
 *   单独截图完全一致），所以把探针直接注入出图页面 —— 截图顺手就把指标捎回来了，
 *   校验从"再来两趟"变成"零趟"。
 *
 * 用法：
 *   const { PROBE, parseMetrics, expectImgs, formatLine } = require('./度量.js');
 *   注入：html.replace(/<\/body>/i, PROBE + '</body>')
 *   截图时同时加 --dump-dom，把 stdout 交给 parseMetrics()
 *
 * 注意：探针只读 DOM、只写 document.title，不动样式，所以不会改变截图结果
 *       （改完之后要拿"字节数与改前逐字节相同"来验证这一点）。
 */

// 回传用纯文本而不是 JSON：--dump-dom 会把 <title> 里的引号转义成 &quot;，JSON 反而不好解。
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
    // 真图的 src 是运行期注入的**绝对路径**（/Users/...），不是 file://，所以按 ^/ 数才准
    var imgs = document.querySelectorAll('img[src^="/"]').length;
    var miss = document.querySelectorAll('.miss').length;
    // 期望张数由生成页面时算好、随页面一起注入，探针自己带回来：
    // 校验就不依赖任何外部清单文件，把 .pages/ 里的页面单独拿去跑也一样准。
    var expect = (window.__EXPECT_IMGS__ == null ? -1 : window.__EXPECT_IMGS__);
    document.title = 'METRICS c=' + d(document.querySelector('.content'))
      + ' k=' + d(document.querySelector('.card'))
      + ' p=' + d(document.querySelector('.poster'))
      + ' img=' + imgs
      + ' miss=' + miss
      + ' exp=' + expect
      + ' bad=' + (bad.slice(0, 5).join('|') || '-')
      + ' END';
  }, 900);
});
<\/script>`;

const RE = /METRICS c=(-?\d+) k=(-?\d+) p=(-?\d+) img=(\d+) miss=(\d+) exp=(-?\d+) bad=(\S*?) END/;
// 老格式（没有 img= / miss= / exp= 那几段）也要能认，方便读旧 dump
const RE_OLD = /METRICS c=(-?\d+) k=(-?\d+) p=(-?\d+) bad=(\S*?) END/;

function parseMetrics(s) {
  const str = String(s);
  let m = str.match(RE);
  if (m) {
    return {
      content: +m[1], card: +m[2], poster: +m[3],
      imgs: +m[4], miss: +m[5],
      expect: +m[6] < 0 ? null : +m[6],
      clipped: m[7] === '-' ? [] : m[7].split('|'),
    };
  }
  m = str.match(RE_OLD);
  if (m) {
    return {
      content: +m[1], card: +m[2], poster: +m[3],
      imgs: null, miss: null, expect: null,
      clipped: m[4] === '-' ? [] : m[4].split('|'),
    };
  }
  return null;
}

/** 这个版式理论上该渲染出几张真图。要和 贴图模板.html 的 LAYOUTS 保持一致：
 *  photo / photoFocus 用 d.img 一张；duo 用 d.img + d.img2 + quadImgs 里非空的项；
 *  hero 是"大图压标题"，同样用 d.img 一张；
 *  其余版式（stat/list/compare/timeline/chart/bar/vs/cards/steps）不看图字段。 */
function expectImgs(d) {
  const one = v => (typeof v === 'string' && v.trim() ? 1 : 0);
  const quads = Array.isArray(d.quadImgs)
    ? d.quadImgs.filter(v => typeof v === 'string' && v.trim()).length : 0;
  switch (d && d.layout) {
    case 'photo':
    case 'photoFocus':
    case 'hero': return one(d.img);
    case 'duo': return one(d.img) + one(d.img2) + quads;
    default: return 0;
  }
}

/** 把指标整理成一行结论。expect 传 null 表示不知道期望值，只报实际值。 */
function formatLine(m, expect) {
  if (!m) return { ok: false, text: '❌ 没读到指标（页面没跑起来？）' };
  if (expect === undefined) expect = m.expect;   // 期望张数由探针自己带回
  // 内容区小幅超出（几个 px）会落在卡片 40px 的底部内边距里，不构成遮挡；超过 4px 才算问题
  const overflow = m.content > 4 || m.card > 0 || m.poster > 0;
  const counts = m.imgs == null
    ? ''
    : `图 ${m.imgs}${expect == null ? '' : '/' + expect} 张`;
  const imgBad = m.miss > 0 || (expect != null && expect > 0 && m.imgs != null && m.imgs < expect);

  const parts = [overflow
    ? `⚠️ 溢出  内容区 +${m.content}px  卡片 +${m.card}px  画布 +${m.poster}px`
    : `✅ 放得下  内容区 +${m.content}px  卡片 +${m.card}px  画布 +${m.poster}px`];
  if (counts) parts.push(counts);
  if (m.miss > 0) parts.push(`缺图 ${m.miss}`);
  if (m.clipped.length) parts.push('内部被裁: ' + m.clipped.join(', '));
  return { ok: !overflow && !imgBad, text: parts.join('   ') };
}

module.exports = { PROBE, parseMetrics, expectImgs, formatLine };
