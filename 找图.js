#!/usr/bin/env node
/**
 * 开放图库取图（维基共享资源 + NASA + Pexels）
 *
 * 用法:
 *   node 找图.js search "humanoid robot" [条数]      维基共享 · 全文搜
 *   node 找图.js cat "Humanoid robots" [条数]        维基共享 · 按分类取（更精准，推荐）
 *   node 找图.js get "File:xxx.jpg" [输出目录] [宽]   维基共享 · 下载（默认 img/，宽 1600）
 *
 *   node 找图.js nasa "mars rover" [条数]            NASA 图库 · 全文搜
 *   node 找图.js nasa-get "PIA07081" [输出目录] [宽]  NASA 图库 · 按 nasa_id 下载
 *
 *   node 找图.js pexels "robot laboratory" [条数]    Pexels · 全文搜（要 key）
 *   node 找图.js pexels-get "32778341" [输出目录] [宽] Pexels · 按 id 下载
 *
 * 三个源都是免费、可商用：
 *   维基共享 —— CC BY / CC BY-SA / 公有领域，CC BY 系必须署名
 *   NASA     —— 绝大多数是公有领域，署名写 "NASA" 或 "NASA/JSC"
 *   Pexels   —— 免署名（建议标），但不得转售原图、不得暗示照片中的人为你背书
 * 下载后请在贴图 foot 字段里写清「图源」与许可，这是使用条件，不是可选项。
 *
 * Pexels key 从哪来（按顺序找，都不改脚本）：
 *   1. 环境变量 PEXELS_API_KEY
 *   2. ~/.workbuddy/pexels.key
 *   3. 本目录下的 .pexels-key
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'XiaoMingXiang-Tietu/1.0 (contact: local user)';

/** 贴图里图片最大也就 658px 宽，原图动辄几 MB，用系统自带 sips 缩一下。
 *  本来就不大的（比如 Pexels 的 large2x 只有 1880px）不要动 ——
 *  再"缩"一次只是重新编码，体积反而变大。 */
function shrink(dest, width) {
  if (process.platform !== 'darwin' || !width) return;
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', dest], { encoding: 'utf8' });
    const cur = Number((info.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
    // 差得不多就别重编码了（sips 默认质量比原图高，重编完体积反而更大）
    if (!cur || cur <= width * 1.3) return;
    execFileSync('sips', ['--resampleWidth', String(width), '-s', 'formatOptions', '75', dest], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false; // 没装 sips 就留着原图，不影响出图
  }
}

const argv = process.argv.slice(2);
const cmd = argv[0];

/** 接口查询。本机到维基的链路会间歇性超时，只跑一次很容易"偶发失败"，
 *  所以自带 3 次重试（GET 无副作用，重试安全）。 */
function fetchJson(url, extraHeaders, tries = 3) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ 'User-Agent': UA }, extraHeaders || {});
    const req = https.get(url, { headers, timeout: 25000 }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('接口超时')));
    req.on('error', reject);
  }).catch(e => {
    if (tries > 1) {
      console.error(`  接口请求失败（${e.message}），重试…`);
      return new Promise(r => setTimeout(r, 900)).then(() => fetchJson(url, extraHeaders, tries - 1));
    }
    throw e;
  });
}

/**
 * 下载。维基现在把缩略图挪到了新的 thumb.wikimedia.org，偶尔会 ETIMEDOUT，
 * 所以：① 加 socket 超时，别无限等；② 失败重试几次；③ 失败时删掉半截文件 ——
 * 留下一个 0 字节的"同名图"最坑，页面里看起来就是一张破图。
 */
function download(url, dest, tries = 3) {
  const once = () => new Promise((resolve, reject) => {
    // 上次被中断留下的 0 字节同名文件先清掉，否则它会被当成"已下载过"
    if (fs.existsSync(dest) && fs.statSync(dest).size === 0) fs.rmSync(dest, { force: true });
    const file = fs.createWriteStream(dest);
    const fail = e => { try { file.close(); } catch (_) {} fs.rmSync(dest, { force: true }); reject(e); };
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        try { file.close(); } catch (_) {}
        fs.rmSync(dest, { force: true });
        return download(res.headers.location, dest, tries).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', fail);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', fail);
  });

  return once().catch(e => {
    if (tries > 1) {
      console.error(`  下载中断（${e.message}），重试…`);
      return new Promise(r => setTimeout(r, 900)).then(() => download(url, dest, tries - 1));
    }
    throw e;
  });
}

const meta = (em, key) => {
  const v = em && em[key] && em[key].value;
  return v == null ? '' : String(v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

async function listCategory(cat, limit) {
  const url = API + '?action=query&format=json&generator=categorymembers'
    + '&gcmtitle=' + encodeURIComponent('Category:' + cat)
    + '&gcmtype=file&gcmlimit=' + limit
    + '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600';
  const j = await fetchJson(url);
  const pages = Object.values((j.query && j.query.pages) || {})
    .filter(p => (p.imageinfo || [])[0])
    // 只要够大的横图，竖图和小图在贴图里裁不出东西
    .filter(p => {
      const ii = p.imageinfo[0];
      return ii.width >= 1000 && ii.width >= ii.height;
    })
    .sort((a, b) => b.imageinfo[0].width - a.imageinfo[0].width)
    .slice(0, limit);
  if (!pages.length) { console.log('这个分类没取到合适的大横图，换个分类'); return; }
  showPages(pages);
}

function showPages(pages) {
  pages.forEach((p, i) => {
    const ii = (p.imageinfo || [])[0] || {};
    const em = ii.extmetadata || {};
    console.log(`\n[${i + 1}] ${p.title.replace(/^File:/, '')}`);
    console.log(`    ${ii.width}×${ii.height}   ${meta(em, 'LicenseShortName') || '未标注许可'}`);
    console.log(`    作者: ${(meta(em, 'Artist') || meta(em, 'Credit') || '未署名').slice(0, 90)}`);
    console.log(`    页:   ${ii.descriptionurl}`);
  });
  console.log('\n取第 N 张:  node 找图.js get "<标题>"');
  console.log(pages.map((p, i) => `  ${i + 1}. ${p.title}`).join('\n'));
}

async function search(q, limit) {
  const url = API + '?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + q)
    + '&gsrlimit=' + Math.max(limit * 4, 20) + '&gsrnamespace=6'
    + '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600';
  const j = await fetchJson(url);
  const pages = Object.values((j.query && j.query.pages) || {})
    .filter(p => (p.imageinfo || [])[0])
    // 贴图里都是横构图，竖图和小图裁不出东西，直接滤掉
    .filter(p => {
      const ii = p.imageinfo[0];
      return ii.width >= 1400 && ii.width >= ii.height * 1.15;
    })
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .slice(0, limit);
  if (!pages.length) { console.log('没搜到合适的大横图，换个关键词'); return; }
  showPages(pages);
}

async function get(title, outDir, width) {
  const t = /^File:/.test(title) ? title : 'File:' + title;
  const url = API + '?action=query&format=json&titles=' + encodeURIComponent(t)
    + '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=' + width;
  const j = await fetchJson(url);
  const page = Object.values((j.query && j.query.pages) || {})[0];
  if (!page || page.missing !== undefined) throw new Error('找不到: ' + t);
  const ii = (page.imageinfo || [])[0];
  if (!ii) throw new Error('没有图片信息: ' + t);
  const em = ii.extmetadata || {};

  // 默认下到「当前工作目录/img」——脚本可能装在技能目录里，图应该落到你正在做的项目里
  const dir = path.resolve(process.cwd(), outDir || 'img');
  fs.mkdirSync(dir, { recursive: true });
  const safe = t.replace(/^File:/, '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/\.(png|jpe?g|webp)$/i, '');
  const dest = path.join(dir, safe + '.jpg');
  await download(ii.thumburl || ii.url, dest);

  console.log(`已下载  ${dest}`);
  console.log(`标题    ${t.replace(/^File:/, '')}`);
  console.log(`作者    ${meta(em, 'Artist') || meta(em, 'Credit') || '未署名'}`);
  console.log(`许可    ${meta(em, 'LicenseShortName') || '未标注'}`);
  console.log(`许可链接 ${meta(em, 'LicenseUrl')}`);
  console.log(`原页    ${ii.descriptionurl}`);
  console.log(`尺寸    ${ii.width}×${ii.height}  → 实际下载宽 ${width}`);
  console.log('\n把「作者 + 许可」写进贴图的 foot 字段，否则不能发。');
}

/* ================= NASA 图库（免 key，公有领域） ================= */

const NASA_API = 'https://images-api.nasa.gov';

// NASA 官方署名惯例是 "NASA" 或 "NASA/<中心或摄影师>"，接口只给 "JSC" 这种，补上前缀
const nasaCredit = d => {
  const v = d.secondary_creator || d.photographer || d.center || '';
  if (!v) return 'NASA';
  return /^NASA/i.test(v) ? v : 'NASA/' + v;
};

async function nasaSearch(q, limit) {
  const url = NASA_API + '/search?media_type=image&page_size=' + Math.max(limit * 4, 20)
    + '&q=' + encodeURIComponent(q);
  const j = await fetchJson(url);
  const items = ((j.collection || {}).items || [])
    .filter(it => it.data && it.data[0] && (it.links || [])[0])
    .filter(it => {
      // 只要够大的横图，和维基那边同一套标准
      const l = it.links[0];
      return l.width >= 1200 && l.width >= l.height;
    })
    .slice(0, limit);
  if (!items.length) { console.log('没搜到合适的大横图，换个关键词'); return; }

  items.forEach((it, i) => {
    const d = it.data[0];
    console.log(`\n[${i + 1}] ${String(d.title || '').slice(0, 70)}`);
    console.log(`    ${d.nasa_id}   ${(d.date_created || '').slice(0, 10)}   公有领域（署名：${nasaCredit(d)}）`);
    console.log(`    原图 https://images-assets.nasa.gov/image/${d.nasa_id}/${d.nasa_id}~orig.jpg`);
  });
  console.log('\n取第 N 张:  node 找图.js nasa-get "<nasa_id>"');
  console.log(items.map((it, i) => `  ${i + 1}. ${it.data[0].nasa_id}  ${String(it.data[0].title || '').slice(0, 46)}`).join('\n'));
}

async function nasaGet(nasaId, outDir, width) {
  // 资源清单结构是 {collection:{items:[{href}]}}，orig 是原始图，其余是缩略尺寸
  const manifest = await fetchJson(NASA_API + '/asset/' + encodeURIComponent(nasaId));
  const files = (((manifest || {}).collection || {}).items || [])
    .map(it => String(it.href || '').replace(/^http:/, 'https:'))
    .filter(h => h);
  const pick = v => files.find(f => f.endsWith('~' + v + '.jpg'));
  const big = pick('orig') || pick('large') || pick('medium');
  if (!big) throw new Error('这个 nasa_id 没有可下载的 jpg：' + nasaId);

  // 详情用来拿标题和署名
  let credit = 'NASA', title = nasaId;
  try {
    const j = await fetchJson(NASA_API + '/search?nasa_id=' + encodeURIComponent(nasaId));
    const d = (((j.collection || {}).items || [])[0] || {}).data;
    if (d && d[0]) { credit = nasaCredit(d[0]); title = d[0].title || nasaId; }
  } catch (e) { /* 拿不到就退回默认署名 */ }

  // 默认下到「当前工作目录/img」——脚本可能装在技能目录里，图应该落到你正在做的项目里
  const dir = path.resolve(process.cwd(), outDir || 'img');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'NASA_' + nasaId.replace(/[\\/:*?"<>|\s]+/g, '_') + '.jpg');
  await download(big, dest);
  const kb = () => Math.round(fs.statSync(dest).size / 1024);
  const before = kb();
  shrink(dest, width);

  console.log(`已下载  ${dest}`);
  console.log(`标题    ${title}`);
  console.log(`署名    ${credit}（NASA 图片绝大多数为公有领域）`);
  console.log(`原始    ${big}`);
  console.log(`体积    ${before} KB → ${kb()} KB（缩到宽 ${width}）`);
  console.log('\n把署名写进贴图的 foot 字段。');
}

/* ================= Pexels（要 key，现代新闻感照片） ================= */

const PEXELS_API = 'https://api.pexels.com/v1';

function pexelsKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
  const candidates = [
    path.join(require('os').homedir(), '.workbuddy', 'pexels.key'),
    path.join(HERE, '.pexels-key')
  ];
  for (const p of candidates) {
    try {
      const k = fs.readFileSync(p, 'utf8').trim();
      if (k) return k;
    } catch (e) { /* 继续找下一个 */ }
  }
  throw new Error(
    '没找到 Pexels API key。三选一：\n'
    + '  1) 环境变量:  export PEXELS_API_KEY=你的key\n'
    + '  2) 写文件:    echo "你的key" > ~/.workbuddy/pexels.key && chmod 600 ~/.workbuddy/pexels.key\n'
    + '  3) 项目内:    echo "你的key" > .pexels-key\n'
    + '  key 在 https://www.pexels.com/api/ 免费申请'
  );
}

async function pexelsSearch(q, limit) {
  const key = pexelsKey();
  const url = PEXELS_API + '/search?query=' + encodeURIComponent(q)
    + '&per_page=' + Math.max(limit * 3, 15) + '&orientation=landscape';
  const j = await fetchJson(url, { Authorization: key });
  const photos = (j.photos || [])
    .filter(p => p.width >= 1400)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, limit);
  if (!photos.length) { console.log('没搜到合适的大横图，换个关键词'); return; }

  console.log(`共 ${j.total_results} 条结果，取 ${photos.length} 张大图：`);
  photos.forEach((p, i) => {
    console.log(`\n[${i + 1}] ${String(p.alt || '(无描述)').slice(0, 72)}`);
    console.log(`    id ${p.id}   ${p.width}×${p.height}   摄影 ${p.photographer}`);
    console.log(`    页 ${p.url}`);
  });
  console.log('\n取第 N 张:  node 找图.js pexels-get "<id>"');
  console.log(photos.map((p, i) => `  ${i + 1}. ${p.id}  ${String(p.alt || '').slice(0, 50)}`).join('\n'));
}

async function pexelsGet(id, outDir, width) {
  const key = pexelsKey();
  const p = await fetchJson(PEXELS_API + '/photos/' + encodeURIComponent(id), { Authorization: key });
  const src = p.src || {};
  const url = src.large2x || src.original || src.large;
  if (!url) throw new Error('这个 id 没有可下载的图：' + id);

  // 默认下到「当前工作目录/img」——脚本可能装在技能目录里，图应该落到你正在做的项目里
  const dir = path.resolve(process.cwd(), outDir || 'img');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'Pexels_' + id + '.jpg');
  await download(url, dest);
  const before = Math.round(fs.statSync(dest).size / 1024);
  shrink(dest, width);

  console.log(`已下载  ${dest}`);
  console.log(`描述    ${p.alt || '(无)'}`);
  console.log(`摄影    ${p.photographer}（${p.photographer_url || ''}）`);
  console.log(`原尺寸  ${p.width}×${p.height}   体积 ${before} KB → ${Math.round(fs.statSync(dest).size / 1024)} KB（缩到宽 ${width}）`);
  console.log(`页      ${p.url}`);
  console.log('\nPexels 免署名但建议标；不得转售原图、不得暗示照片中的人为你背书。');
  console.log('foot 建议写法：图片：' + p.photographer + ' / Pexels');
}

/* ================= 主流程 ================= */

(async () => {
  if (cmd === 'search') {
    const q = argv.slice(1, -1).join(' ') || argv[1];
    await search(q, Number(argv[argv.length - 1]) || 8);
  } else if (cmd === 'cat') {
    const c = argv.slice(1, -1).join(' ') || argv[1];
    await listCategory(c, Number(argv[argv.length - 1]) || 8);
  } else if (cmd === 'get') {
    await get(argv[1], argv[2], Number(argv[3]) || 1600);
  } else if (cmd === 'nasa') {
    const q = argv.slice(1, -1).join(' ') || argv[1];
    await nasaSearch(q, Number(argv[argv.length - 1]) || 8);
  } else if (cmd === 'nasa-get') {
    await nasaGet(argv[1], argv[2], Number(argv[3]) || 1600);
  } else if (cmd === 'pexels') {
    const q = argv.slice(1, -1).join(' ') || argv[1];
    await pexelsSearch(q, Number(argv[argv.length - 1]) || 8);
  } else if (cmd === 'pexels-get') {
    await pexelsGet(argv[1], argv[2], Number(argv[3]) || 1600);
  } else {
    console.log('用法:');
    console.log('  node 找图.js search "humanoid robot" 8');
    console.log('  node 找图.js cat "Humanoid robots" 8');
    console.log('  node 找图.js get "File:Ameca Generation 1.jpg" img 1600');
    console.log('  node 找图.js nasa "mars rover" 8');
    console.log('  node 找图.js nasa-get "PIA07081" img');
    console.log('  node 找图.js pexels "robot laboratory" 8');
    console.log('  node 找图.js pexels-get "32778341" img 1600');
  }
})().catch(e => { console.error('出错: ' + e.message); process.exit(1); });
