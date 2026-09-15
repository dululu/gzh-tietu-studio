// 查维基共享文件的署名信息（只读元数据，不下载图片）。
// 用途：① 验证某个 File: 标题是否存在；② 补回被覆盖的取图记录里的作者/许可。
// 用法: node /tmp/署名.js "File:A.jpg" "File:B.jpg" ...
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'gzh-tietu-studio/1.0 (https://github.com/dululu/gzh-tietu-studio)';

async function j(url) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429) { await new Promise(s => setTimeout(s, 2000)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } catch (e) { last = e; await new Promise(s => setTimeout(s, 1200 * (i + 1))); }
  }
  throw new Error('重试失败: ' + last.message);
}

const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

(async () => {
  for (const title of process.argv.slice(2)) {
    const d = await j(`${API}?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata`
      + `&titles=${encodeURIComponent(title)}`);
    const page = Object.values(d.query.pages)[0];
    if (page.missing !== undefined) { console.log(`❌ 不存在  ${title}`); continue; }
    const ii = (page.imageinfo || [])[0];
    if (!ii) { console.log(`❌ 取不到信息  ${title}`); continue; }
    const em = ii.extmetadata || {};
    const author = strip(em.Artist && em.Artist.value) || '(未署名)';
    const lic = strip(em.LicenseShortName && em.LicenseShortName.value) || '(未知许可)';
    console.log(`${title.replace(/^File:/, '')}\n    ${ii.width}×${ii.height}   ${lic}   作者 ${author}`);
    await new Promise(s => setTimeout(s, 400));
  }
})();
