// 列出维基共享某个分类下的全部图片文件名（递归一层子分类），用于挑图。
// 用法: node 列分类.js "Classrooms in China" "Rural classrooms in China" ...
const fs = require('fs');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'gzh-tietu-studio/1.0 (https://github.com/dululu/gzh-tietu-studio)';
const OK_EXT = /\.(jpe?g|png)$/i;

async function j(url) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } catch (e) {
      last = e;
      await new Promise(s => setTimeout(s, 800 * (i + 1)));
    }
  }
  throw new Error('重试 5 次仍失败: ' + last.message);
}
async function members(cat, type, limit) {
  const d = await j(`${API}?action=query&format=json&list=categorymembers`
    + `&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=${type}&cmlimit=${limit}`);
  return (d.query && d.query.categorymembers ? d.query.categorymembers : []).map(m => m.title);
}

(async () => {
  const out = [];
  for (const cat of process.argv.slice(2)) {
    out.push(`\n########## ${cat} ##########`);
    const files = (await members(cat, 'file', 300)).filter(t => OK_EXT.test(t));
    files.forEach(t => out.push('  ' + t.replace('File:', '')));
    const subs = (await members(cat, 'subcat', 40)).map(t => t.replace('Category:', ''));
    for (const sc of subs) {
      const tf = (await members(sc, 'file', 60)).filter(t => OK_EXT.test(t));
      if (tf.length) {
        out.push(`  ↳ ${sc}  (${tf.length})`);
        tf.slice(0, 20).forEach(t => out.push('      ' + t.replace('File:', '')));
      }
    }
  }
  const text = out.join('\n');
  fs.writeFileSync('/tmp/分类清单.txt', text);
  console.log(text);
})();
