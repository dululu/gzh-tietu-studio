#!/usr/bin/env node
/**
 * 贴图 → SVG 导出（可直接拖进 Figma 编辑）
 *
 * 用法:  node 导出SVG.js [数据源.json] [输出目录]
 * 默认:  node 导出SVG.js 贴图示例.json svg输出
 *
 * 数据源格式与 贴图模板.html 完全一致，配色读 主题.js，两条路共用一份定义。
 *
 * 为什么导出 SVG 而不是 PNG：
 *   Figma 导入 SVG 后，文字是可编辑文本框、图形是可编辑矢量，
 *   而 PNG 只能当图片垫底。同一份数据，PNG 用于发布，SVG 用于二次改版。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const THEMES = require('./主题.js');

const HERE = __dirname;
const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('--'));
// 数据源/输出按当前工作目录找，模板类素材（主题.js）从脚本目录找：
// 脚本装在技能目录里时，可以从任何项目目录调用。
function resolveInput(name, fallbacks) {
  const tries = [path.resolve(process.cwd(), name), path.resolve(HERE, name)]
    .concat((fallbacks || []).map(f => path.resolve(HERE, f)));
  for (const p of tries) if (fs.existsSync(p)) return p;
  return tries[0];
}
const srcFile = resolveInput(positional[0] || '贴图示例.json', ['examples/数据-九种版式示例.json']);
const outDir = path.resolve(process.cwd(), positional[1] || 'svg输出');
const SRC_DIR = path.dirname(srcFile);

/* ============ 画布与骨架常量（与 贴图模板.html 一一对应） ============ */
const W = 810, H = 1080;
const PAD = 26;
const CX = PAD + 50;                 // 76
const CW = W - PAD * 2 - 100;        // 658
const CARD_TOP = PAD + 50;           // 76
const CARD_BOTTOM = PAD + (H - PAD * 2) - 40;  // 1014

const T1_MAX = 72, T2_MAX = 58, LH = 1.22;
const TITLE_FONT = 'Songti SC';
const BODY_FONT = 'PingFang SC';

/* ============ 基础工具 ============ */
const R = n => Math.round(n * 100) / 100;
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rgb2hex = s => '#' + String(s).split(',')
  .map(n => parseInt(n.trim(), 10).toString(16).padStart(2, '0')).join('');

function textW(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 0x2e80) w += size;
    else if (ch === ' ') w += size * 0.28;
    else w += size * 0.55;
  }
  return w;
}

function fitSize(s, base, avail, ls, floor = 24) {
  let size = base;
  const n = [...String(s || '')].length;
  while (size > floor && textW(s, size) + (ls || 0) * Math.max(0, n - 1) > avail) size -= 1;
  return size;
}

/* SVG 的 <text> 不会自动折行（HTML 会），所以长句必须自己切。
   CJK 任意处可断、 ASCII 连续段（词/数字/年份）不拆 —— 和浏览器的断行习惯接近。 */
function wrapText(s, size, avail, ls = 0) {
  const w = str => textW(str, size) + ls * Math.max(0, [...str].length - 1);
  const lines = [];
  let cur = '';
  for (const ch of String(s == null ? '' : s)) {
    if (cur && w(cur + ch) > avail) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

/** 多行文本块：y 为首行顶端，返回 { svg, h }（h 为整块高，便于往下排版） */
function TBlock(o) {
  const { x, y, s, size = 18, lh = 1.45, avail, fill = '#000', weight = 400,
    family = BODY_FONT, ls = 0, anchor = 'start', opacity } = o;
  const lines = wrapText(s, size, avail, ls);
  const lineH = size * lh;
  return {
    svg: lines.map((ln, i) => T({
      x, cy: y + i * lineH + lineH / 2, s: ln, size, fill, weight, family, ls, anchor, opacity
    })).join(''),
    h: lines.length * lineH
  };
}

function T({ x, cy, s, size = 14, fill = '#000', weight = 400, family = BODY_FONT, ls = 0, anchor = 'middle', opacity }) {
  if (s == null || s === '') return '';
  const y = cy + size * 0.36;
  return `<text x="${R(x)}" y="${R(y)}" font-family="${family}" font-size="${R(size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`
    + (ls ? ` letter-spacing="${ls}"` : '')
    + (opacity != null ? ` opacity="${opacity}"` : '')
    + `>${esc(s)}</text>`;
}

const rect = (x, y, w, h, fill, o = {}) =>
  `<rect x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}"`
  + (o.rx ? ` rx="${o.rx}"` : '')
  + ` fill="${fill}"`
  // op 对应 CSS 的 rgba 底色（数字带是 rgba(255,255,255,.9)，要透出底图）
  + (o.op != null ? ` fill-opacity="${o.op}"` : '')
  + (o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 0.5}"` : '')
  + (o.dash ? ` stroke-dasharray="${o.dash}"` : '')
  + `/>`;

const line = (x1, y1, x2, y2, stroke, sw = 1, opacity) =>
  `<line x1="${R(x1)}" y1="${R(y1)}" x2="${R(x2)}" y2="${R(y2)}" stroke="${stroke}" stroke-width="${sw}" fill="none"`
  + (opacity != null ? ` opacity="${opacity}"` : '') + `/>`;

/* ============ 图片内嵌 ============ */
/* 拖进 Figma 的 SVG 必须"自带图"，否则二次改版时图位全是空格子。
   所以本地图转 base64 内嵌；原图动辄几 MB，先按目标宽度压一遍再嵌，
   不然单个 SVG 能到几十 MB，Figma 打开就卡死。 */
const imgCache = new Map();
const unembedded = [];
let clipSeq = 0;

function imgHref(src, targetW) {
  if (typeof src !== 'string' || !src.trim()) return null;
  if (/^(https?:|data:)/i.test(src)) {
    unembedded.push(src + '（外链图不内嵌，需在 Figma 里手动置入）');
    return null;
  }
  const key = src + '|' + targetW;
  if (imgCache.has(key)) return imgCache.get(key);

  let p = null;
  if (path.isAbsolute(src)) p = src;
  else {
    for (const base of [SRC_DIR, HERE, process.cwd()]) {
      const cand = path.resolve(base, src);
      if (fs.existsSync(cand)) { p = cand; break; }
    }
  }
  if (!p || !fs.existsSync(p)) {
    imgCache.set(key, null);
    unembedded.push(src + '（找不到文件）');
    return null;
  }

  let buf = null, mime = 'image/jpeg';
  const tmp = path.join(os.tmpdir(), `svg-embed-${process.pid}-${imgCache.size}.jpg`);
  try {
    execFileSync('sips', ['--resampleWidth', String(targetW), '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '72', p, '--out', tmp], { stdio: 'ignore' });
    buf = fs.readFileSync(tmp);
  } catch (e) {
    // 没装 sips 或格式怪，就退回原图（宁可文件大也不静默丢图）
    try {
      buf = fs.readFileSync(p);
      mime = /\.png$/i.test(p) ? 'image/png' : 'image/jpeg';
    } catch (e2) { buf = null; }
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const href = buf ? `data:${mime};base64,${buf.toString('base64')}` : null;
  if (!href) unembedded.push(src + '（读不到 / 压缩失败）');
  imgCache.set(key, href);
  return href;
}

/** 把 quadPos 那种 "72% center" 折成 SVG 的三档对齐。
 *  SVG/object-fit 没法定精确百分比，导出时只保留左/中/右，需要精修就在 Figma 里拖。 */
function svgAlign(pos) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%/.exec(String(pos || ''));
  if (!m) return 'xMidYMid';
  const pct = Number(m[1]);
  return pct <= 25 ? 'xMinYMid' : pct >= 75 ? 'xMaxYMid' : 'xMidYMid';
}

/** 有图就贴图（带圆角裁切），没图退回虚线占位框 —— 缺图要看得见，不能静默留白。 */
function imgCard(src, x, y, w, h, t, label, pos, rx = 14) {
  const targetW = Math.min(1200, Math.max(320, Math.round(w * 2)));
  const href = imgHref(src, targetW);
  if (!href) return phBox(x, y, w, h, label, t);
  const id = 'clip' + (++clipSeq);
  return `<defs><clipPath id="${id}"><rect x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}" rx="${rx}"/></clipPath></defs>`
    + `<image x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}"`
    + ` preserveAspectRatio="${svgAlign(pos)} slice" clip-path="url(#${id})"`
    + ` xlink:href="${href}" href="${href}"/>`;
}

function niceScale(max, targetTicks = 6) {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(max / step) * step, step };
}

/* ============ 固定件 ============ */
/* 满幅外壳的判定 —— 必须和 贴图模板.html 的 render() 里那两行逐字对齐：
     const ownShell = d.layout === 'cover';
     const fullShell = d.shell === 'full' || ownShell;
   对不上就会出现"PNG 是满幅、SVG 还是白卡"这种静默走形。 */
const isFullShell = d => !!(d && (d.shell === 'full' || d.layout === 'cover'));

/* 满幅外壳下，出血元素要一直顶到画布边（x = 0 .. W）；
   不是满幅时仍只是"顶到卡片内边距之外"（26 .. 784）。
   bigword 的色块垫、band 的色带都要走这里 —— 漏一边就会变成
   「PNG 顶到 0、SVG 停在 26」这种两边都渲染成功、却悄悄不一样的走形。 */
const bleedBox = d => (isFullShell(d) ? { x: 0, w: W } : { x: PAD, w: W - PAD * 2 });

function background(t, d) {
  const blob = rgb2hex(t.blobRgb);
  const mist = rgb2hex(t.mistRgb);
  const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${t.bgFrom}"/>
    <stop offset="0.3" stop-color="${t.bgMid}"/>
    <stop offset="0.68" stop-color="${t.bgMid}"/>
    <stop offset="1" stop-color="${t.bgTo}"/>
  </linearGradient>
  <radialGradient id="blob">
    <stop offset="0" stop-color="${blob}" stop-opacity="${t.blobOp}"/>
    <stop offset="1" stop-color="${blob}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="mist" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${mist}" stop-opacity="0"/>
    <stop offset="0.14" stop-color="${mist}" stop-opacity="0.9"/>
    <stop offset="0.86" stop-color="${mist}" stop-opacity="0.9"/>
    <stop offset="1" stop-color="${mist}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.94"/>
    <stop offset="0.22" stop-color="#FFFFFF" stop-opacity="0.70"/>
    <stop offset="0.44" stop-color="#FFFFFF" stop-opacity="0.28"/>
    <stop offset="0.66" stop-color="#FFFFFF" stop-opacity="0.24"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.88"/>
  </linearGradient>
  <linearGradient id="veilTint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${blob}" stop-opacity="0.22"/>
    <stop offset="1" stop-color="${blob}" stop-opacity="0.14"/>
  </linearGradient>
</defs>`;

  // 满幅：不要圆角画布、不要白卡，底图直接铺到四个边。
  // 淡纱在下、文字在上（background() 是整个 SVG 的第一层，天然压在所有内容下面）。
  if (isFullShell(d)) {
    let g = `<g id="背景">` + rect(0, 0, W, H, 'url(#bg)');
    if (d.bg) {
      g += imgCard(d.bg, 0, 0, W, H, t, '满幅底图', 'center', 0)
        + rect(0, 0, W, H, 'url(#veil)')
        + rect(0, 0, W, H, 'url(#veilTint)');
    }
    return defs + g + `</g>`;
  }

  const blobs = [[40, 60], [770, 50], [20, 1020], [800, 1010]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="230" fill="url(#blob)"/>`).join('');
  return defs
    + `<g id="背景">`
    + rect(0, 0, W, H, 'url(#bg)', { rx: 34 })
    + blobs
    + rect(PAD, PAD, W - PAD * 2, H - PAD * 2, '#FFFFFF', { rx: 26 })
    + `</g>`;
}

function badge(text, t) {
  const s = String(text || '小铭想');
  const a = s.slice(0, 1), b = s.slice(1);
  // 与 HTML 模板同一套规则：第一字一行，其余字第二行，字数多就缩字号
  const size = s.length <= 2 ? 27 : s.length === 3 ? 25 : 18;
  const bx = W - PAD - 88, by = PAD;
  return `<g id="账号角标">`
    + `<path d="M${bx} ${by} h62 a26 26 0 0 1 26 26 v62 h-88 z" fill="${t.badge}"/>`
    + T({ x: bx + 44, cy: by + 30, s: a, size, fill: '#FFFFFF', weight: 700, family: TITLE_FONT, ls: 1 })
    + line(bx + 23, by + 44, bx + 65, by + 44, '#FFFFFF', 1, 0.5)
    + T({ x: bx + 44, cy: by + 62, s: b, size, fill: '#FFFFFF', weight: 700, family: TITLE_FONT, ls: 1 })
    + `</g>`;
}

function titleBlock(d, t) {
  const t1 = d.title1 || '', t2 = d.title2 || '';
  const s1 = fitSize(t1, T1_MAX, CW, 4);
  const s2 = fitSize(t2, T2_MAX, CW, 2);
  const h1 = s1 * LH, h2 = s2 * LH;
  const y1c = CARD_TOP + h1 / 2;
  const y2c = CARD_TOP + h1 + h2 / 2;

  let svg = rect(PAD, CARD_TOP + h1 + h2 * 0.06, W - PAD * 2, h2 * 0.88, 'url(#mist)');
  svg += `<g id="主标题">`
    + T({ x: W / 2, cy: y1c, s: t1, size: s1, fill: t.title, weight: 900, family: TITLE_FONT, ls: 4 })
    + T({ x: W / 2, cy: y2c, s: t2, size: s2, fill: t.title, weight: 900, family: TITLE_FONT, ls: 2 })
    + `</g>`;

  let bottom = CARD_TOP + h1 + h2;
  if (d.deck) {
    const top = bottom + 26, dh = 32 * 1.4;
    svg += `<g id="副标题">`
      + T({ x: W / 2, cy: top + dh / 2, s: d.deck, size: 32, fill: t.title, weight: 700, family: TITLE_FONT, ls: 2 })
      + line(CX, top + dh + 20, CX + CW, top + dh + 20, t.softLine, 1)
      + `</g>`;
    bottom = top + dh + 21;
  }
  return { svg, bottom };
}

function footBlock(d, t) {
  const lines = (d.foot || []).filter(Boolean);
  if (!lines.length) return { svg: '', top: CARD_BOTTOM };
  const lh = 16 * 1.8;
  const top = CARD_BOTTOM - lines.length * lh;
  return {
    svg: `<g id="来源注释">` + lines
      .map((s, i) => T({ x: CX, cy: top + lh * i + lh / 2, s, size: 16, fill: t.foot, anchor: 'start' }))
      .join('') + `</g>`,
    top
  };
}

/* ============ 内容区版式 ============ */
function phBox(x, y, w, h, label, t, hint) {
  return rect(x, y, w, h, t.thumbFrom, { rx: 14, stroke: t.softLine, sw: 1, dash: '8 6' })
    + T({ x: x + w / 2, cy: y + h / 2 - 12, s: label, size: 20, fill: t.thumbText })
    + (hint ? T({ x: x + w / 2, cy: y + h / 2 + 18, s: hint, size: 13, fill: t.thumbText, opacity: 0.75 }) : '');
}

// ---- photo：单图 + 图注 ----
function contentPhoto(d, top, bottom, t) {
  const capH = 25 * 1.4, gap = 22;
  const imgH = bottom - top - gap - capH;
  return `<g id="内容区-单图加图注">`
    + imgCard(d.img, CX, top, CW, imgH, t, '在此放图')
    + (d.cap ? T({ x: W / 2, cy: top + imgH + gap + capH / 2, s: d.cap, size: 25, fill: t.title, weight: 700, family: TITLE_FONT, ls: 1 }) : '')
    + `</g>`;
}

// ---- photoFocus：主图 + 圆形焦点 ----
function contentFocus(d, top, bottom, t) {
  const capH = d.cap ? 16 * 1.4 + 18 : 0;
  const stageH = bottom - top - capH;
  const stageCy = top + stageH * 0.46;
  const D = 480;
  const pills = (d.pills || []).slice(0, 2);
  const pillH = 62, gap = 26;
  const blockH = pills.length * pillH + Math.max(0, pills.length - 1) * gap;
  let p = '';
  pills.forEach((text, i) => {
    const pw = Math.min(430, textW(text, 34) + 60);
    const py = stageCy - blockH / 2 + i * (pillH + gap);
    p += rect(W / 2 - pw / 2, py, pw, pillH, t.pillTo, { rx: pillH / 2, stroke: t.pillBorder, sw: 4 })
      + T({ x: W / 2, cy: py + pillH / 2, s: text, size: 34, fill: '#FFFFFF', weight: 700, ls: 1 });
  });
  return `<g id="内容区-主图加圆形焦点">`
    + imgCard(d.img, CX, top, CW, stageH, t, '在此放主图')
    + `<g id="放大镜">`
    + `<circle cx="${W / 2}" cy="${R(stageCy)}" r="${D / 2 + 16}" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="3"/>`
    + `<circle cx="${W / 2}" cy="${R(stageCy)}" r="${D / 2}" fill="#FFFFFF" stroke="${t.title}" stroke-width="5"/>`
    + p + `</g>`
    + (d.cap ? T({ x: CX, cy: top + stageH + 26, s: d.cap, size: 16, fill: t.foot, anchor: 'start' }) : '')
    + `</g>`;
}

// ---- duo：双主体 + 金句 + 四宫格 ----
function contentDuo(d, top, bottom, t) {
  const rowH = 272, gw = (CW - 18) / 2;
  const quoteH = d.quote ? 30 * 1.35 + 20 : 0;
  const quadTop = top + rowH + quoteH + 24;
  const thumbH = 142, cellGap = 16;
  const cellW = (CW - cellGap * 3) / 4;
  const quads = (d.quads || []).slice(0, 4);

  let svg = `<g id="内容区-双主体加四宫格">`;
  svg += imgCard(d.img, CX, top, gw, rowH, t, '主体 A');
  svg += imgCard(d.img2, CX + gw + 18, top, gw, rowH, t, '主体 B');
  if (d.quote) {
    svg += T({ x: W / 2, cy: top + rowH + 20 + (30 * 1.35) / 2, s: d.quote, size: 30, fill: t.title, weight: 700, family: TITLE_FONT, ls: 1 });
  }
  const qimgs = d.quadImgs || [], qpos = d.quadPos || [];
  quads.forEach((q, i) => {
    const x = CX + i * (cellW + cellGap);
    // 有图就贴图，没图退回"首字大卡"——和 贴图模板.html 的行为保持一致
    svg += qimgs[i]
      ? imgCard(qimgs[i], x, quadTop, cellW, thumbH, t, '', qpos[i], 12)
      : rect(x, quadTop, cellW, thumbH, t.thumbTo, { rx: 12 })
        + T({ x: x + cellW / 2, cy: quadTop + thumbH / 2, s: String(q).slice(0, 1), size: 34, fill: t.thumbText, weight: 700 });
    svg += T({ x: x + cellW / 2, cy: quadTop + thumbH + 12 + (19 * 1.35) / 2, s: q, size: 19, fill: t.title, weight: 500 });
  });
  return svg + `</g>`;
}

// ---- chart：双轴柱线图 ----
function contentChart(d, top, bottom, t) {
  const gx = CX + 66, gw = CW - 66 - 84;
  const gy = top + 52, gh = bottom - top - 52 - 30;
  const last = d.highlight == null ? d.counts.length - 1 : d.highlight;
  // 与 贴图模板.html 的 initChart 保持一致：右轴格式可配，默认沿用旧的金额写法
  const wAxisFmt = d.wealthAxisFormat || '${v}tn';
  const wLabelFmt = d.wealthLabelFormat || '${v}tn';
  const wDec = d.wealthDecimals == null ? 1 : d.wealthDecimals;
  const lMax = d.countAxisMax, lStep = lMax / 4;
  const rMax = d.wealthAxisMax, rStep = rMax / 4;
  const n = d.years.length, band = gw / n, barW = band * 0.48;

  let svg = `<g id="内容区-双轴柱线图">`;
  svg += T({ x: CX, cy: top + 27 * 0.7, s: d.chartTitle, size: 27, fill: t.ink, weight: 700, anchor: 'start', ls: 0.5 });

  const lgY = top + 27 * 1.4 + 22 + 12;
  const barTxt = d.legendBar || '', lnTxt = d.legendLine || '';
  const lgW = 24 + 10 + textW(barTxt, 18) + 44 + 26 + 10 + textW(lnTxt, 18);
  let lx = W / 2 - lgW / 2;
  svg += rect(lx, lgY - 7, 24, 14, t.card, { rx: 2 })
    + T({ x: lx + 34, cy: lgY, s: barTxt, size: 18, fill: t.axis, anchor: 'start' });
  lx += 24 + 10 + textW(barTxt, 18) + 44;
  svg += line(lx, lgY, lx + 26, lgY, t.line, 3)
    + `<circle cx="${R(lx + 14)}" cy="${R(lgY)}" r="5" fill="${t.line}"/>`
    + T({ x: lx + 36, cy: lgY, s: lnTxt, size: 18, fill: t.axis, anchor: 'start' });

  for (let i = 0; i <= 4; i++) {
    const y = gy + gh - ((lStep * i) / lMax) * gh;
    svg += line(gx, y, gx + gw, y, t.grid, 1)
      + T({ x: gx - 10, cy: y, s: (lStep * i).toLocaleString('en-US'), size: 15, fill: t.axis, anchor: 'end' })
      + T({ x: gx + gw + 14, cy: y, s: wAxisFmt.replace('{v}', (rStep * i).toLocaleString('en-US')), size: 15, fill: t.axis, anchor: 'start' });
  }
  svg += T({ x: gx - 10, cy: gy - 30, s: d.countUnit, size: 15, fill: t.axis, anchor: 'end' })
    + T({ x: gx + gw + 14, cy: gy - 30, s: d.wealthUnit, size: 15, fill: t.axis, anchor: 'start' })
    + line(gx, gy + gh, gx + gw, gy + gh, t.softLine, 1);

  svg += `<g id="柱series">`;
  d.counts.forEach((v, i) => {
    const x = gx + band * i + (band - barW) / 2;
    const h = (v / lMax) * gh, y = gy + gh - h, hl = i === last;
    svg += rect(x, y, barW, h, hl ? t.hlFill : t.barBot, hl ? { stroke: t.hlStroke, sw: 3 } : {})
      + T({ x: x + barW / 2, cy: y - 17, s: v.toLocaleString('en-US'), size: 16, fill: hl ? t.hlStroke : t.ink, weight: 700 });
  });
  svg += `</g>`;

  const pts = d.wealth.map((v, i) => [gx + band * i + band / 2, gy + gh - (v / rMax) * gh]);
  svg += `<g id="折线series">`
    + `<polyline points="${pts.map(p => R(p[0]) + ',' + R(p[1])).join(' ')}" fill="none" stroke="${t.line}" stroke-width="3"/>`;
  pts.forEach((p, i) => {
    // 折线上的数字落在柱子身上，垫一层白底才读得清（与 HTML 侧一致）
    const s = wLabelFmt.replace('{v}', Number(d.wealth[i]).toFixed(wDec));
    const chipW = textW(s, 16) + 12;
    svg += `<circle cx="${R(p[0])}" cy="${R(p[1])}" r="5.5" fill="${t.line}" stroke="#FFFFFF" stroke-width="2"/>`
      + rect(p[0] - chipW / 2, p[1] - 31, chipW, 24, '#FFFFFF', { rx: 5 })
      + T({ x: p[0], cy: p[1] - 19, s, size: 16, fill: t.line, weight: 700 });
  });
  svg += `</g><g id="横轴">`;
  d.years.forEach((y, i) => {
    const hl = i === last;
    svg += T({ x: gx + band * i + band / 2, cy: gy + gh + 26, s: y, size: 16,
      fill: hl ? t.hlStroke : t.xLabel, weight: hl ? 700 : 400 });
  });
  return svg + `</g></g>`;
}

// ---- bar：横向条形 + 数字对比卡 ----
function contentBar(d, top, bottom, t) {
  // 图表和数字卡左右并排（早期版本是卡片浮在图上，会把柱子盖住）
  const cardW = 296, cardGap = 20;
  const cardX = CX + CW - cardW;
  const gx = CX + 74, gw = (cardX - cardGap) - gx;
  const gy = top + 34, gh = bottom - top - 34 - 26;
  const labels = (d.barLabels || []).slice().reverse();
  const values = (d.barValues || []).slice().reverse();
  const { max, step } = niceScale(Math.max(...values), 6);
  const band = gh / labels.length, barH = band * 0.62;

  let svg = `<g id="内容区-横向条形加数字卡">`
    + T({ x: W / 2, cy: top + 27 * 0.7, s: d.barTitle, size: 27, fill: t.ink, weight: 700 });

  for (let v = 0; v <= max + 1e-6; v += step) {
    const x = gx + (v / max) * gw;
    svg += line(x, gy, x, gy + gh, t.split, 1)
      + T({ x, cy: gy - 14, s: String(R(v)), size: 14, fill: t.axis });
  }
  svg += `<g id="条形series">`;
  labels.forEach((lb, i) => {
    const y = gy + band * i + (band - barH) / 2;
    svg += rect(gx, y, (values[i] / max) * gw, barH, t.bar2, { rx: 1 })
      + T({ x: gx - 12, cy: gy + band * i + band / 2, s: lb, size: 14, fill: t.axis, anchor: 'end' });
  });
  svg += `</g>`;

  const cardPadX = 22, cardPadTop = 22, cardPadBot = 20;
  const leadLines = String(d.compareLead || '').split('\n');
  const leadLH = 21 * 1.45;
  const bigH = 12 + 40 * 1.2 + 12;
  const vsH = 44, cardGapV = 12;
  const cardH = cardPadTop + leadLines.length * leadLH + cardGapV + bigH + cardGapV + vsH + cardGapV
    + leadLines.length * leadLH + cardGapV + bigH + cardPadBot;
  const cardY = top + (bottom - top) / 2 - cardH / 2;

  let cy2 = cardY + cardPadTop;
  svg += `<g id="数字对比卡">` + rect(cardX, cardY, cardW, cardH, '#FFFFFF', { rx: 16 });
  leadLines.forEach((s, i) => {
    svg += T({ x: cardX + cardW / 2, cy: cy2 + leadLH * i + leadLH / 2, s, size: 21, fill: t.title, weight: 700 });
  });
  cy2 += leadLines.length * leadLH + cardGapV;
  svg += rect(cardX + cardPadX, cy2, cardW - cardPadX * 2, bigH, t.card, { rx: 10 })
    + T({ x: cardX + cardW / 2, cy: cy2 + bigH / 2, s: d.compareA, size: 40, fill: '#FFFFFF', weight: 700, ls: 1 });
  cy2 += bigH + cardGapV;
  svg += `<circle cx="${R(cardX + cardW / 2)}" cy="${R(cy2 + vsH / 2)}" r="${vsH / 2}" fill="${t.card}"/>`
    + T({ x: cardX + cardW / 2, cy: cy2 + vsH / 2, s: d.compareMid || 'V', size: 22, fill: '#FFFFFF', weight: 700 });
  cy2 += vsH + cardGapV;
  const lead2 = String(d.compareLead2 || '').split('\n');
  leadLines.forEach((_s, i) => {
    svg += T({ x: cardX + cardW / 2, cy: cy2 + leadLH * i + leadLH / 2, s: lead2[i] || '', size: 21, fill: t.title, weight: 700 });
  });
  cy2 += leadLines.length * leadLH + cardGapV;
  svg += rect(cardX + cardPadX, cy2, cardW - cardPadX * 2, bigH, t.card, { rx: 10 })
    + T({ x: cardX + cardW / 2, cy: cy2 + bigH / 2, s: d.compareB, size: 40, fill: '#FFFFFF', weight: 700, ls: 1 })
    + `</g>`;
  return svg + `</g>`;
}

// ---- stat：单数字冲击 ----
function contentStat(d, top, bottom, t) {
  const subs = d.statSubs || [];
  const subH = 15 + 15 + 22 * 1.5;
  const subTotal = subs.length * subH + Math.max(0, subs.length - 1) * 16;
  const unitW = textW(d.statUnit || '', 62);
  const valSize = fitSize(d.statValue, 170, CW - unitW - 40, 0);
  const totalH = valSize + 30 + 30 * 1.4 + 52 + subTotal;
  let y = top + Math.max(0, (bottom - top - totalH) / 2);

  const valW = textW(d.statValue, valSize);
  const startX = W / 2 - (valW + 12 + unitW) / 2;

  let svg = `<g id="内容区-单数字冲击">`
    + T({ x: startX, cy: y + valSize / 2, s: d.statValue, size: valSize, fill: t.title, weight: 700, anchor: 'start' })
    + T({ x: startX + valW + 12, cy: y + valSize * 0.82, s: d.statUnit, size: 62, fill: t.title, weight: 700, anchor: 'start' });
  y += valSize + 30;

  svg += T({ x: W / 2, cy: y + (30 * 1.4) / 2, s: d.statLabel, size: 30, fill: t.axis, weight: 700, family: TITLE_FONT, ls: 1 });
  y += 30 * 1.4 + 52;

  subs.forEach((s, i) => {
    const sy = y + i * (subH + 16);
    svg += rect(CX, sy, CW, subH, t.soft, { rx: 8 })
      + rect(CX, sy, 6, subH, t.card, { rx: 3 })
      + T({ x: CX + 24, cy: sy + subH / 2, s, size: 22, fill: t.axis, anchor: 'start' });
  });
  return svg + `</g>`;
}

// ---- list：编号清单 ----
function contentList(d, top, bottom, t) {
  const items = d.listItems || [];
  const n = items.length || 1;
  const titleH = 32 * 1.4;
  const itemH = 108;
  const listTop = top + titleH + 16;
  // 和 HTML 的 justify-content:space-evenly 对齐：n 个条目在可用高度里均分
  const slot = Math.max(0, (bottom - listTop - n * itemH) / (n + 1));

  let svg = `<g id="内容区-编号清单">`
    + T({ x: CX, cy: top + titleH / 2, s: d.listTitle, size: 32, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  items.forEach((it, i) => {
    const iy = listTop + slot + i * (itemH + slot);
    const mid = iy + itemH / 2;
    svg += rect(CX, iy, CW, itemH, t.soft, { rx: 14 })
      + rect(CX, iy, 6, itemH, t.card, { rx: 3 })
      + rect(CX + 20, mid - 23, 46, 46, t.card, { rx: 13 })
      + T({ x: CX + 43, cy: mid, s: String(i + 1), size: 24, fill: '#FFFFFF', weight: 700 })
      + T({ x: CX + 84, cy: mid - 19, s: it.h, size: 28, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' })
      + T({ x: CX + 84, cy: mid + 20, s: it.p, size: 20, fill: t.axis, anchor: 'start' });
  });
  return svg + `</g>`;
}

// ---- compare：左右对比 ----
function contentCmp(d, top, bottom, t) {
  const colW = (CW - 16) / 2;
  const titleH = 32 * 1.4;
  const colY = top + titleH + 30;
  const colH = Math.max(140, bottom - colY);
  const padX = 24, padY = 26, headLH = 27 * 1.3, ruleGap = 16, listGap = 18, lineH = 30;

  let svg = `<g id="内容区-左右对比">`
    + T({ x: W / 2, cy: top + titleH / 2, s: d.cmpTitle, size: 32, fill: t.title, weight: 700, family: TITLE_FONT });

  [[0, 'l', d.cmpLeftTitle, d.cmpLeftItems], [1, 'r', d.cmpRightTitle, d.cmpRightItems]].forEach(([i, kind, title, list]) => {
    const x = CX + i * (colW + 16);
    svg += kind === 'l'
      ? rect(x, colY, colW, colH, '#FFFFFF', { rx: 16, stroke: t.softLine, sw: 2 })
      : rect(x, colY, colW, colH, t.card, { rx: 16 });

    const headFill = kind === 'l' ? t.title : '#FFFFFF';
    const itemFill = kind === 'l' ? t.axis : '#FFFFFF';
    const dotFill = kind === 'l' ? t.card : '#FFFFFF';
    const ruleFill = kind === 'l' ? t.softLine : '#FFFFFF';

    const headCy = colY + padY + headLH / 2;
    const ruleY = colY + padY + headLH + ruleGap;
    svg += T({ x: x + padX, cy: headCy, s: title, size: 27, fill: headFill, weight: 700, family: TITLE_FONT, anchor: 'start' })
      + line(x + padX, ruleY, x + colW - padX, ruleY, ruleFill, 2, kind === 'l' ? 1 : 0.32);

    // 与 HTML 的 space-evenly 对齐
    const rows = list || [];
    const listTop = ruleY + listGap;
    const listBot = colY + colH - padY;
    const free = Math.max(0, (listBot - listTop) - rows.length * lineH);
    const slot = free / (rows.length + 1);
    rows.forEach((s, k) => {
      const cy = listTop + slot + k * (lineH + slot) + lineH / 2;
      svg += `<circle cx="${R(x + padX + 4.5)}" cy="${R(cy)}" r="4.5" fill="${dotFill}"`
        + (kind === 'r' ? ' opacity="0.55"' : '') + `/>`
        + T({ x: x + padX + 24, cy, s, size: 20, fill: itemFill, anchor: 'start', opacity: kind === 'l' ? 1 : 0.92 });
    });
  });
  return svg + `</g>`;
}

// ---- timeline：时间轴 ----
function contentTl(d, top, bottom, t) {
  const items = d.tlItems || [];
  const n = items.length || 1;
  const titleH = 32 * 1.4;
  const itemH = 90;
  const listTop = top + titleH + 16;
  const slot = Math.max(0, (bottom - listTop - n * itemH) / (n + 1));
  const railX = CX + 122;

  let svg = `<g id="内容区-时间轴">`
    + T({ x: CX, cy: top + titleH / 2, s: d.tlTitle, size: 32, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  const firstCy = listTop + slot + 24;
  const lastCy = listTop + slot + (n - 1) * (itemH + slot) + 24;
  svg += line(railX, firstCy, railX, lastCy, t.softLine, 2);

  items.forEach((it, i) => {
    const iy = listTop + slot + i * (itemH + slot);
    svg += T({ x: CX + 86, cy: iy + 24, s: it.t, size: 25, fill: t.card, weight: 700, anchor: 'end' })
      + `<circle cx="${R(railX)}" cy="${R(iy + 24)}" r="8" fill="${t.card}" stroke="#FFFFFF" stroke-width="3"/>`
      + T({ x: CX + 140, cy: iy + 20, s: it.h, size: 26, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' })
      + T({ x: CX + 140, cy: iy + 54, s: it.p, size: 19, fill: t.axis, anchor: 'start' });
  });
  return svg + `</g>`;
}

/* ===== 以下 4 个版式是 2026-09-16 新增，与 贴图模板.html 同源 =====
   用来替掉纯文字版的对比 / 清单 / 时间轴 / 单图。字段与 HTML 完全一致。 */

// ---- vs：对峙式对比（每侧先压成一个结论词，中间 VS 徽章） ----
function contentVs(d, top, bottom, t) {
  const titleH = 31 * 1.4;
  const stageTop = top + titleH + 22;
  const stageH = Math.max(160, bottom - stageTop);
  const midW = 68, padX = 20, padY = 26, padB = 22, barH = 8;
  const sideW = (CW - midW) / 2;
  const tagH = 8 * 2 + 22 * 1.25;      // 直角色块（原来是胶囊）
  const nmH = 40 * 1.15;               // 结论词 40px
  const liSize = 19, liLH = 1.42;
  const fitSize_ = 18, fitPadY = 9;

  let svg = `<g id="内容区-对峙对比">`
    + T({ x: CX, cy: top + titleH / 2, s: d.vsTitle, size: 31, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  [[0, false, d.vsLeftTag, d.vsLeftTitle, d.vsLeftItems, d.vsLeftFit],
   [1, true, d.vsRightTag, d.vsRightTitle, d.vsRightItems, d.vsRightFit]].forEach(([i, onCard, tag, nm, items, fit]) => {
    const x = CX + i * (sideW + midW);
    // 卡片本体 + 顶部 8px 主题色条（海报的"色块分割"），靠 clipPath 保证圆角
    const cid = 'vsclip' + (++clipSeq);
    svg += `<defs><clipPath id="${cid}"><rect x="${R(x)}" y="${R(stageTop)}" width="${R(sideW)}" height="${R(stageH)}" rx="18"/></clipPath></defs>`
      + `<g clip-path="url(#${cid})">`
      + rect(x, stageTop, sideW, stageH, onCard ? t.card : '#FFFFFF')
      + rect(x, stageTop, sideW, barH, onCard ? '#FFFFFF' : t.card)
      + `</g>`;
    if (!onCard) svg += rect(x, stageTop, sideW, stageH, 'none', { rx: 18, stroke: t.softLine, sw: 2 });

    const inkFill = onCard ? '#FFFFFF' : t.title;
    const liFill = onCard ? '#FFFFFF' : t.axis;
    const dotFill = onCard ? '#FFFFFF' : t.card;

    let y = stageTop + padY;
    if (tag) {
      const tw = Math.min(sideW - padX * 2, textW(tag, 22) + 2 * Math.max(0, [...tag].length - 1) + 44);
      svg += rect(x + (sideW - tw) / 2, y, tw, tagH, onCard ? '#FFFFFF' : t.card, { rx: 8 })
        + T({ x: x + sideW / 2, cy: y + tagH / 2, s: tag, size: 22, fill: onCard ? t.card : '#FFFFFF', weight: 800, ls: 2 });
      y += tagH;
    }
    if (nm) {
      svg += T({ x: x + sideW / 2, cy: y + 16 + nmH / 2, s: nm, size: 40, fill: inkFill, weight: 700, family: TITLE_FONT, ls: 1 });
      y += 16 + nmH;
    }

    const listTop = y + 14;
    const fitH = fit ? 16 + fitPadY * 2 + fitSize_ * 1.4 : 0;
    const listBot = stageTop + stageH - padB - fitH;
    const liAvail = sideW - padX * 2 - 19;
    const liH = liSize * liLH;
    const rows = (items || []).map(s => wrapText(s, liSize, liAvail));
    const totalH = rows.reduce((a, b) => a + b.length * liH, 0);
    const slot = Math.max(0, (listBot - listTop - totalH) / (rows.length + 1));

    let ly = listTop + slot;
    rows.forEach(lines => {
      lines.forEach((ln, k) => {
        const cy = ly + k * liH + liH / 2;
        if (k === 0) {
          svg += `<circle cx="${R(x + padX + 4)}" cy="${R(cy)}" r="4" fill="${dotFill}"`
            + (onCard ? ' opacity="0.6"' : '') + `/>`;
        }
        svg += T({ x: x + padX + 19, cy, s: ln, size: liSize, fill: liFill, anchor: 'start', opacity: onCard ? 0.93 : 1 });
      });
      ly += lines.length * liH + slot;
    });

    // "适合谁"收尾：实心胶囊（原来是虚线细字，太弱）
    if (fit) {
      const fH = fitPadY * 2 + fitSize_ * 1.4;
      const fy = stageTop + stageH - padB - fH;
      const fw = Math.min(sideW - padX * 2, textW(fit, fitSize_) + 2 * Math.max(0, [...fit].length - 1) + 36);
      const fx = x + (sideW - fw) / 2;
      svg += onCard
        ? `<rect x="${R(fx)}" y="${R(fy)}" width="${R(fw)}" height="${R(fH)}" rx="${R(fH / 2)}" fill="#FFFFFF" opacity="0.18"/>`
        : rect(fx, fy, fw, fH, t.soft, { rx: fH / 2 });
      svg += T({ x: x + sideW / 2, cy: fy + fH / 2, s: fit, size: fitSize_, fill: onCard ? '#FFFFFF' : t.title, weight: 700 });
    }
  });

  // 中间 VS 徽章：68px + 倾斜 -7° + 白色外环
  const midCx = CX + sideW + midW / 2;
  const midCy = stageTop + stageH * 0.5;
  svg += `<g transform="rotate(-7 ${R(midCx)} ${R(midCy)})">`
    + `<circle cx="${R(midCx)}" cy="${R(midCy)}" r="40" fill="#FFFFFF"/>`
    + `<circle cx="${R(midCx)}" cy="${R(midCy)}" r="34" fill="${t.title}"/>`
    + T({ x: midCx, cy: midCy, s: d.vsMid || 'VS', size: 26, fill: '#FFFFFF', weight: 800, ls: 0.5 })
    + `</g>`;
  return svg + `</g>`;
}

// ---- cards：编号行动卡（实心色块编号 + 倾斜贴纸标签，warn 用固定警示红） ----
function contentCards(d, top, bottom, t) {
  const titleH = 31 * 1.4;
  const listTop = top + titleH + 16;
  const rows = d.cards || [];
  const n = rows.length || 1;
  const padX = 22, padY = 18, barW = 8, gap = 18;
  const noD = 74, noRx = 18;                 // 编号：实心色块，不是淡色水印
  const bodyX = CX + barW + padX + noD + gap;
  const bodyAvail = CW - (bodyX - CX) - padX;
  const hdH = 28 * 1.25, badgeH = 17 * 1.25 + 12, pH = 20 * 1.5 + 7;
  const innerH = Math.max(noD, hdH + pH);
  const cardH = padY * 2 + innerH;
  const slot = Math.max(0, (bottom - listTop - n * cardH) / (n + 1));

  let svg = `<g id="内容区-行动卡">`
    + T({ x: CX, cy: top + titleH / 2, s: d.cardsTitle, size: 31, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  rows.forEach((c, i) => {
    const y = listTop + slot + i * (cardH + slot);
    const warn = !!c.warn;
    const acc = warn ? '#CE4038' : t.card;          // 警示刻意脱离主题色
    const bg = warn ? '#FCEDEA' : t.soft;
    const cid = 'cardclip' + (++clipSeq);
    svg += `<defs><clipPath id="${cid}"><rect x="${R(CX)}" y="${R(y)}" width="${R(CW)}" height="${R(cardH)}" rx="16"/></clipPath></defs>`
      + `<g clip-path="url(#${cid})">`
      + rect(CX, y, CW, cardH, bg)
      + rect(CX, y, barW, cardH, acc)
      + `</g>`
      + rect(CX + barW + padX, y + cardH / 2 - noD / 2, noD, noD, acc, { rx: noRx })
      + T({ x: CX + barW + padX + noD / 2, cy: y + cardH / 2, s: c.n || String(i + 1).padStart(2, '0'), size: 34, fill: '#FFFFFF', weight: 800, ls: -1 });

    const bodyTop = y + padY + (innerH - (hdH + pH)) / 2;
    const hdCy = bodyTop + hdH / 2;
    const bdgW = c.tag ? textW(c.tag, 17) + 2 * Math.max(0, [...String(c.tag)].length - 1) + 30 : 0;
    const bSize = fitSize(c.h, 28, bodyAvail - (bdgW ? bdgW + 12 : 0), 0, 18);
    svg += T({ x: bodyX, cy: hdCy, s: c.h, size: bSize, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });
    if (c.tag) {
      // 倾斜贴纸：SVG 没有 box-shadow，用一块偏移的半透明黑垫在下面代替
      const bx = bodyX + textW(c.h, bSize) + 12;
      const by = hdCy - badgeH / 2;
      const bxc = bx + bdgW / 2, byc = by + badgeH / 2;
      svg += `<g transform="rotate(-4 ${R(bxc)} ${R(byc)})">`
        + `<rect x="${R(bx + 2)}" y="${R(by + 3)}" width="${R(bdgW)}" height="${R(badgeH)}" rx="6" fill="#101828" opacity="0.14"/>`
        + rect(bx, by, bdgW, badgeH, acc, { rx: 6 })
        + T({ x: bxc, cy: byc, s: c.tag, size: 17, fill: '#FFFFFF', weight: 800, ls: 1 })
        + `</g>`;
    }
    svg += TBlock({ x: bodyX, y: bodyTop + hdH + 7, s: c.p, size: 20, lh: 1.5, avail: bodyAvail, fill: t.axis, anchor: 'start' }).svg;
  });
  return svg + `</g>`;
}

// ---- steps：四步阶梯（逐级右移 34px，末级主题色反白当落点） ----
function contentSteps(d, top, bottom, t) {
  const titleH = 31 * 1.4;
  const listTop = top + titleH + 14;
  const rows = d.stItems || [];
  const n = rows.length || 1;
  const padX = 20, padY = 13, barW = 8, dotD = 54, dotRx = 16, gap = 18, step = 34;
  const whenSize = 19, hSize = 29, pSize = 19;
  const innerW = i => CW - i * step - barW - padX * 2 - dotD - gap;

  // 先按折行算每级真实高度（文案长短不一，固定高度会把末级顶出页脚）
  const blocks = rows.map((it, i) => {
    const avail = innerW(i);
    const whenW = textW(it.t || '', whenSize);
    const hLines = wrapText(it.h || '', hSize, Math.max(80, avail - whenW - 10));
    const pLines = wrapText(it.p || '', pSize, avail);
    const textH = hLines.length * hSize * 1.3 + 5 + pLines.length * pSize * 1.45;
    return { whenW, hLines, pLines, innerH: Math.max(dotD, textH) };
  });
  const heights = blocks.map(b => padY * 2 + 4 + b.innerH);
  const slot = Math.max(0, (bottom - listTop - heights.reduce((a, b) => a + b, 0)) / (n + 1));

  let svg = `<g id="内容区-四步阶梯">`
    + T({ x: CX, cy: top + titleH / 2, s: d.stTitle, size: 31, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  let y = listTop + slot;
  rows.forEach((it, i) => {
    const last = i === n - 1;
    const b = blocks[i];
    const cardH = heights[i];
    const x = CX + i * step;
    const w = CW - i * step;
    const bg = last ? t.card : (i % 2 === 1 ? t.soft : '#FFFFFF');
    const stroke = last ? t.card : t.softLine;
    const inkFill = last ? '#FFFFFF' : t.title;
    const bodyFill = last ? '#FFFFFF' : t.axis;

    const cid = 'stclip' + (++clipSeq);
    svg += `<defs><clipPath id="${cid}"><rect x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(cardH)}" rx="14"/></clipPath></defs>`
      + `<g clip-path="url(#${cid})">`
      + rect(x, y, w, cardH, bg)
      + rect(x, y, barW, cardH, last ? t.card : t.card)
      + `</g>`
      + rect(x, y, w, cardH, 'none', { rx: 14, stroke, sw: 2 })
      + rect(x + barW + padX, y + cardH / 2 - dotD / 2, dotD, dotD, last ? '#FFFFFF' : t.card, { rx: dotRx })
      + T({ x: x + barW + padX + dotD / 2, cy: y + cardH / 2, s: String(i + 1), size: 26, fill: last ? t.card : '#FFFFFF', weight: 800 });

    const bx = x + barW + padX + dotD + gap;
    const bodyH = b.hLines.length * hSize * 1.3 + 5 + b.pLines.length * pSize * 1.45;
    let yy = y + padY + 2 + (b.innerH - bodyH) / 2;
    const lineCy = yy + hSize * 1.3 / 2;
    svg += T({ x: bx, cy: lineCy, s: it.t, size: whenSize, fill: last ? '#FFFFFF' : t.card, weight: 700, ls: 1, anchor: 'start', opacity: last ? 0.85 : 1 });
    b.hLines.forEach((ln, k) => {
      svg += T({
        x: k === 0 ? bx + b.whenW + 10 : bx, cy: lineCy + k * hSize * 1.3, s: ln,
        size: hSize, fill: inkFill, weight: 700, family: TITLE_FONT, anchor: 'start'
      });
    });
    yy += b.hLines.length * hSize * 1.3 + 5;
    b.pLines.forEach((ln, k) => {
      svg += T({ x: bx, cy: yy + k * pSize * 1.45 + pSize * 1.45 / 2, s: ln, size: pSize, fill: bodyFill, anchor: 'start', opacity: last ? 0.9 : 1 });
    });
    y += cardH + slot;
  });
  return svg + `</g>`;
}

// ---- hero：大图压一句大字结论 + 图下三张短要点卡 ----
function contentHero(d, top, bottom, t) {
  const bodyGap = 18, hiGap = 14, hiPadX = 16, hiPadY = 14, hiBar = 6;
  const hiW = (CW - hiGap * 2) / 3;
  const hiAvail = hiW - hiPadX * 2;
  const items = (d.heroItems || []).slice(0, 3);
  const capSize = 54, leadSize = 21, kSize = 40, hSize = 22, pSize = 17;
  const capNeed = capSize * 1.18 + (d.heroLead ? 12 + leadSize * 1.35 : 0);

  let bodyH = 0;
  const blocks = items.map(it => {
    const bLines = wrapText(it.h || '', hSize, hiAvail);
    const pLines = wrapText(it.p || '', pSize, hiAvail);
    const h = hiPadY * 2 + hiBar + kSize + 9 + bLines.length * hSize * 1.3
      + (it.p ? 6 + pLines.length * pSize * 1.45 : 0);
    bodyH = Math.max(bodyH, h);
    return { bLines, pLines };
  });

  const stageH = Math.max(160, (bottom - top) - bodyGap - bodyH);
  const stageTop = top;

  let svg = `<g id="内容区-大图压标题">`
    + imgCard(d.img, CX, stageTop, CW, stageH, t, '在此放主图（校园 / 现场 / 实拍）', null, 16)
    + `<defs><linearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="#000000" stop-opacity="0"/>`
    + `<stop offset="0.42" stop-color="#000000" stop-opacity="0.32"/>`
    + `<stop offset="1" stop-color="#000000" stop-opacity="0.8"/>`
    + `</linearGradient></defs>`
    + rect(CX, stageTop + stageH * 0.28, CW, stageH * 0.72, 'url(#heroScrim)');

  const capBottom = stageTop + stageH - 26;
  let cy = capBottom - capNeed;
  if (d.heroTitle) {
    // 大字主视觉：先垫一条半透明白色高亮块（模拟 CSS 的 linear-gradient 下划线），再压字
    const n = [...String(d.heroTitle)].length;
    const capW = textW(d.heroTitle, capSize) + 2 * Math.max(0, n - 1) + 28;
    const capLineH = capSize * 1.18;
    svg += `<rect x="${R(W / 2 - capW / 2)}" y="${R(cy + capLineH * 0.64)}" width="${R(capW)}"`
      + ` height="${R(capLineH * 0.36)}" fill="#FFFFFF" opacity="0.28"/>`
      + T({ x: W / 2, cy: cy + capLineH / 2, s: d.heroTitle, size: capSize, fill: '#FFFFFF', weight: 700, family: TITLE_FONT, ls: 2 });
    cy += capLineH;
  }
  if (d.heroLead) {
    svg += T({ x: W / 2, cy: cy + 12 + leadSize * 1.35 / 2, s: d.heroLead, size: leadSize, fill: '#FFFFFF', weight: 400, ls: 1, opacity: 0.94 });
  }
  svg += `</g>`;

  const bodyTop = stageTop + stageH + bodyGap;
  let g = `<g id="内容区-大图压标题-要点">`;
  items.forEach((it, i) => {
    const x = CX + i * (hiW + hiGap);
    const b = blocks[i];
    const cid = 'hiclip' + (++clipSeq);
    g += `<defs><clipPath id="${cid}"><rect x="${R(x)}" y="${R(bodyTop)}" width="${R(hiW)}" height="${R(bodyH)}" rx="13"/></clipPath></defs>`
      + `<g clip-path="url(#${cid})">`
      + rect(x, bodyTop, hiW, bodyH, t.soft)
      + rect(x, bodyTop, hiW, hiBar, t.card)
      + `</g>`
      + T({ x: x + hiPadX, cy: bodyTop + hiPadY + kSize / 2, s: String(i + 1).padStart(2, '0'), size: kSize, fill: t.card, weight: 800, anchor: 'start', ls: -2 });
    let yy = bodyTop + hiPadY + hiBar + kSize + 9;
    b.bLines.forEach((ln, k) => {
      g += T({ x: x + hiPadX, cy: yy + k * hSize * 1.3 + hSize * 1.3 / 2, s: ln, size: hSize, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });
    });
    yy += b.bLines.length * hSize * 1.3;
    if (it.p) {
      yy += 6;
      b.pLines.forEach((ln, k) => {
        g += T({ x: x + hiPadX, cy: yy + k * pSize * 1.45 + pSize * 1.45 / 2, s: ln, size: pSize, fill: t.axis, anchor: 'start' });
      });
    }
  });
  return svg + g + `</g>`;
}

// ---- bigword：巨型字主视觉（文字当图形 + 满幅色块垫 + -3° 破网格） ----
function contentBigword(d, top, bottom, t) {
  const titleH = 31 * 1.4;
  const keys = (d.bwKeys || []).slice(0, 3);
  const noteSize = 24, keyK = 30, keyV = 18, keyPadX = 12, keyPadY = 15, keyGap = 14;
  const keyW = keys.length ? (CW - keyGap * (keys.length - 1)) / keys.length : 0;
  const keyAvail = keyW - keyPadX * 2;
  const noteLines = d.bwNote ? wrapText(d.bwNote, noteSize, CW) : [];
  const noteH = noteLines.length ? 26 + noteLines.length * noteSize * 1.55 : 0;
  let keyH = 0;
  const kBlocks = keys.map(k => {
    const vL = wrapText(k.v || '', keyV, keyAvail);
    keyH = Math.max(keyH, keyPadY * 2 + keyK + 9 + vL.length * keyV * 1.35);
    return vL;
  });
  const keysH = keys.length ? 22 + keyH : 0;

  const stageTop = top + (d.bwTitle ? titleH : 0);
  const stageH = Math.max(120, bottom - noteH - keysH - stageTop);

  // 巨型字宽度自适应：4 个字会缩到 ~165px；字距 -0.032em 与 HTML 同步
  const wordStr = String(d.bwWord || '');
  const nCh = [...wordStr].length;
  const uN = d.bwUnit ? [...String(d.bwUnit)].length : 0;
  const textOnly = ws => textW(wordStr, ws) - 0.032 * ws * Math.max(0, nCh - 1);
  const unitExtra = ws => (uN ? (0.26 * uN + 0.45 * 0.26) * ws : 0);
  let ws = 210;
  while (ws > 110 && textOnly(ws) + unitExtra(ws) > CW - 24) ws -= 2;

  const boxH = ws * 0.96;
  const boxTop = stageTop + (stageH - boxH) / 2;
  const boxBottom = boxTop + boxH;
  const cx = W / 2, cy = boxTop + boxH / 2;

  let g = `<g id="内容区-巨型字">`;
  if (d.bwTitle) g += T({ x: CX, cy: top + titleH / 2, s: d.bwTitle, size: 31, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });
  // 色块垫：左右顶到卡片内边距外；满幅时再往外顶到画布边。字的下半段压在它上面
  const bw = bleedBox(d);
  g += rect(bw.x, boxBottom - 0.40 * ws, bw.w, 0.34 * ws, t.soft);
  g += `<g transform="rotate(-3 ${R(cx)} ${R(cy)})">`
    + T({ x: cx, cy, s: wordStr, size: ws, fill: t.card, weight: 900, family: TITLE_FONT, ls: -0.032 * ws });
  if (d.bwUnit) {
    const uSize = 0.26 * ws;
    // 与 HTML 一致：小单位跟大字共用基线，接在字尾
    g += T({
      x: cx - (textOnly(ws) + unitExtra(ws)) / 2 + textOnly(ws) + 0.45 * uSize + uSize * uN / 2,
      cy: cy + ws * 0.36 - uSize * 0.36, s: d.bwUnit, size: uSize, fill: t.card, weight: 700
    });
  }
  g += `</g>`;

  if (noteLines.length) {
    const ny = bottom - keysH - noteH + 26;
    noteLines.forEach((ln, k) => {
      g += T({ x: W / 2, cy: ny + k * noteSize * 1.55 + noteSize * 1.55 / 2, s: ln, size: noteSize, fill: t.axis, weight: 500 });
    });
  }
  keys.forEach((k, i) => {
    const x = CX + i * (keyW + keyGap);
    const warn = !!k.warn;
    const y = bottom - keyH;
    g += rect(x, y, keyW, keyH, warn ? '#FCEDEA' : t.soft, { rx: 10 })
      + T({ x: x + keyW / 2, cy: y + keyPadY + keyK / 2, s: k.k, size: keyK, fill: warn ? '#CE4038' : t.card, weight: 800, ls: -1 });
    let vy = y + keyPadY + keyK + 9;
    kBlocks[i].forEach((ln, j) => {
      g += T({ x: x + keyW / 2, cy: vy + j * keyV * 1.35 + keyV * 1.35 / 2, s: ln, size: keyV, fill: t.axis });
    });
  });
  return g + `</g>`;
}

// ---- band：横向色带分割（满幅出血 · 零间距 · 色带等高） ----
function contentBand(d, top, bottom, t) {
  const titleH = 31 * 1.4;
  const rows = d.bands || [];
  const n = rows.length || 1;
  const stackTop = top + (d.bandTitle ? titleH + 18 : 0);
  const stackH = Math.max(120, bottom - stackTop);
  const bandH = stackH / n;
  const numSize = 76, hSize = 30, pSize = 20, numW = 112, gap = 24;
  const bodyX = CX + numW + gap;
  const bodyAvail = CW - numW - gap;
  const bx = bleedBox(d);

  let g = `<g id="内容区-色带分割">`;
  if (d.bandTitle) g += T({ x: CX, cy: top + titleH / 2, s: d.bandTitle, size: 31, fill: t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });

  rows.forEach((b, i) => {
    const y = stackTop + i * bandH;
    const tone = b.warn ? 'warn' : (b.tone || (i % 2 === 0 ? 'dark' : 'soft'));
    const bg = tone === 'warn' ? '#CE4038' : tone === 'dark' ? t.card : tone === 'soft' ? t.soft : '#FFFFFF';
    const dark = tone === 'dark' || tone === 'warn';
    // 色带左右出血到卡片内边距之外（满幅时一直顶到画布边），彼此零间距 —— 分割本身就是装饰。
    // 带内文字仍对齐固定位置：不跟着出血走，否则满幅后文字会贴到画布边上。
    g += rect(bx.x, y, bx.w, bandH, bg);
    if (tone === 'plain') {
      // 对齐 HTML 的 inset box-shadow：上下各一条 2px 细线画在带子内侧
      g += line(bx.x, y + 1, bx.x + bx.w, y + 1, t.softLine, 2)
        + line(bx.x, y + bandH - 1, bx.x + bx.w, y + bandH - 1, t.softLine, 2);
    }
    g += T({ x: CX + numW / 2, cy: y + bandH / 2, s: b.n || String(i + 1).padStart(2, '0'), size: numSize, fill: dark ? '#FFFFFF' : t.card, weight: 900, ls: -4 });
    const hLines = wrapText(b.h || '', hSize, bodyAvail);
    const pLines = b.p ? wrapText(b.p, pSize, bodyAvail) : [];
    const textH = hLines.length * hSize * 1.25 + (pLines.length ? 6 + pLines.length * pSize * 1.5 : 0);
    let yy = y + bandH / 2 - textH / 2;
    hLines.forEach((ln, k) => {
      g += T({ x: bodyX, cy: yy + k * hSize * 1.25 + hSize * 1.25 / 2, s: ln, size: hSize, fill: dark ? '#FFFFFF' : t.title, weight: 700, family: TITLE_FONT, anchor: 'start' });
    });
    yy += hLines.length * hSize * 1.25 + 6;
    pLines.forEach((ln, k) => {
      g += T({ x: bodyX, cy: yy + k * pSize * 1.5 + pSize * 1.5 / 2, s: ln, size: pSize, fill: dark ? '#FFFFFF' : t.axis, anchor: 'start', opacity: dark ? 0.88 : undefined });
    });
  });
  return g + `</g>`;
}

/* ---- cover：满幅底图 + 左对齐大字 + 底部满幅数字带 ----
   与 贴图模板.html 的 .ly-cover 一一对应。
   这里最麻烦的是大字里的 <em>：HTML 靠 box-shadow: inset 做行内底衬，
   SVG 没有这东西，只能先解析出高亮片段、在文字**下面**铺一条色块，
   再按片段逐段画字（每段的 x 自己累加，否则高亮块和字对不上）。 */
function parseEm(str) {
  const out = [];
  const re = /<em>([\s\S]*?)<\/em>/g;
  let last = 0, m;
  while ((m = re.exec(String(str)))) {
    if (m.index > last) out.push({ s: String(str).slice(last, m.index), hl: false });
    out.push({ s: m[1], hl: true });
    last = m.index + m[0].length;
  }
  if (last < String(str).length) out.push({ s: String(str).slice(last), hl: false });
  return out.filter(x => x.s !== '');
}

/* 按「片段」折行：返回 [[{s,hl},…], …]，内层数组是一行。
   字间距要算进宽度 —— 大字用了 -0.01em，漏掉它每行会多算 8px 左右、折行位置就和 PNG 不一样。 */
function wrapRich(segs, size, avail, ls = 0) {
  const lines = [];
  let cur = [], curW = 0;
  for (const seg of segs) {
    let buf = '';
    for (const ch of [...seg.s]) {
      const w = textW(ch, size) + ls;
      if (curW + w > avail && (cur.length || buf)) {
        if (buf) { cur.push({ s: buf, hl: seg.hl }); buf = ''; }
        lines.push(cur); cur = []; curW = 0;
      }
      buf += ch; curW += w;
    }
    if (buf) cur.push({ s: buf, hl: seg.hl });
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

function contentCover(d, top, bottom, t) {
  const BIG = 82, BLH = 1.16, BLS = -0.01 * BIG;
  const NOTE = 23, NLH = 1.55, GAP = 22;
  const KEYGAP = 36, KEYPAD = 22, KH = 40 * 1.1, KVGAP = 6, VH = 18 * 1.4;

  const bigLines = wrapRich(parseEm(d.cvBig || ''), BIG, CW, BLS);
  const noteLines = d.cvNote ? wrapText(d.cvNote, NOTE, CW) : [];
  const keys = d.cvKeys || [];
  const n = keys.length;

  // 数字带按整张画布均分（满幅出血），每列内宽随首末列的内边距不同
  const colW = n ? W / n : 0;
  const innerW = i => colW - (i === 0 ? 76 : 24) - (i === n - 1 ? 76 : 24);
  const keyMeta = keys.map((kv, i) => ({
    kSize: fitSize(kv.k, 40, innerW(i), 0, 22),
    vLines: kv.v ? wrapText(kv.v, 18, innerW(i)) : []
  }));
  const maxVL = keyMeta.reduce((a, m) => Math.max(a, m.vLines.length), 0);
  const keyH = n ? KEYPAD * 2 + KH + KVGAP + maxVL * VH : 0;

  const bigH = bigLines.length * BIG * BLH;
  const noteH = noteLines.length ? GAP + noteLines.length * NOTE * NLH : 0;
  const keysTop = bottom - keyH;
  const noteTop = keysTop - (n ? KEYGAP : 0) - noteH;
  const bigTop = noteTop - bigH;

  let g = `<g id="内容区-满幅封面">`;

  // 顶部小标签：直角小色条 + 一行小字
  if (d.cvTag) {
    const tg = fitSize(d.cvTag, 22, CW - 60, 4, 16);
    g += rect(CX, top + 8, 46, 10, t.badge)
      + T({ x: CX + 60, cy: top + 13, s: d.cvTag, size: tg, fill: t.title, weight: 700, ls: 4, anchor: 'start' });
  }

  // 大字：先铺高亮底衬，再逐片段画字
  bigLines.forEach((ln, li) => {
    const cy = bigTop + li * BIG * BLH + BIG * BLH / 2;
    let x = CX;
    for (const seg of ln) {
      const w = textW(seg.s, BIG) + BLS * seg.s.length;
      if (seg.hl) g += rect(x, cy + BIG * 0.36 - 16, w, 16, t.soft);
      g += T({ x, cy, s: seg.s, size: BIG, fill: seg.hl ? t.card : t.title, weight: 900, family: TITLE_FONT, ls: BLS, anchor: 'start' });
      x += w;
    }
  });

  noteLines.forEach((ln, i) => {
    g += T({ x: CX, cy: noteTop + i * NOTE * NLH + NOTE * NLH / 2, s: ln, size: NOTE, fill: t.axis, anchor: 'start' });
  });

  // 数字带：左右顶到画布边（x = 0..810），里面的文字仍对齐 76px
  let x = 0;
  keys.forEach((kv, i) => {
    const m = keyMeta[i], warn = !!kv.warn;
    g += rect(x, keysTop, colW, keyH, warn ? '#FCEDEA' : '#FFFFFF', { op: warn ? 1 : 0.9 })
      + rect(x, keysTop, 5, keyH, warn ? '#CE4038' : t.badge);
    const tx = x + (i === 0 ? 76 : 24);
    g += T({ x: tx, cy: keysTop + KEYPAD + KH / 2, s: kv.k, size: m.kSize, fill: warn ? '#CE4038' : t.card, weight: 800, anchor: 'start' });
    m.vLines.forEach((ln, k) => {
      g += T({ x: tx, cy: keysTop + KEYPAD + KH + KVGAP + k * VH + VH / 2, s: ln, size: 18, fill: t.axis, anchor: 'start' });
    });
    x += colW;
  });

  return g + `</g>`;
}

/* ---- circle：正负形圆形分割 ----
   一个大圆色块把版面切成「圆内 / 圆外」：圆内压主信息（反白），圆外四角压角注。
   圆直径与角注宽度这一段公式必须和 贴图模板.html 的 render() 逐字对齐 ——
   CSS 里表达不出「横向出血 + 竖向不顶出内容区 + 四角还得留得下人」，
   只能两边各算一次，所以两边都写了同一组 NOTE_H / PAD / CW_MIN / dx0。 */
const INNER_W = 434;   // 圆内文字块宽度（= HTML 里 .cc-in 的 width，658 的 66%）
function contentCircle(d, top, bottom, t) {
  const NOTE_H = 78, PAD = 8, CW_MIN = 150;
  const dx0 = W / 2 - CX;                     // 329：角注外边界到圆心
  const boxH = bottom - top;
  const ry = Math.max(0, boxH / 2 - NOTE_H);
  const rCap = Math.sqrt((dx0 - CW_MIN) * (dx0 - CW_MIN) + ry * ry) - PAD;
  // 横向顶到卡片内边距之外（758）或画布边（810）、竖向不顶出内容区、再受半径上限约束
  const D = Math.round(Math.min(bleedBox(d).w, boxH, rCap * 2));
  const cw = Math.round(dx0 - Math.sqrt(Math.max(0, (D / 2 + PAD) * (D / 2 + PAD) - ry * ry)));
  const cx = W / 2, cy = (top + bottom) / 2, r = D / 2;

  const KICK = 22, KH = 30, KGAP = 18, WLH = 1.1, NGAP = 20, NOTE = 21, NLH = 1.55;
  const UNIT = 30, UGAP = 12;
  const unitW = d.ccUnit ? textW(d.ccUnit, UNIT) + UGAP : 0;
  // 主词 + 单位要一起塞进圆内宽度（和 HTML 里那段 while 同一条规则：每次减 2px，下限 56）
  let ws = 118;
  while (ws > 56 && textW(d.ccWord || '', ws) + unitW > INNER_W) ws -= 2;
  const wordW = textW(d.ccWord || '', ws);

  const wordH = ws * WLH;
  const noteLines = d.ccNote ? wrapText(d.ccNote, NOTE, INNER_W) : [];
  const noteH = noteLines.length ? NGAP + noteLines.length * NOTE * NLH : 0;
  const blockH = (d.ccKick ? KH + KGAP : 0) + wordH + noteH;
  let y = cy - blockH / 2;

  let g = `<g id="内容区-正负形圆">`;
  g += `<circle cx="${cx}" cy="${R(cy)}" r="${R(r)}" fill="${t.card}"/>`;

  if (d.ccKick) {
    g += T({ x: cx, cy: y + KH / 2, s: d.ccKick, size: KICK, fill: '#FFFFFF', weight: 700, ls: 3, opacity: 0.86 });
    y += KH + KGAP;
  }
  // 主词和单位共用一条基线。T() 收的是「视觉中心」而不是基线，
  // 所以单位要把中心按自己的字号回退回去，否则两个字号的脚不在一条线上。
  const wCenter = y + wordH / 2;
  const baseY = wCenter + ws * 0.36;
  const wordX = cx - (wordW + unitW) / 2;
  g += T({ x: wordX, cy: wCenter, s: d.ccWord || '', size: ws, fill: '#FFFFFF', weight: 900, family: TITLE_FONT, anchor: 'start' });
  if (d.ccUnit) {
    g += T({ x: wordX + wordW + UGAP, cy: baseY - UNIT * 0.36, s: d.ccUnit, size: UNIT,
             fill: '#FFFFFF', weight: 700, anchor: 'start', opacity: 0.9 });
  }
  y += wordH;
  noteLines.forEach((ln, i) => {
    g += T({ x: cx, cy: y + NGAP + i * NOTE * NLH + NOTE * NLH / 2, s: ln, size: NOTE,
             fill: '#FFFFFF', anchor: 'middle', opacity: 0.82 });
  });

  // 圆外四角压角注（负形）。文字左边留 40px 给色条 —— 四种角色条都在文字左侧，
  // 和 CSS 里 .h / .p 的 margin-left:40px 对应；右侧两个角注再右缩 12px
  // 让开卡片右上角的账号角标（和 CSS 里 .tr / .br 的 right:12px 一致）。
  const CH = 21, CLH = 1.3, PGAP = 6, P = 15, PLH = 1.45, BAR = 40, RINSET = 12;
  (d.ccCorners || []).forEach(c => {
    const pos = c.pos || 'tl';
    const isTop = pos[0] === 't', isRight = pos[1] === 'r';
    const usable = cw - BAR;
    const hSize = fitSize(c.h || '', CH, usable, 0, 15);
    const pLines = c.p ? wrapText(c.p, P, usable) : [];
    const hH = c.h ? CH * CLH : 0;
    const pH = pLines.length ? (c.h ? PGAP : 0) + pLines.length * P * PLH : 0;
    const y0 = isTop ? top : bottom - hH - pH;
    const anchor = isRight ? 'end' : 'start';
    const tx = isRight ? CX + CW - RINSET : CX + BAR;
    if (c.h) {
      g += rect(isRight ? CX + CW - RINSET - cw : CX, y0 + hH / 2 - 4, 30, 8, t.badge);
      g += T({ x: tx, cy: y0 + hH / 2, s: c.h, size: hSize, fill: t.title, weight: 700, family: TITLE_FONT, anchor });
    }
    pLines.forEach((ln, i) => {
      g += T({ x: tx, cy: y0 + hH + PGAP + i * P * PLH + P * PLH / 2, s: ln, size: P, fill: t.axis, anchor });
    });
  });

  return g + `</g>`;
}

const CONTENT = {
  vs: contentVs,
  cards: contentCards,
  steps: contentSteps,
  hero: contentHero,
  bigword: contentBigword,
  band: contentBand,
  cover: contentCover,
  circle: contentCircle,
  photo: contentPhoto,
  photoFocus: contentFocus,
  duo: contentDuo,
  chart: contentChart,
  bar: contentBar,
  stat: contentStat,
  list: contentList,
  compare: contentCmp,
  timeline: contentTl
};

/* ============ 组装 ============ */
const unknownLayouts = new Set();

function buildSVG(d) {
  const t = THEMES[d.theme] || THEMES.blue;
  // cover / circle 自带整版排版（顶部小标签 + 大字 + 底部数字带，或大圆 + 四角角注），
  // 不共用顶部双行标题。传 bottom = CARD_TOP - 26，让下面算出来的 top 正好落在 CARD_TOP（76），
  // 和 HTML 里 .poster.own-title .content { margin-top: 0 } 对齐。
  const ownShell = d.layout === 'cover' || d.layout === 'circle';
  const tb = ownShell ? { svg: '', bottom: CARD_TOP - 26 } : titleBlock(d, t);
  const fb = footBlock(d, t);
  const top = tb.bottom + 26;
  const bottom = fb.top - 18;
  // 没登记的版式以前会静默退回 photo，导出的 SVG 跟 PNG 对不上还不报错 —— 现在记下来，跑完统一警告
  const fn = CONTENT[d.layout];
  if (d.layout && !fn) unknownLayouts.add(d.layout);
  const body = (fn || CONTENT.photo)(d, top, bottom, t);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${background(t, d)}
${badge(d.badge, t)}
${tb.svg}
${body}
${fb.svg}
</svg>
`;
}

/* ============ 主流程 ============ */
function safeName(s, i) {
  const base = String(s == null ? '' : s).trim() || String(i + 1).padStart(2, '0');
  return base.replace(/[\\/:*?"<>|\s]+/g, '_');
}

function main() {
  if (!fs.existsSync(srcFile)) throw new Error('数据源不存在: ' + srcFile);
  const rows = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  if (!Array.isArray(rows) || !rows.length) throw new Error('数据源必须是非空数组');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`数据  ${path.basename(srcFile)}  →  ${rows.length} 个 SVG`);
  console.log(`配色  ${Object.keys(THEMES).length} 套，来自 主题.js`);
  console.log(`输出  ${outDir}`);
  console.log('');

  rows.forEach((row, i) => {
    const svg = buildSVG(row);
    const name = safeName(row.name, i) + '.svg';
    fs.writeFileSync(path.join(outDir, name), svg, 'utf8');
    const th = THEMES[row.theme] ? row.theme : 'blue';
    console.log(`  [${String(i + 1).padStart(2, '0')}/${rows.length}] ${safeName(row.name, i).padEnd(22)} ${String(row.layout || 'photo').padEnd(11)} ${th.padEnd(7)} ${Math.round(svg.length / 1024)} KB`);
  });

  const cards = rows.map((row, i) => {
    const name = safeName(row.name, i) + '.svg';
    return `    <figure class="card">
      <img src="./${encodeURI(name)}" alt="">
      <figcaption>${esc(row.name || name)} <em>${esc(row.layout || 'photo')} · ${esc(row.theme || 'blue')}</em></figcaption>
    </figure>`;
  }).join('\n');

  fs.writeFileSync(path.join(outDir, '_预览.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>贴图 SVG 预览</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #EDF1F6; padding: 40px;
         font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; max-width: 1220px; margin: 0 auto; }
  .card { display: flex; flex-direction: column; gap: 12px; }
  .card img { width: 100%; height: auto; display: block;
              border-radius: 14px; box-shadow: 0 8px 24px rgba(16,24,40,.14); background: #fff; }
  figcaption { font-size: 15px; color: #1D2939; display: flex; justify-content: space-between; gap: 12px; }
  figcaption em { font-style: normal; color: #7A8798; font-size: 13px; }
</style></head>
<body><div class="grid">
${cards}
</div></body></html>
`, 'utf8');

  console.log('');
  if (unknownLayouts.size) {
    console.log('⚠️  以下版式还没在 CONTENT 里登记，已按 photo 兜底导出，请核对：');
    [...unknownLayouts].forEach(u => console.log('  ' + u));
    console.log('');
  }
  if (unembedded.length) {
    console.log('以下图片没能内嵌，SVG 里是虚线占位框：');
    [...new Set(unembedded)].forEach(u => console.log('  ' + u));
    console.log('');
  }
  console.log('下一步：把 svg输出/ 里的文件逐个拖进 Figma 画布即可编辑。');
  console.log('提示：Figma 里若提示字体缺失，标题换思源宋体 / Source Han Serif，正文换苹方 / PingFang SC。');
  console.log(`预览  ${path.join(outDir, '_预览.html')}（浏览器打开可一次看完 ${rows.length} 张）`);
}

main();
