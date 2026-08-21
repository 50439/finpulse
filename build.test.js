const fs = require('fs');
const path = require('path');
const DIST = path.join(__dirname, 'dist');
const langs = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname,'data/i18n.json'),'utf8')).languages);
const articles = JSON.parse(fs.readFileSync(path.join(__dirname,'content/articles.json'),'utf8'));
let fails = 0;
const check = (c,m)=>{ if(!c){console.error('FAIL:',m);fails++;} };
check(fs.existsSync(path.join(DIST,'index.html')),'root redirect');
check(fs.existsSync(path.join(DIST,'sitemap.xml')),'sitemap');
check(fs.existsSync(path.join(DIST,'robots.txt')),'robots');
for (const l of langs) {
  const home = path.join(DIST,l,'index.html');
  check(fs.existsSync(home),'home '+l);
  const html = fs.readFileSync(home,'utf8');
  check(html.includes('hreflang'),'hreflang '+l);
  check(html.includes('viewport'),'viewport '+l);
  check(html.includes('Binance'),'offers '+l);
  for (const a of articles) check(fs.existsSync(path.join(DIST,l,'news',a.slug,'index.html')),'article '+a.slug+' '+l);
}
check(fs.readFileSync(path.join(DIST,'ar','index.html'),'utf8').includes('dir="rtl"'),'arabic RTL');
if (fails){console.error(fails+' failures');process.exit(1);} console.log('OK - all checks passed');
