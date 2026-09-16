/* 海报化外观探针：读 computedStyle，确认新版式的字号/色块/倾斜真的生效，
   以及 fitText 把字号缩到了多少。结果写 <title>。 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2]);
const filter = process.argv[3] ? process.argv[3].split(',') : null;

const PROBE = `
window.addEventListener('load',function(){setTimeout(function(){
  function cs(sel,prop){var e=document.querySelector(sel);return e?getComputedStyle(e)[prop]:'-';}
  function txt(sel){var e=document.querySelector(sel);return e?e.textContent.trim():'-';}
  var out=[];
  if(document.querySelector('.ly-vs')){
    out.push('tag='+cs('.ly-vs .side .tag','fontSize')+'/'+cs('.ly-vs .side .tag','borderRadius')
      +' nm='+cs('.ly-vs .side .nm','fontSize')+' vs徽章='+cs('.ly-vs .mid span','width')
      +'/'+cs('.ly-vs .mid span','transform')
      +' fit='+cs('.ly-vs .side .fit','borderRadius')+'/'+cs('.ly-vs .side .fit','backgroundImage').slice(0,10)
      +' 左顶条='+cs('.ly-vs .side.l','borderTopWidth'));
  }
  if(document.querySelector('.ly-cards')){
    out.push('编号块='+cs('.ly-cards .cd .no','width')+'×'+cs('.ly-cards .cd .no','height')
      +'/'+cs('.ly-cards .cd .no','fontSize')+'/底'+cs('.ly-cards .cd .no','backgroundColor')
      +' 贴纸='+cs('.ly-cards .cd .bdg','fontSize')+'/'+cs('.ly-cards .cd .bdg','transform')
      +' 左条='+cs('.ly-cards .cd','borderLeftWidth')
      +' 徽章数='+document.querySelectorAll('.ly-cards .cd .bdg').length);
  }
  if(document.querySelector('.ly-steps')){
    var sts=document.querySelectorAll('.ly-steps .st');
    out.push('序号块='+cs('.ly-steps .st .dot','width')+'×'+cs('.ly-steps .st .dot','height')
      +'/'+cs('.ly-steps .st .dot','fontSize')+'/'+cs('.ly-steps .st .dot','borderRadius')
      +' 台阶='+[].map.call(sts,function(s){return getComputedStyle(s).marginLeft}).join(',')
      +' 末级反白='+cs('.ly-steps .st:last-child','backgroundColor')
      +' 步数='+sts.length);
  }
  if(document.querySelector('.ly-hero')){
    out.push('结论='+cs('.hero-cap b','fontSize')+'/'+cs('.hero-cap b','display')
      +' 高亮垫='+(cs('.hero-cap b','backgroundImage').indexOf('gradient')>=0?'有':'无')
      +' 补行='+cs('.hero-cap span','fontSize')
      +' 图下卡='+cs('.ly-hero .hi','borderTopWidth')
      +' 编号='+cs('.ly-hero .hi .k','fontSize')+' 标题='+cs('.ly-hero .hi b','fontSize')
      +' 卡数='+document.querySelectorAll('.ly-hero .hi').length);
  }
  if(document.querySelector('.ly-bigword')){
    var w=document.querySelector('.ly-bigword .bw-word');
    var pd=document.querySelector('.ly-bigword .bw-pad');
    var wr=w.getBoundingClientRect(), pr=pd.getBoundingClientRect();
    out.push('巨型字='+cs('.ly-bigword .bw-word','fontSize')+'/'+cs('.ly-bigword .bw-word','fontWeight')
      +'/'+cs('.ly-bigword .bw-word','transform').slice(0,26)
      +' 色块垫='+Math.round(pr.width)+'×'+Math.round(pr.height)+'/'+cs('.ly-bigword .bw-pad','backgroundColor')
      // 垫要真的压在字上：垫顶在字底之上、垫底在字顶之下
      +' 压字='+((pr.top<wr.bottom&&pr.bottom>wr.top)?'是':'否')
      +' 说明='+cs('.ly-bigword .bw-note','fontSize')
      +' 数字块='+document.querySelectorAll('.ly-bigword .bwk').length
      +' 首块k='+cs('.ly-bigword .bwk .k','fontSize'));
  }
  if(document.querySelector('.ly-band')){
    var bs=document.querySelectorAll('.ly-band .bd');
    var cr=document.querySelector('.content').getBoundingClientRect();
    var b0=bs[0].getBoundingClientRect();
    out.push('色带数='+bs.length
      +' 高度='+[].map.call(bs,function(b){return Math.round(b.getBoundingClientRect().height)}).join(',')
      +' 出血(左)='+Math.round(b0.left-cr.left)
      +' 底色='+[].map.call(bs,function(b){return getComputedStyle(b).backgroundColor.replace(/[^0-9,]/g,'')}).join('|')
      +' 编号='+cs('.ly-band .bd .n','fontSize')+' 标题='+cs('.ly-band .bd .t b','fontSize')
      +' 零间距='+(bs.length>1?Math.round(bs[1].getBoundingClientRect().top-bs[0].getBoundingClientRect().bottom):'-'));
  }
  // 满幅外壳：量「白卡真的没了吗、底图真的解码了吗」。
  // naturalWidth 是关键 —— 只看 src 非空会把 404 的破图也判成"有图"。
  if(document.querySelector('.poster.full')){
    var bg=document.getElementById('bgImg');
    out.push('满幅=是 画布圆角='+cs('.poster','borderRadius')
      +' 卡底='+cs('.card','backgroundColor')
      +' 底图='+(bg&&bg.getAttribute('src')?'有':'无')
      +' 已解码='+(bg&&bg.naturalWidth?bg.naturalWidth+'×'+bg.naturalHeight:'否')
      +' 淡纱='+cs('.bgveil','display'));
  }
  if(document.querySelector('.ly-cover')){
    var pr3=document.querySelector('.poster').getBoundingClientRect();
    var kr=document.querySelector('.ly-cover .cv-keys');
    var k0=kr?kr.getBoundingClientRect():null;
    out.push('cover大字='+cs('.ly-cover .cv-big','fontSize')+'/'+cs('.ly-cover .cv-big','fontWeight')
      +' 高亮底='+cs('.ly-cover .cv-big em','boxShadow').slice(0,26)
      +' 说明='+cs('.ly-cover .cv-note','fontSize')
      // 数字带要顶到画布边（左 0 右 0），但里面文字仍要对齐在 76px
      +' 数字带顶边(左/右)='+(k0?Math.round(k0.left-pr3.left):'-')+'/'+(k0?Math.round(pr3.right-k0.right):'-')
      +' 首块左内边距='+cs('.ly-cover .cv-keys .ck','paddingLeft')
      +' k字号='+cs('.ly-cover .cv-keys .ck .k','fontSize')
      +' 块数='+document.querySelectorAll('.ly-cover .cv-keys .ck').length
      +' 共用标题='+cs('.title','display'));
  }
  document.title='POSTER '+out.join(' || ')+' END';
},900)});`;

const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('_probe_'))
  .filter(f => !filter || filter.some(k => f.includes(k)));

const out = [];
for (const f of pages) {
  const dst = path.join(dir, '_probe_' + f);
  fs.writeFileSync(dst, fs.readFileSync(path.join(dir, f), 'utf8').replace(/<\/body>/i,
    '<scr' + 'ipt>' + PROBE + '</scr' + 'ipt></body>'), 'utf8');
  out.push(dst);
}
console.log(out.join('\n'));
