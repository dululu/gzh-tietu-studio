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
 *   node 找图.js page "<文章URL>" [文件名] [宽]       新闻页取主图 + 标题/媒体/记者
 *   node 找图.js url  "<图片直链>" [文件名] [宽]       直链取图（page 抓不到时兜底）
 *
 * 三个图源都是免费、可商用：
 *   维基共享 —— CC BY / CC BY-SA / 公有领域，CC BY 系必须署名
 *   NASA     —— 绝大多数是公有领域，署名写 "NASA" 或 "NASA/JSC"
 *   Pexels   —— 免署名（建议标），但不得转售原图、不得暗示照片中的人为你背书
 * 下载后请在贴图 foot 字段里写清「图源」与许可，这是使用条件，不是可选项。
 *
 * page / url 两个命令拉的是**官方媒体或任意网页**的图，规则和上面三个源完全不同：
 * 不属于自由授权，只能用《著作权法》第二十四条的"报道时事新闻"合理使用空间，
 * 必须标来源 + 不遮盖署名 + 不用于带货。细节见说明书 4.5。
 * 微博 / 小红书 / B站 / 百度图片这类平台**默认保留全部权利**，不要直接扒。
 *
 * Pexels key 从哪来（按顺序找，都不改脚本）：
 *   1. 环境变量 PEXELS_API_KEY
 *   2. ~/.workbuddy/pexels.key
 *   3. 本目录下的 .pexels-key
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
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

/* ================= 官方媒体 / 任意网页（要人工判断合理使用） ================= */

// 新闻站多半会挡掉没有 UA 的请求，也多半会返回 gzip/br，这里都处理掉
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function fetchText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 25000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return fetchText(next, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      try {
        if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
      } catch (e) { /* 解不开就按原文读 */ }
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', d => { buf += d; });
      stream.on('end', () => resolve(buf));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

/** 取 <meta property|name="x" content="y">，两种属性顺序都试 */
function pickMeta(html, names) {
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const a = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + esc + '["\'][^>]*?content=["\']([^"\']+)["\']', 'i');
    const b = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*?(?:property|name|itemprop)=["\']' + esc + '["\']', 'i');
    const m = html.match(a) || html.match(b);
    if (m && m[1].trim()) return decodeEntities(m[1]).trim();
  }
  return '';
}

function pickAuthor(html) {
  const direct = pickMeta(html, ['author', 'article:author', 'og:article:author', 'weibo:article:create_at', 'bytedance:author']);
  if (direct && !/^https?:/i.test(direct)) return direct;
  const ld = html.match(/"author"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{2,40})"/);
  if (ld) return decodeEntities(ld[1]);
  const named = html.match(/记者\s*[：:]\s*([\u4e00-\u9fa5]{2,4})/);
  if (named) return named[1];
  return '';
}

function pickTitle(html) {
  const t = pickMeta(html, ['og:title', 'twitter:title', 'title']);
  if (t) return t;
  const m = html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function safeName(s, fallback) {
  const v = String(s || '').replace(/[\\/:*?"<>|#%\s]+/g, '_').replace(/^_+|_+$/g, '');
  return (v.slice(0, 28) || fallback);
}

/** 直链取图：图你从哪来自己清楚，这里只负责落盘 + 报尺寸 */
async function urlGet(imgUrl, name, width) {
  const dir = path.resolve(process.cwd(), 'img');
  fs.mkdirSync(dir, { recursive: true });
  const ext = (imgUrl.match(/\.(jpe?g|png|webp)(?![a-z])/i) || [, 'jpg'])[1].toLowerCase();
  const dest = path.join(dir, safeName(name || path.basename(imgUrl).replace(/\.[^.]+$/, ''), 'media') + '.' + (ext === 'jpeg' ? 'jpg' : ext));
  await download(imgUrl, dest);
  const before = Math.round(fs.statSync(dest).size / 1024);
  shrink(dest, width);
  let dim = '';
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', dest], { encoding: 'utf8' });
    const w = (info.match(/pixelWidth:\s*(\d+)/) || [])[1];
    const h = (info.match(/pixelHeight:\s*(\d+)/) || [])[1];
    if (w && h) dim = `${w}×${h}`;
  } catch (e) { /* 非 macOS 拿不到尺寸，不影响出图 */ }
  console.log(`已下载  ${dest}`);
  console.log(`尺寸    ${dim || '未知'}   体积 ${before} KB → ${Math.round(fs.statSync(dest).size / 1024)} KB`);
  console.log(`原链    ${imgUrl}`);
  copyrightNote();
  console.log('\nfoot 里必须写清「图片：<媒体名> <记者>」+「来源：<原文链接>」，别只写个链接。');
}

/** 兜底：从正文里扒 <img>。很多国内新闻站没写 og:image，
 *  但正文图就摆在那儿。按 data-src / src 收集，滤掉站标、二维码、图标。 */
function pickImgs(html, base, limit = 8) {
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit * 3) {
    const tag = m[0];
    const src = (tag.match(/(?:data-original|data-lazy-src|data-echo|data-src|src)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || /^data:/i.test(src) || /\.svg(\?|$)/i.test(src)) continue;
    if (/(logo|icon|avatar|qrcode|qr_|share|sprite|placeholder|blank\.|spacer|ad_|banner_s)/i.test(src)) continue;
    if (/(w|width)=(1|2|3)\d{2}\b/i.test(src)) continue;      // URL 里带 width=1xx 的缩略图
    try { out.push(new URL(src, base).toString()); } catch (e) { /* 不是合法地址就跳过 */ }
  }
  return [...new Set(out)].slice(0, limit);
}

/** 文章页取图：优先 og:image / twitter:image，没有就扒正文 <img>；顺手读出标题、媒体、记者 */
async function pageGet(pageUrl, name, width) {
  const html = await fetchText(pageUrl);
  const u = new URL(pageUrl);
  const title = pickTitle(html);
  const site = pickMeta(html, ['og:site_name', 'application-name']) || u.hostname.replace(/^www\./, '');
  const author = pickAuthor(html);
  const pub = pickMeta(html, ['article:published_time', 'og:release_date', 'pubdate', 'publishdate']);

  console.log(`标题    ${title || '(没读到)'}`);
  console.log(`媒体    ${site}`);
  if (author) console.log(`作者    ${author}`);
  if (pub) console.log(`时间    ${pub.slice(0, 10)}`);

  const metaImg = pickMeta(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  const candidates = [...new Set([metaImg, ...pickImgs(html, pageUrl)].filter(Boolean))];
  if (!candidates.length) {
    console.log('\n这个页面既没有 og:image 也没有可用的 <img>（多半是 JS 渲染的）。');
    console.log('请手动右键复制图片地址，再用：');
    console.log('  node 找图.js url "<图片直链>" "' + safeName(name || title, 'media') + '"');
    return;
  }
  if (!metaImg) console.log(`\n页面没写 og:image，改从正文 <img> 里挑（共 ${candidates.length} 个候选）`);

  const dir = path.resolve(process.cwd(), 'img');
  fs.mkdirSync(dir, { recursive: true });

  // 依次试，第一个宽度够 800 的就是正文图；都不够就留最宽的那张并告警
  let best = null;   // { dest, w, url }
  for (const cand of candidates.slice(0, 5)) {
    const idx = candidates.indexOf(cand);
    const ext = (cand.match(/\.(jpe?g|png|webp)(?![a-z])/i) || [, 'jpg'])[1].toLowerCase();
    const out = path.join(dir, safeName(name || title, 'media')
      + (idx ? '_' + (idx + 1) : '') + '.' + (ext === 'jpeg' ? 'jpg' : ext));
    let w = 0;
    try {
      await download(cand, out);
      const info = execFileSync('sips', ['-g', 'pixelWidth', out], { encoding: 'utf8' });
      w = Number((info.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
    } catch (e) {
      fs.rmSync(out, { force: true });
      continue;                       // 这张抓不动，换下一个
    }
    if (!best || w > best.w) {
      if (best) fs.rmSync(best.dest, { force: true });   // 上一张猜错的清掉，别在 img/ 里堆垃圾
      best = { dest: out, w, url: cand };
    } else {
      fs.rmSync(out, { force: true });
    }
    if (w >= 800) break;
  }

  // 400px 以下基本是站标/图标，别把垃圾留在 img/ 里
  if (best && best.w && best.w < 400) {
    fs.rmSync(best.dest, { force: true });
    best = null;
  }
  if (!best) {
    console.log('\n没从正文里找到像样的图（站点可能是 JS 渲染的，或有反爬）。');
    console.log('请右键复制图片地址，再用：');
    console.log('  node 找图.js url "<图片直链>" "' + safeName(name || title, 'media') + '"');
    return;
  }

  const dest = best.dest, gotW = best.w, usedUrl = best.url;
  const before = Math.round(fs.statSync(dest).size / 1024);
  shrink(dest, width);
  console.log(`\n已下载  ${dest}`);
  console.log(`尺寸    宽 ${gotW || '未知'}   体积 ${before} KB → ${Math.round(fs.statSync(dest).size / 1024)} KB`);
  console.log(`原链    ${usedUrl}`);
  if (gotW && gotW < 800) console.log('⚠️ 猜到的这张偏小，八成不是正文图，建议改用 url 模式自己指定');

  console.log('\nfoot 建议写法（照抄，把值换成实际的）：');
  console.log(`  "图片：${site}${author ? '（' + author + '）' : ''}"`);
  console.log(`  "来源：${pageUrl}"`);
  console.log('  若原文标注了摄影/图片来源，以原文为准。');
  copyrightNote();
}

// 这段提醒不是客套：这一类图和自由授权图的规则完全不同，写错就是把风险留在账号上
function copyrightNote() {
  console.log('\n────────────────────────────────────────');
  console.log('合理使用不是"随便用"。《著作权法》第二十四条允许为报道时事新闻');
  console.log('「不可避免地再现或者引用已经发表的作品」，四个要件都要满足：');
  console.log('  ① 为报道该时事新闻（这条新闻本身的配图 ✅；只当气氛图 ❌）');
  console.log('  ② 不可避免（能换自由授权图的位置就别用）');
  console.log('  ③ 指明作者与来源（媒体名 + 记者 + 链接，缺一不可）');
  console.log('  ④ 不损害权利人合法权益（不裁掉/遮盖署名水印，不用于带货导购）');
  console.log('另：账号开通流量主、接商单时，风险会明显上升。');
  console.log('────────────────────────────────────────');
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
  } else if (cmd === 'url') {
    await urlGet(argv[1], argv[2], Number(argv[3]) || 1600);
  } else if (cmd === 'page') {
    await pageGet(argv[1], argv[2], Number(argv[3]) || 1600);
  } else {
    console.log('用法:');
    console.log('  node 找图.js search "humanoid robot" 8');
    console.log('  node 找图.js cat "Humanoid robots" 8');
    console.log('  node 找图.js get "File:Ameca Generation 1.jpg" img 1600');
    console.log('  node 找图.js nasa "mars rover" 8');
    console.log('  node 找图.js nasa-get "PIA07081" img');
    console.log('  node 找图.js pexels "robot laboratory" 8');
    console.log('  node 找图.js pexels-get "32778341" img 1600');
    console.log('');
    console.log('官方媒体 / 任意网页（规则不同，见说明书 4.5）:');
    console.log('  node 找图.js page "<文章URL>" "文件名" 1600   # 抓主图 + 标题/媒体/记者');
    console.log('  node 找图.js url  "<图片直链>" "文件名" 1600   # 页面抓不到时的兜底');
  }
})().catch(e => { console.error('出错: ' + e.message); process.exit(1); });
