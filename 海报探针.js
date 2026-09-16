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
