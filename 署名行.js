#!/usr/bin/env node
'use strict';
// 署名行.js —— 生成一条「配图署名行」
//
// 用途：
//   贴图脚注里的配图署名格式固定（来源 + 作者 + 许可），手写容易漏人、写错许可。
//   这个脚本从数据源收集真正用到的图，去署名台账查作者与许可，拼成一条可直接
//   贴进 foot 的文本，并报出它占多少字宽（脚注一行上限约 41 汉字 / 76 西文）。
//
// 口径：
//   **只写来源、作者、许可名**。不写「经裁剪，按相同许可发布」这类许可条款原文——
//   读者不需要，也没人看得懂。裁剪与相同许可的事实照旧记在配图署名台账里，可回溯。
//
// 用法：
//   node 署名行.js 数据源.json
//   node 署名行.js 数据源.json --out 输出目录/_配文署名.txt
//   node 署名行.js 数据源.json --台账 配图署名.md --作者上限 3
//
// 台账格式：markdown 表格，列序为  本地文件 | 标题或来源 | 作者 | 许可
//   本地文件列写不写反引号都认；表头行与分隔行会自动跳过。
//   没查到的图会标「未登记」并以退出码 1 结束，不要带着它出图。

const fs = require('fs');
const path = require('path');

const IMG_RE = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const OWN_RE = /用户素材|自有|自截|自己/;

function parseArgs(argv) {
  const out = { data: null, ledger: null, out: null, maxAuthors: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--台账' || a === '--ledger') out.ledger = argv[++i];
    else if (a === '--out' || a === '-o') out.out = argv[++i];
    else if (a === '--作者上限' || a === '--max-authors') out.maxAuthors = Number(argv[++i]) || 0;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!out.data) out.data = a;
  }
  return out;
}

// 递归收集 JSON 里所有像图片路径的字符串。
// 只在「键名含 img」的分支里收，避免误抓 foot 正文里出现的文件名。
// 标志位要跟着往下传：quadImgs 是字符串数组，如果只在键那一层判断，
// 数组里的元素永远收不到（第一版就是这么漏掉四宫格图的）。
function collectImages(node, acc, inImg) {
  if (typeof node === 'string') {
    if (inImg && IMG_RE.test(node)) acc.push(node);
    return;
  }
  if (Array.isArray(node)) { node.forEach((n) => collectImages(n, acc, inImg)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      collectImages(v, acc, inImg || /img/i.test(k));
    }
  }
}

function parseLedger(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length < 5) continue;
    const file = cells[1].replace(/`/g, '');
    if (!IMG_RE.test(file)) continue;
    map.set(path.basename(file), { author: cells[3] || '', license: cells[4] || '' });
  }
  return map;
}

function licInfo(raw) {
  const t = (raw || '').trim();
  if (!t) return { fam: '?' };
  if (OWN_RE.test(t)) return { fam: 'OWN' };
  // Pexels 不是 CC 许可，是一套自有条款：可商用、免署名（建议标）。
  // 必须放在 CC 匹配之前，否则 "Pexels 许可" 这类写法会掉进「许可待核」。
  if (/pexels/i.test(t)) return { fam: 'PEX' };
  if (/CC0/i.test(t)) return { fam: 'CC0' };
  if (/public\s*domain|公有领域|\bPD\b/i.test(t)) return { fam: 'PD' };
  const m = t.match(/CC\s*BY(-SA)?\s*([\d.]+)?/i);
  if (m) return { fam: m[1] ? 'BY-SA' : 'BY', ver: m[2] || '' };
  return { fam: '?', raw: t };
}

function sortVer(list) {
  return [...new Set(list)].sort((a, b) => parseFloat(a) - parseFloat(b));
}

// 脚注一行的宽度：汉字算 1，半角算 0.5。上限约 41（一行 658px / 16px 字号）。
function widthOf(s) {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.5;
  return Math.round(w * 10) / 10;
}

function renderPage(page, ledger, maxAuthors) {
  const imgs = [];
  collectImages(page, imgs, false);
  const uniq = [...new Set(imgs.map((p) => path.basename(p)))];

  if (uniq.length === 0) return { lines: ['（本页无配图，脚注只留数据来源）'], bad: false };

  const authors = [];
  const byVer = []; const bysaVer = []; let cc0 = false; let pd = false; let own = 0; let pexels = 0;
  const unregistered = []; const unknownLic = [];

  for (const f of uniq) {
    const row = ledger.get(f);
    if (!row) { unregistered.push(f); continue; }
    const li = licInfo(row.license);
    if (li.fam === 'OWN') { own++; continue; }
    if (li.fam === 'PEX') { pexels++; continue; }
    const a = row.author.replace(/^——$/, '').trim();
    if (a && !authors.includes(a)) authors.push(a);
    if (li.fam === 'BY') byVer.push(li.ver);
    else if (li.fam === 'BY-SA') bysaVer.push(li.ver);
    else if (li.fam === 'CC0') cc0 = true;
    else if (li.fam === 'PD') pd = true;
    else unknownLic.push(`${f}（${row.license || '无'}）`);
  }

  const source = [];
  if (authors.length) {
    const shown = maxAuthors > 0 ? authors.slice(0, maxAuthors) : authors;
    source.push(`维基共享资源 · ${shown.join('、')}${authors.length > shown.length ? ' 等' : ''}`);
  }
  if (own) source.push(`自有素材${own > 1 ? ` ${own} 张` : ''}`);
  if (pexels) source.push(`Pexels${pexels > 1 ? ` ${pexels} 张` : ''}`);

  const licParts = [];
  if (byVer.length) licParts.push(`CC BY ${sortVer(byVer).join('/')}`);
  if (bysaVer.length) licParts.push(`CC BY-SA ${sortVer(bysaVer).join('/')}`);
  if (cc0) licParts.push('CC0');
  if (pd) licParts.push('公有领域');
  if (unknownLic.length) licParts.push('许可待核');
  // 整页只有 Pexels / 自有素材时，许可段会空着，补一句说明
  if (!licParts.length && pexels) licParts.push('Pexels 许可（可商用、免署名）');
  if (!licParts.length && own) licParts.push('自有素材，无第三方署名要求');

  let line = `配图：${source.length ? source.join('；') : '（未登记）'}`;
  if (licParts.length) line += `；${licParts.join('，')}`;

  const lines = [line];
  if (typeof page.credit === 'string' && page.credit.trim()) {
    lines.push(page.credit.trim());
  }
  if (unregistered.length) lines.push(`⚠ 台账缺登记：${unregistered.join('、')}`);
  if (unknownLic.length) lines.push(`⚠ 许可未识别：${unknownLic.join('、')}`);

  return { lines, bad: unregistered.length > 0 || unknownLic.length > 0, main: line };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.data) {
    console.log('用法: node 署名行.js 数据源.json [--台账 配图署名.md] [--out 输出.txt] [--作者上限 3]');
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const dataPath = path.resolve(args.data);
  if (!fs.existsSync(dataPath)) {
    console.error(`找不到数据源：${dataPath}`);
    process.exitCode = 1;
    return;
  }
  const pages = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (!Array.isArray(pages)) {
    console.error('数据源应当是数组（每个元素一页）');
    process.exitCode = 1;
    return;
  }

  // 台账查找顺序：显式指定 → 数据源同目录 → 数据源上级目录 → 当前工作目录
  const dir = path.dirname(dataPath);
  const candidates = [
    args.ledger,
    path.join(dir, '配图署名.md'),
    path.join(dir, '..', '配图署名.md'),
    path.join(process.cwd(), '配图署名.md'),
  ].filter(Boolean);
  let ledgerPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { ledgerPath = c; break; }
  }

  let ledger = new Map();
  if (ledgerPath) {
    ledger = parseLedger(fs.readFileSync(ledgerPath, 'utf8'));
    console.error(`台账：${ledgerPath}（已登记 ${ledger.size} 张）`);
  } else {
    console.error('警告：没找到配图署名台账，所有图都会标成「未登记」。');
  }

  const blocks = [];
  let bad = 0;
  for (const page of pages) {
    const r = renderPage(page, ledger, args.maxAuthors);
    if (r.bad) bad++;
    const w = r.main ? widthOf(r.main) : 0;
    let hint = r.main ? `\n   （约 ${w} 字宽 / 一行上限 41）` : '';
    // 超一行时别只报错：把作者一个个砍下去，给出第一个放得下的版本。
    // 图多的页（duo 六张图）默认 --作者上限 2 很容易超，这行提示能省一轮来回。
    if (r.main && w > 41 && args.maxAuthors >= 2) {
      let fit = null;
      for (let k = 1; k < args.maxAuthors; k++) {
        const alt = renderPage(page, ledger, k);
        if (alt.main && widthOf(alt.main) <= 41) { fit = { k, line: alt.main, w: widthOf(alt.main) }; break; }
      }
      hint = `\n   （约 ${w} 字宽 / 一行上限 41 —— 超了）`;
      hint += fit
        ? `\n   ↳ 收窄作者即可放进一行（--作者上限 ${fit.k}，${fit.w} 字宽）：\n     ${fit.line}`
        : `\n   ↳ 砍作者也放不下，改短作者名，或把这行挪到 secondFoot / 拆成两行。`;
    }
    blocks.push(`── ${page.name || '(未命名)'} ──\n${r.lines.join('\n')}${hint}`);
  }

  const text = blocks.join('\n\n') + '\n';

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text);
    console.log(text);
    console.error(`已写入 ${outPath}`);
  } else {
    console.log(text);
  }

  if (bad) {
    console.error(`\n有 ${bad} 页存在未登记或未识别的图，出图前请在台账里补齐。`);
    process.exitCode = 1;
  }
}

main();
