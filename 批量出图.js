#!/usr/bin/env node
/**
 * 信息图批量出图
 *
 * 用法:
 *   node 批量出图.js [数据源.json] [输出目录]              直接出图（并行）
 *   node 批量出图.js [数据源.json] [输出目录] --html-only  只生成页面，不出图
 *   node 批量出图.js [数据源.json] [输出目录] --template=贴图模板.html
 *
 * 不给 --template 时自动判断：数据里带 layout 字段 → 贴图模板.html，否则 信息图模板.html。
 * 需要显式指定时优先用命令行参数。
 *
 * 数据源是一个数组，每个元素 = 一张图。除 name 外的字段全部透传给模板。
 * 每行可用 name 指定输出文件名；不写则按序号命名。
 * 依赖：本机 Chrome / Edge / Chromium。零 npm 依赖。
 *
 * 出图那一趟顺带体检：页面里注入了度量探针（见 度量.js），截图的同时多要一份
 * --dump-dom，就把"内容区放不放得下 / 真图渲染了几张 / 有没有缺图"一起收回来了。
 * 以前这三项要各起一趟 Chrome（一批 6 张图光校验就 21s），现在校验是零趟。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PROBE, expectImgs, parseMetrics, formatLine } = require('./度量.js');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser'
];

const W = 810, H = 1080, SCALE = 2, TIMEOUT_MS = 45000;
const HERE = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const HTML_ONLY = argv.includes('--html-only');
const tplArg = argv.find(a => a.startsWith('--template='));
// 不给 --template 时按数据自己判断（见 buildPages）：带 layout 字段的走贴图模板。
const TPL_ARG = tplArg ? tplArg.split('=')[1] : null;
const positional = argv.filter(a => !a.startsWith('--'));

// 一台机器同时开几个 Chrome。默认按核数来但不超过张数；JOBS=1 可退回串行。
const JOBS = Math.max(1, +process.env.JOBS || Math.min(6, os.cpus().length));

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

function safeName(s, i) {
  const base = String(s == null ? '' : s).trim() || String(i + 1).padStart(2, '0');
  return base.replace(/[\\/:*?"<>|\s]+/g, '_');
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

/** 找输入文件：先当前工作目录、再脚本目录，最后在脚本目录里按候选名兜底。
 *  脚本单独装在技能目录里时，从任何工作目录调用都能找到示例数据。 */
function resolveInput(name, fallbacks) {
  const tries = [path.resolve(process.cwd(), name), path.resolve(HERE, name)]
    .concat((fallbacks || []).map(f => path.resolve(HERE, f)));
  for (const p of tries) if (fs.existsSync(p)) return p;
  return tries[0];
}

/** Chrome 截图后常常不退出，所以用"文件大小稳定"当完成信号，然后强杀。
 *  截到临时名再改回来：目标文件不存在，就不会把上一轮的旧图误判成本轮成功，
 *  也不用先删旧图。
 *  同时要一份 --dump-dom 时（dumpPath 非空），还得等 DOM 写完
 *  ——否则会在探针把指标写进 <title> 之前就把它杀掉。 */
function shoot(chrome, args, png, dumpPath) {
  const tmp = png + '.' + process.pid + '-' + Date.now() + '.tmp.png';
  return new Promise((resolve, reject) => {
    const out = dumpPath ? fs.openSync(dumpPath, 'w') : 'ignore';
    const child = spawn(chrome, args.map(a => a === png ? tmp : a), { stdio: ['ignore', out, 'ignore'] });
    const t0 = Date.now();
    let last = -1, stable = 0, settled = false;

    const dumpDone = () => {
      if (!dumpPath || out === 'ignore') return true;
      const tail = readText(dumpPath).slice(-24);
      return /<\/html>\s*$/i.test(tail);
    };

    function done(err) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      try { child.kill('SIGKILL'); } catch (e) {}
      if (out !== 'ignore') { try { fs.closeSync(out); } catch (e) {} }
      if (!err) {
        try { fs.renameSync(tmp, png); } catch (e) { return reject(e); }
      } else {
        fs.rmSync(tmp, { force: true });
      }
      err ? reject(err) : resolve();
    }

    const timer = setInterval(() => {
      const size = sizeOf(tmp);
      if (size > 0 && size === last) stable++; else stable = 0;
      last = size;
      if (size > 0 && stable >= 2 && dumpDone()) return done(null);
      if (Date.now() - t0 > TIMEOUT_MS) return done(size > 0 ? null : new Error('截图超时'));
    }, 350);

    child.on('error', e => done(e));
    child.on('exit', async () => {
      await sleep(500);
      sizeOf(tmp) > 0 ? done(null) : done(new Error('Chrome 退出但没产出截图'));
    });
  });
}

function buildPages() {
  // 数据源和输出目录按**当前工作目录**找，模板和 vendor 从脚本自己的目录找。
  // 这样脚本可以从任何地方调用（比如装在 ~/.workbuddy/skills/ 下），
  // 素材留在技能目录里，产物落在你当前的项目里。
  const srcFile = resolveInput(positional[0] || '数据源示例.json', ['数据源示例.json', 'examples/数据-九种版式示例.json']);
  const outDir = path.resolve(process.cwd(), positional[1] || 'output');

  if (!fs.existsSync(srcFile)) throw new Error('数据源不存在: ' + srcFile);
  const rows = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  if (!Array.isArray(rows) || !rows.length) throw new Error('数据源必须是非空数组');

  // img / img2 / quadImgs 这类字段写相对路径时，在 .pages/ 子目录里会解析不到，
  // 统一换成绝对路径；外链和已经绝对的不动。数组字段（quadImgs）逐项处理。
  // 解析顺序：数据源同目录 → 脚本目录 → 当前工作目录（数据源同目录最符合直觉）。
  const srcDir = path.dirname(srcFile);
  let imgMissing = [];
  const absImg = (v, label) => {
    if (typeof v !== 'string' || !v.trim()) return v;
    if (/^(https?:|data:|file:|\/)/i.test(v)) return v;
    for (const base of [srcDir, HERE, process.cwd()]) {
      const p = path.resolve(base, v);
      if (fs.existsSync(p)) return p;
    }
    imgMissing.push(`${label}: ${v}`);
    return v;
  };
  rows.forEach((row, i) => {
    // 用「包含 img」而不是「以 img 开头」：quadImgs 这种数组字段开头是 quad，
    // 只匹配 /^img/ 会漏掉，图在 .pages/ 里就全 404（渲染成"缺图"小方块）。
    // bg 是满幅底图，字段名不含 img，必须单独列出来 —— 漏了它页面不报错，
    // 底图只是静静地 404（体检里显示"图 0/0 张"），最容易被误读成"探针不认识这个字段"。
    Object.keys(row).filter(k => /img/i.test(k) || k === 'bg').forEach(k => {
      const label = `${safeName(row.name, i)} 的 ${k}`;
      const v = row[k];
      row[k] = Array.isArray(v)
        ? v.map((x, n) => absImg(x, `${label}[${n + 1}]`))
        : absImg(v, label);
    });
  });

  // 模板自动选择：贴图数据带 layout 字段，老的信息图模板没有。
  // 不给 --template 却用错模板是**静默**错误 —— 页面能出，但版式完全是另一套。
  const TEMPLATE = TPL_ARG
    || (rows.some(r => r && typeof r === 'object' && 'layout' in r) ? '贴图模板.html' : '信息图模板.html');

  const tplPath = path.resolve(HERE, TEMPLATE);
  if (!fs.existsSync(tplPath)) throw new Error('模板不存在: ' + tplPath);
  const tpl = fs.readFileSync(tplPath, 'utf8');
  const pageDir = path.join(outDir, '.pages');
  fs.mkdirSync(pageDir, { recursive: true });


  // 页面会被写到 outDir/.pages/ 子目录里，任何 ./ 相对引用都会失效
  // （./vendor/echarts.min.js、./主题.js 都一样），所以统一改成绝对 file:// 路径；
  // 同时摘掉出图用不到的 CDN 脚本。
  const baseUrl = 'file://' + HERE + '/';

  // 根目录下的小模块（主题.js 这种）直接内联，彻底摆脱路径依赖 ——
  // 它们一旦 404，模板会静默白屏，排查成本比多几 KB 高得多。
  const baseTpl = tpl
    .replace(/<script[^>]*src=["']\.\/([^"'/]+\.js)["'][^>]*>\s*<\/script>/gi, (m, rel) => {
      const p = path.resolve(HERE, rel);
      return fs.existsSync(p) ? '<script>\n' + fs.readFileSync(p, 'utf8') + '\n</script>' : m;
    })
    .replace(/(src|href)=["']\.\/([^"']+)["']/g, (_m, attr, rel) => `${attr}="${baseUrl}${rel}"`)
    .replace(/<script[^>]*html2canvas[^>]*>\s*<\/script>/gi, '')
    // 度量探针挂在 </body> 前：只读 DOM、只写 <title>，不改样式，
    // 所以截图结果和注入前逐字节一致（改动时就是拿这个当验收标准的）。
    .replace(/<\/body>/i, PROBE + '</body>');

  const pages = rows.map((row, i) => {
    const { name, ...data } = row;
    const slug = safeName(name, i);
    const html = path.join(pageDir, slug + '.html');
    const inject =
      '<script>window.__INJECTED_DATA__=' +
      JSON.stringify(data).replace(/</g, '\\u003c') +
      ';window.__EXPECT_IMGS__=' + expectImgs(data) +
      ';window.__BATCH__=true;</script>';
    fs.writeFileSync(html, baseTpl.replace(/<head[^>]*>/i, m => m + '\n' + inject), 'utf8');
    return { slug, html, png: path.join(outDir, slug + '.png'), expect: expectImgs(data) };
  });

  // 给 批量出图.sh 一份"这次要截哪些页面"的清单。以前用 glob 扫 .pages/ 目录，
  // 换过模板或改过 name 之后，上一轮的旧页面也会被捡去截图（白出一批过期图）。
  // 用清单就不会有这个问题，也就不用去删旧文件了。
  fs.writeFileSync(path.join(pageDir, '_manifest.txt'),
    pages.map(p => p.slug + '.html').join('\n') + '\n', 'utf8');

  return { rows, pages, outDir, pageDir, tplPath, srcFile, imgMissing };
}

async function main() {
  const { rows, pages, outDir, pageDir, tplPath, srcFile, imgMissing } = buildPages();

  if (imgMissing.length) {
    console.log('以下配图找不到，会渲染成占位块：');
    imgMissing.forEach(m => console.log('  ' + m));
    console.log('');
  }

  if (HTML_ONLY) {
    console.log(`模板  ${path.basename(tplPath)}`);
    console.log(`数据  ${path.basename(srcFile)}  →  ${rows.length} 张`);
    console.log(`页面  ${pageDir}`);
    pages.forEach(p => console.log('  ' + p.html));
    return;
  }

  const chrome = findChrome();
  if (!chrome) throw new Error('没找到 Chrome / Edge / Chromium，请手动改脚本里的 CHROME_CANDIDATES');

  // dump 放子目录：.pages/ 里还要放页面本身，混在一起会让 globe 页面的逻辑捡到 dump
  const dumpDir = path.join(pageDir, '.dumps');
  fs.mkdirSync(dumpDir, { recursive: true });

  console.log(`模板  ${path.basename(tplPath)}`);
  console.log(`数据  ${path.basename(srcFile)}  →  ${rows.length} 张`);
  console.log(`输出  ${outDir}   ${W * SCALE}×${H * SCALE}px   并发 ${Math.min(JOBS, pages.length)}`);
  console.log('');

  const started = Date.now();
  const results = new Array(pages.length);
  let next = 0, finished = 0;
  // 第一张失败就把 --no-sandbox 记下来（受限环境下 Chrome 自身沙箱起不来）
  let extra = [];

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= pages.length) return;
      const { slug, html, png, expect } = pages[i];
      // 每张图用全新 profile：上一张被 kill 后会留下 SingletonLock，复用会让新 Chrome 直接退出
      const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-prof-'));
      const dump = path.join(dumpDir, slug + '.html');
      const args = [
        '--headless=new', ...extra, '--disable-gpu', '--hide-scrollbars',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        '--disable-background-timer-throttling',
        `--user-data-dir=${profileDir}`,
        `--window-size=${W},${H}`,
        `--force-device-scale-factor=${SCALE}`,
        '--virtual-time-budget=6000',
        `--screenshot=${png}`,
        '--dump-dom',                     // 顺带把体检指标捎回来
        'file://' + encodeURI(html)
      ];

      let err = null;
      try {
        await shoot(chrome, args, png, dump);
      } catch (e) {
        err = e;
        if (!extra.length) {
          // 回退重试一次
          extra = ['--no-sandbox'];
          args.splice(1, 0, '--no-sandbox');
          try { await shoot(chrome, args, png, dump); err = null; } catch (e2) { err = e2; }
        }
      }

      const m = parseMetrics(readText(dump));
      const line = m ? formatLine(m, expect) : null;
      results[i] = {
        slug, expect, metrics: m,
        ok: !err && !!line && line.ok,
        kb: Math.round(sizeOf(png) / 1024),
        text: err ? '失败: ' + err.message : (line ? line.text : '❌ 没读到指标'),
      };
      fs.rmSync(profileDir, { recursive: true, force: true });
      finished++;
      process.stdout.write(`\r  出图 ${finished}/${pages.length} …`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(JOBS, pages.length) }, worker));
  process.stdout.write('\r' + ' '.repeat(28) + '\r');

  let okShot = 0, okCheck = 0;
  results.forEach(r => {
    if (r.kb > 0) okShot++;
    if (r.ok) okCheck++;
    console.log(`  ${r.slug}.png   ${r.kb} KB`);
    console.log(`      ${r.text}`);
  });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(`完成 ${okShot}/${pages.length} 张，用时 ${secs}s`);
  console.log(`体检 ${okCheck}/${pages.length} 张通过（放得下 · 真图数对得上 · 无缺图）`);

  if (okShot === 0) {
    console.log('');
    console.log('全部失败：本进程没有权限启动 Chrome（沙箱 / 权限限制）。');
    console.log('改用两段式：先 node 批量出图.js 数据源.json output --html-only，再用 批量出图.sh 截图。');
    process.exitCode = 1;
    return;
  }
  if (okShot < pages.length || okCheck < pages.length) process.exitCode = 1;
}

main().catch(e => { console.error(e.message); process.exit(1); });
