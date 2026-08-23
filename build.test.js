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

// --- Партнёрские офферы: типы трафика и гео ------------------------------
// Две независимые оси ограничений, обе взяты из кабинета SalesDoubler 23.08.2026:
//
// 1) ТИП ТРАФИКА. Часть рекламодателей разрешает витрины/сервисы сравнения,
//    но ЗАПРЕЩАЕТ редакционный контент. Такие помечены "placement":"home"
//    и не должны попадать внутрь статей. Это настоящий запрет — за нарушение
//    штраф вплоть до отмены всех конверсий и бана.
//
// 2) ГЕО. Оффер работает только в определённых странах. Поле "langs" ограничивает
//    языковые версии. Показ вне гео — не запрет, а мёртвая карточка, которая
//    занимает место реального оффера.
//
// Оба списка зафиксированы ЗДЕСЬ намеренно: если пометку снимут в offers.json,
// тест обязан упасть, а не молча перестать защищать.

const RESTRICTED_TO_HOME = ['paybis', 'changelly'];
const GEO_LIMITED = {
  coinbase:   ['en','de','fr','pt','pl','ja'],
  paybis:     ['en','de','fr','pt','pl','ar'],
  changelly:  ['en','uk','es','pt','de','fr','ar','hi','id','vi','tr','pl','th'],
  rockwallet: ['en'],
};

const offersAll = JSON.parse(fs.readFileSync(path.join(__dirname,'data/offers.json'),'utf8'));
const isLiveUrl = u => typeof u === 'string' && /^https?:\/\//.test(u) && !/REPLACE_WITH/i.test(u);
const byId = Object.fromEntries(offersAll.map(o => [o.id, o]));
const liveOffers = offersAll.filter(o => isLiveUrl(o.url));

// заявленные ограничения обязаны быть в данных
for (const id of RESTRICTED_TO_HOME) {
  const o = byId[id];
  check(!!o, 'оффер '+id+' пропал из offers.json');
  if (o && isLiveUrl(o.url)) {
    check(o.placement === 'home', 'оффер '+id+' обязан иметь "placement":"home" — статейный трафик по нему запрещён');
  }
}
for (const [id, want] of Object.entries(GEO_LIMITED)) {
  const o = byId[id];
  check(!!o, 'оффер '+id+' пропал из offers.json');
  if (o && isLiveUrl(o.url)) {
    check(Array.isArray(o.langs) && o.langs.slice().sort().join(',') === want.slice().sort().join(','),
      'оффер '+id+' обязан иметь "langs":'+JSON.stringify(want)+' — он работает не во всех странах');
  }
}

const allowedLangs = o => Array.isArray(o.langs) ? o.langs : langs;
const homeOnly = o => o.placement === 'home';

for (const l of langs) {
  const homeHtml = fs.readFileSync(path.join(DIST,l,'index.html'),'utf8');
  check(!homeHtml.includes('REPLACE_WITH'), 'битая CTA-заглушка на главной '+l);

  for (const o of liveOffers) {
    const ok = allowedLangs(o).includes(l);
    check(homeHtml.includes(o.url) === ok,
      ok ? 'оффер '+o.id+' должен быть на главной /'+l
         : 'оффер '+o.id+' НЕ должен показываться на /'+l+' — работает только в: '+allowedLangs(o).join(','));
  }

  for (const a of articles) {
    const artPath = path.join(DIST,l,'news',a.slug,'index.html');
    if (!fs.existsSync(artPath)) continue;
    const artHtml = fs.readFileSync(artPath,'utf8');
    check(!artHtml.includes('REPLACE_WITH'), 'битая CTA-заглушка в статье '+a.slug+' /'+l);
    for (const o of liveOffers) {
      if (homeOnly(o)) {
        check(!artHtml.includes(o.url),
          'ЗАПРЕЩЕНО: оффер '+o.id+' (только витрина, статьи запрещены) попал в статью '+a.slug+' /'+l);
      } else if (!allowedLangs(o).includes(l)) {
        check(!artHtml.includes(o.url),
          'оффер '+o.id+' попал в статью /'+l+', хотя работает только в: '+allowedLangs(o).join(','));
      }
    }
  }
}

// на каждом языке должен остаться хотя бы один оффер, иначе блок пустой
for (const l of langs) {
  const n = liveOffers.filter(o => allowedLangs(o).includes(l)).length;
  check(n > 0, 'на языке '+l+' не осталось ни одного оффера');
}

if (fails){console.error(fails+' failures');process.exit(1);} console.log('OK - all checks passed');
