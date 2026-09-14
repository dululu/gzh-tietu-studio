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

function fitSize(s, base, avail, ls) {
  let size = base;
  const n = [...String(s || '')].length;
  while (size > 24 && textW(s, size) + (ls || 0) * Math.max(0, n - 1) > avail) size -= 1;
  return size;
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
function background(t) {
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
</defs>`;
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
  const rowH = 290, gw = (CW - 18) / 2;
  const quoteH = d.quote ? 30 * 1.35 + 26 : 0;
  const quadTop = top + rowH + quoteH + 30;
  const thumbH = 148, cellGap = 16;
  const cellW = (CW - cellGap * 3) / 4;
  const quads = (d.quads || []).slice(0, 4);

  let svg = `<g id="内容区-双主体加四宫格">`;
  svg += imgCard(d.img, CX, top, gw, rowH, t, '主体 A');
  svg += imgCard(d.img2, CX + gw + 18, top, gw, rowH, t, '主体 B');
  if (d.quote) {
    svg += T({ x: W / 2, cy: top + rowH + 26 + (30 * 1.35) / 2, s: d.quote, size: 30, fill: t.title, weight: 700, family: TITLE_FONT, ls: 1 });
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

const CONTENT = {
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
function buildSVG(d) {
  const t = THEMES[d.theme] || THEMES.blue;
  const tb = titleBlock(d, t);
  const fb = footBlock(d, t);
  const top = tb.bottom + 26;
  const bottom = fb.top - 18;
  const body = (CONTENT[d.layout] || CONTENT.photo)(d, top, bottom, t);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${background(t)}
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
