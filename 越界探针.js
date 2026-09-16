/* 越界探针：检查溢出.js 只抓「overflow 不是 visible 且 scrollHeight > clientHeight」的元素，
   **看得见地顶出卡片**（文字溢到卡片外、盖住页脚）它抓不到。这里量 .content 内每个元素的
   真实 getBoundingClientRect，与 .content 和脚注的位置直接比。

   用法：node 越界探针.js <页面目录> [文件名关键词,逗号分隔]
         → 在**原页面同目录**生成 _probe_*.html（同目录是为了相对路径的图不 404），
           打印探针文件绝对路径，交给 Chrome --dump-dom。
   结果写在 <title>：XOF foot=<内容区底到脚注顶的距离> over=OK 或越界清单 END
   注意：要从 <title> 里取，直接正则整个 dump 会先匹到脚本源码本身。 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2]);
const filter = process.argv[3] ? process.argv[3].split(',') : null;

const PROBE = `
window.addEventListener('load',function(){setTimeout(function(){
  var cb=document.querySelector('.content').getBoundingClientRect();
  var fn=document.querySelector('.footnote');
  var fnTop=(fn&&!fn.classList.contains('empty'))?fn.getBoundingClientRect().top:cb.bottom+1;
  var bad=[];
  document.querySelectorAll('.content *').forEach(function(el){
    var r=el.getBoundingClientRect();
    if(r.width===0&&r.height===0)return;
    var cls=(typeof el.className==='string'&&el.className)?el.className.split(' ')[0]:el.tagName;
    // .bleed = 设计内的满幅出血（巨型字的色块垫、横向色带、cover 的数字带都顶到卡片内边距之外）。
    // 用 closest 而不是 contains：出血容器**里面的子元素**同样在卡片外，
    // 只跳过容器自己会把 .ck / .t 之类全报出来。
    if(el.closest&&el.closest('.bleed'))return;
    // 容差 2px：倾斜的贴纸和 VS 徽章外环本来就会稍微出血，算设计内
    if(r.bottom>cb.bottom+2||r.right>cb.right+2||r.left<cb.left-2)
      bad.push(cls+'[L'+Math.round(r.left-cb.left)+' R'+Math.round(r.right-cb.right)+' B'+Math.round(r.bottom-cb.bottom)+']');
  });
  document.title='XOF foot='+Math.round(fnTop-cb.bottom)+' over='+(bad.length?bad.slice(0,6).join(' ~ '):'OK')+' END';
},900)});`;

const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('_probe_'))
  .filter(f => !filter || filter.some(k => f.includes(k)));

const out = [];
for (const f of pages) {
  const src = path.join(dir, f);
  const dst = path.join(dir, '_probe_' + f);
  fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replace(/<\/body>/i,
    '<scr' + 'ipt>' + PROBE + '</scr' + 'ipt></body>'), 'utf8');
  out.push(dst);
}
console.log(out.join('\n'));
console.error('生成 ' + out.length + ' 个探针页');
