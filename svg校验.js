/* SVG 导出几何探针：把 9 个 SVG 内联进一个页面，用 getBBox() 量真实边界。
   SVG 的 <text> 不会自动折行，长句最容易顶出画布或盖住脚注 —— 这一步就是查它。 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || 'svg输出_热点改版');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort();

const PROBE = `
window.addEventListener('load',function(){setTimeout(function(){
  var out=[];
  document.querySelectorAll('svg.card').forEach(function(sv){
    var name=sv.dataset.name, bad=[], maxR=0, maxB=0, minL=1e9, minT=1e9;
    sv.querySelectorAll('rect,circle,text,image,line,path').forEach(function(el){
      if(el.closest('defs'))return;
      if(el.closest('g[id="背景"]'))return;   // 背景装饰 blob 是设计内的出血，跳过
      var b; try{b=el.getBBox()}catch(e){return}
      if(!b.width&&!b.height)return;
      if(b.x+b.width>maxR)maxR=b.x+b.width;
      if(b.y+b.height>maxB)maxB=b.y+b.height;
      if(b.x<minL)minL=b.x; if(b.y<minT)minT=b.y;
      if(b.x+b.width>810.5||b.y+b.height>1080.5||b.x<-0.5||b.y<-0.5)
        bad.push(el.tagName+'['+Math.round(b.x+b.width)+','+Math.round(b.y+b.height)+']');
    });
    var cb=0, ft=1080;
    sv.querySelectorAll('g[id^="内容区"]').forEach(function(g){var b=g.getBBox(); if(b.y+b.height>cb)cb=b.y+b.height;});
    var fg=sv.querySelector('g[id="来源注释"]'); if(fg)ft=fg.getBBox().y;
    var tg=sv.querySelector('g[id="主标题"]'), tb=tg?tg.getBBox().y+tg.getBBox().height:0;
    out.push(name
      +' 画布['+Math.round(minL)+','+Math.round(minT)+' → '+Math.round(maxR)+','+Math.round(maxB)+']'
      +' 内容底'+Math.round(cb)+' 脚注顶'+Math.round(ft)
      +(cb>ft?' ❌盖脚注':'')
      +(cb<tb-1?' ❌压标题':'')
      +(bad.length?' ❌越界:'+bad.slice(0,3).join(' '):' ✅'));
  });
  document.title='SVGRES '+out.join(' || ')+' END';
},1200)});`;

const inlined = files.map(f => {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  return raw.replace('<svg ', '<svg class="card" data-name="' + f.replace(/\.svg$/, '') + '" ');
}).join('\n');

const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>'
  + '<style>body{margin:0;background:#fff}svg.card{display:block;margin:0}</style></head><body>\n'
  + inlined + '\n<script>' + PROBE + '</scr' + 'ipt></body></html>';

fs.writeFileSync('/tmp/svgprobe.html', html, 'utf8');
console.log('探针页 ' + Math.round(html.length / 1024) + ' KB，共 ' + files.length + ' 张');
files.forEach(f => console.log('  ' + f));
