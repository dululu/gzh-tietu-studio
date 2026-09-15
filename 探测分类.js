// 批量探测维基共享分类：打印每个分类里的文件数与子分类，快速判断哪个分类有可用的横图。
// 用法: node 探测分类.js "Classrooms in China" "Universities and colleges in China" ...
const CATS = process.argv.slice(2);
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'gzh-tietu-studio/1.0 (https://github.com/dululu/gzh-tietu-studio)';

async function j(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  throw new Error('429 限流');
}

async function members(cat, type, limit) {
  const d = await j(`${API}?action=query&format=json&list=categorymembers`
    + `&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=${type}&cmlimit=${limit}`);
  return (d.query && d.query.categorymembers ? d.query.categorymembers : []).map(m => m.title);
}

(async () => {
  for (const cat of CATS) {
    try {
      const files = await members(cat, 'file', 200);
      const subs = (await members(cat, 'subcat', 60)).map(t => t.replace('Category:', ''));
      console.log(`\n【${cat}】 文件 ${files.length}  子分类 ${subs.length}`);
      if (files.length) console.log('  示例:\n    ' + files.slice(0, 6).join('\n    '));
      if (subs.length) console.log('  子分类: ' + subs.slice(0, 10).join(' | '));
      if (!files.length && subs.length) {
        for (const sc of subs.slice(0, 4)) {
          const tf = await members(sc, 'file', 6);
          console.log(`    ↳ ${sc}: ${tf.length} 张  ${tf.slice(0, 3).join(' / ')}`);
        }
      }
    } catch (e) {
      console.log(`\n【${cat}】 出错: ${e.message}`);
    }
  }
})();
