const fs = require('fs');
const path = require('path');
const DIST = path.join(__dirname, 'dist');
const SITE_FILE = path.join(__dirname, 'data/site.json');
const SITE = String((fs.existsSync(SITE_FILE) ? JSON.parse(fs.readFileSync(SITE_FILE,'utf8')).url : '')
  || process.env.SITE_URL || '').replace(/\/$/, '');
const ORIGIN = SITE.replace(/^(https?:\/\/[^/]+).*$/, '$1');
const BASE = SITE.slice(ORIGIN.length).replace(/\/$/, '');
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

// --- \u0412\u0435\u0447\u043d\u043e\u0437\u0435\u043b\u0451\u043d\u044b\u0435 \u0433\u0430\u0439\u0434\u044b -------------------------------------------------
// \u0413\u0430\u0439\u0434 \u0432\u044b\u0445\u043e\u0434\u0438\u0442 \u0422\u041e\u041b\u042c\u041a\u041e \u043d\u0430 \u044f\u0437\u044b\u043a\u0430\u0445 \u0438\u0437 \u0441\u0432\u043e\u0435\u0433\u043e langs. \u0415\u0441\u043b\u0438 \u0435\u0433\u043e \u0440\u0430\u0437\u043c\u043d\u043e\u0436\u0438\u0442\u044c \u043d\u0430 \u0432\u0441\u0435 17,
// \u043c\u044b \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u043c \u0440\u043e\u0432\u043d\u043e \u0442\u0443 \u0436\u0435 \u043e\u0448\u0438\u0431\u043a\u0443 \u0441 \u0434\u0443\u0431\u043b\u044f\u043c\u0438, \u0438\u0437-\u0437\u0430 \u043a\u043e\u0442\u043e\u0440\u043e\u0439 \u043f\u0440\u0438\u0448\u043b\u043e\u0441\u044c \u0440\u0435\u0437\u0430\u0442\u044c \u043d\u043e\u0432\u043e\u0441\u0442\u0438.
const guidesFile = path.join(__dirname,'content/guides.json');
const guides = fs.existsSync(guidesFile) ? JSON.parse(fs.readFileSync(guidesFile,'utf8')) : [];
const topics = JSON.parse(fs.readFileSync(path.join(__dirname,'data/guides.json'),'utf8'));
const topicById = Object.fromEntries(topics.map(t => [t.slug, t]));

// Недописанный гайд — НОРМАЛЬНОЕ промежуточное состояние: если одна партия
// переводов зависла, генератор сохраняет то, что успел, а следующий прогон дописывает.
// Раньше здесь стояло строгое равенство, и такой гайд ронял сборку — то есть одна
// зависшая партия блокировала выкладку ВСЕГО сайта (реальный провал прогона #75).
// Настоящий инвариант другой: лишних языков быть не должно, недостающие допустимы.
const incompleteGuides = [];
for (const g of guides) {
  check(!!topicById[g.slug], '\u0433\u0430\u0439\u0434 '+g.slug+' \u043d\u0435\u0442 \u0432 data/guides.json \u2014 \u0442\u0435\u043c\u044b \u043a\u0443\u0440\u0438\u0440\u0443\u044e\u0442\u0441\u044f \u0432\u0440\u0443\u0447\u043d\u0443\u044e');
  if (topicById[g.slug]) {
    const planned = topicById[g.slug].langs;
    const extra = g.langs.filter(l => !planned.includes(l));
    check(!extra.length, '\u0433\u0430\u0439\u0434 '+g.slug+': \u044f\u0437\u044b\u043a\u0438 \u0432\u043d\u0435 data/guides.json \u2014 '+extra.join(','));
    const short = planned.filter(l => !g.langs.includes(l));
    if (short.length) incompleteGuides.push(g.slug+' (\u043d\u0435\u0442: '+short.join(',')+')');
  }
  for (const l of langs) {
    const gp = path.join(DIST,l,'guide',g.slug,'index.html');
    const should = g.langs.includes(l);
    check(fs.existsSync(gp) === should,
      should ? '\u043d\u0435\u0442 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0433\u0430\u0439\u0434\u0430 '+g.slug+' /'+l
             : '\u0433\u0430\u0439\u0434 '+g.slug+' \u0441\u043e\u0431\u0440\u0430\u043b\u0441\u044f \u043d\u0430 /'+l+', \u0445\u043e\u0442\u044f \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043d \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f: '+g.langs.join(','));
    if (!should) continue;
    const h = fs.readFileSync(gp,'utf8');
    check(!h.includes('REPLACE_WITH'), '\u0431\u0438\u0442\u0430\u044f CTA \u0432 \u0433\u0430\u0439\u0434\u0435 '+g.slug+' /'+l);
    // hreflang \u0442\u043e\u043b\u044c\u043a\u043e \u043d\u0430 \u0440\u0435\u0430\u043b\u044c\u043d\u043e \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0435 \u044f\u0437\u044b\u043a\u0438
    for (const l2 of langs) {
      const has = h.includes('<link rel="alternate" hreflang="'+l2+'"');
      check(has === g.langs.includes(l2),
        '\u0433\u0430\u0439\u0434 '+g.slug+' /'+l+': hreflang="'+l2+'" '+(has?'\u043b\u0438\u0448\u043d\u0438\u0439 \u2014 \u0442\u0430\u043a\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u043d\u0435\u0442':'\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442'));
    }
    // \u0442\u0435 \u0436\u0435 \u043f\u0440\u0430\u0432\u0438\u043b\u0430 \u043f\u043e \u043e\u0444\u0444\u0435\u0440\u0430\u043c, \u0447\u0442\u043e \u0438 \u0432 \u0441\u0442\u0430\u0442\u044c\u044f\u0445
    for (const o of liveOffers) {
      if (homeOnly(o)) {
        check(!h.includes(o.url),
          '\u0417\u0410\u041f\u0420\u0415\u0429\u0415\u041d\u041e: \u043e\u0444\u0444\u0435\u0440 '+o.id+' (\u0442\u043e\u043b\u044c\u043a\u043e \u0432\u0438\u0442\u0440\u0438\u043d\u0430) \u043f\u043e\u043f\u0430\u043b \u0432 \u0433\u0430\u0439\u0434 '+g.slug+' /'+l);
      } else if (!allowedLangs(o).includes(l)) {
        check(!h.includes(o.url),
          '\u043e\u0444\u0444\u0435\u0440 '+o.id+' \u043f\u043e\u043f\u0430\u043b \u0432 \u0433\u0430\u0439\u0434 /'+l+', \u0445\u043e\u0442\u044f \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432: '+allowedLangs(o).join(','));
      }
    }
  }
}
// \u0433\u0430\u0439\u0434\u044b \u0432 sitemap \u043e\u0431\u044f\u0437\u0430\u043d\u044b \u0431\u044b\u0442\u044c monthly, \u0430 \u043d\u0435 hourly \u2014 \u0438\u043d\u0430\u0447\u0435 \u043a\u0440\u0430\u0443\u043b\u0435\u0440 \u0436\u0436\u0451\u0442 \u0431\u044e\u0434\u0436\u0435\u0442 \u0432\u043f\u0443\u0441\u0442\u0443\u044e
if (guides.length) {
  const sm = fs.readFileSync(path.join(DIST,'sitemap.xml'),'utf8');
  for (const line of sm.split('\n')) {
    if (/\/guides?\//.test(line)) check(line.includes('monthly'), '\u0432 sitemap \u0433\u0430\u0439\u0434 \u0441 changefreq \u043d\u0435 monthly: '+line.slice(0,80));
  }
}

// --- \u041f\u0435\u0440\u0435\u043b\u0438\u043d\u043a\u043e\u0432\u043a\u0430 ---------------------------------------------------
// \u0421\u043c\u044b\u0441\u043b \u0431\u043b\u043e\u043a\u0430 \u2014 \u0432\u0435\u0441\u0442\u0438 \u0441 \u043e\u0434\u043d\u043e\u0434\u043d\u0435\u0432\u043d\u043e\u0439 \u043d\u043e\u0432\u043e\u0441\u0442\u0438 \u043d\u0430 \u0432\u0435\u0447\u043d\u043e\u0437\u0435\u043b\u0451\u043d\u0443\u044e \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443,
// \u0433\u0434\u0435 \u043a\u043e\u043d\u0432\u0435\u0440\u0442\u044f\u0442 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0438\u0435 \u0441\u0441\u044b\u043b\u043a\u0438. \u0415\u0441\u043b\u0438 \u0431\u043b\u043e\u043a \u0442\u0438\u0445\u043e \u043f\u0440\u043e\u043f\u0430\u0434\u0451\u0442, \u0441\u0430\u0439\u0442 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442
// \u0441\u043e\u0431\u0438\u0440\u0430\u0442\u044c\u0441\u044f \u0438 \u043d\u0438\u043a\u0442\u043e \u043d\u0435 \u0437\u0430\u043c\u0435\u0442\u0438\u0442 \u2014 \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u0442\u0441\u044f \u044f\u0432\u043d\u043e.
{
  const relRe = /<aside class="related">([\s\S]*?)<\/aside>/;
  for (const l of langs) {
    const has = guides.some(g => g.langs.includes(l));
    for (const a of articles) {
      const ap = path.join(DIST,l,'news',a.slug,'index.html');
      if (!fs.existsSync(ap)) continue;
      const m = relRe.exec(fs.readFileSync(ap,'utf8'));
      check(!!m === has,
        has ? '\u0432 \u0441\u0442\u0430\u0442\u044c\u0435 '+a.slug+' /'+l+' \u043d\u0435\u0442 \u0431\u043b\u043e\u043a\u0430 \u043f\u0435\u0440\u0435\u043b\u0438\u043d\u043a\u043e\u0432\u043a\u0438, \u0445\u043e\u0442\u044f \u0433\u0430\u0439\u0434\u044b \u043d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u0435\u0441\u0442\u044c'
            : '\u0432 \u0441\u0442\u0430\u0442\u044c\u0435 '+a.slug+' /'+l+' \u0435\u0441\u0442\u044c \u0431\u043b\u043e\u043a \u043f\u0435\u0440\u0435\u043b\u0438\u043d\u043a\u043e\u0432\u043a\u0438, \u0445\u043e\u0442\u044f \u0433\u0430\u0439\u0434\u043e\u0432 \u043d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043d\u0435\u0442');
      if (!m) continue;
      for (const slug of [...m[1].matchAll(/\/guide\/([a-z0-9-]+)\//g)].map(x => x[1])) {
        const g = guides.find(x => x.slug === slug);
        check(!!g && g.langs.includes(l),
          '\u0441\u0442\u0430\u0442\u044c\u044f '+a.slug+' /'+l+' \u0441\u0441\u044b\u043b\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u0433\u0430\u0439\u0434 '+slug+', \u043a\u043e\u0442\u043e\u0440\u043e\u0433\u043e \u043d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043d\u0435\u0442');
      }
    }
    // \u0433\u0430\u0439\u0434 \u043d\u0435 \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u0441\u044b\u043b\u0430\u0442\u044c\u0441\u044f \u0441\u0430\u043c \u043d\u0430 \u0441\u0435\u0431\u044f
    for (const g of guides.filter(x => x.langs.includes(l))) {
      const gp = path.join(DIST,l,'guide',g.slug,'index.html');
      if (!fs.existsSync(gp)) continue;
      const m = relRe.exec(fs.readFileSync(gp,'utf8'));
      if (!m) continue;
      check(!m[1].includes('/guide/'+g.slug+'/'),
        '\u0433\u0430\u0439\u0434 '+g.slug+' /'+l+' \u0441\u0441\u044b\u043b\u0430\u0435\u0442\u0441\u044f \u0441\u0430\u043c \u043d\u0430 \u0441\u0435\u0431\u044f \u0432 \u0431\u043b\u043e\u043a\u0435 \u00ab\u041f\u043e\u043b\u0435\u0437\u043d\u043e \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c\u00bb');
    }
  }
}

// --- \u041f\u0440\u0438\u0432\u043b\u0435\u0447\u0435\u043d\u0438\u0435: \u0441\u0430\u0439\u0442 \u2192 Telegram, RSS, \u0441\u0432\u044f\u0437\u043a\u0430 \u0431\u0440\u0435\u043d\u0434\u0430 -----------------
// \u0421\u0430\u0439\u0442 \u0434\u0430\u0451\u0442 661 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0442\u0440\u0430\u0444\u0438\u043a\u0430, \u043a\u0430\u043d\u0430\u043b\u044b \u043f\u0443\u0441\u0442\u044b\u0435. \u0415\u0441\u043b\u0438 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u0438\u0445\u043e \u0438\u0441\u0447\u0435\u0437\u043d\u0435\u0442,
// \u0435\u0434\u0438\u043d\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u043a\u0430\u043d\u0430\u043b \u0438\u0437 \u0447\u0438\u0442\u0430\u0442\u0435\u043b\u044f \u0432 \u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u0430 \u0437\u0430\u043a\u0440\u043e\u0435\u0442\u0441\u044f, \u0438 \u044d\u0442\u043e \u043d\u0438\u043a\u0430\u043a \u043d\u0435 \u043f\u0440\u043e\u044f\u0432\u0438\u0442\u0441\u044f.
{
  const tgFile = path.join(__dirname,'data/telegram-channels.json');
  const tgRaw = fs.existsSync(tgFile) ? JSON.parse(fs.readFileSync(tgFile,'utf8')) : {};
  const pub = {};
  for (const [l,c] of Object.entries(tgRaw)) {
    if (l.startsWith('_')) continue;
    if (typeof c === 'string') {
      if (!c.startsWith('@')) continue;
      pub[l] = 'https://t.me/' + c.slice(1);
    } else if (c && typeof c === 'object' && typeof c.link === 'string' && /^https:\/\/t\.me\//.test(c.link)) {
      pub[l] = c.link;
    }
  }
  check(Object.keys(pub).length > 0, '\u0432 data/telegram-channels.json \u043d\u0435 \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043d\u0438 \u043e\u0434\u043d\u043e\u0433\u043e \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u043e\u0433\u043e \u043a\u0430\u043d\u0430\u043b\u0430');

  for (const l of langs) {
    const h = fs.readFileSync(path.join(DIST,l,'index.html'),'utf8');
    const m = /<a class="tgbtn" href="([^"]+)"/.exec(h);
    if (pub[l]) {
      check(!!m && m[1] === pub[l],
        '\u043d\u0430 /'+l+' \u043d\u0435\u0442 \u043a\u043d\u043e\u043f\u043a\u0438 Telegram \u0438\u043b\u0438 \u043e\u043d\u0430 \u0432\u0435\u0434\u0451\u0442 \u043d\u0435 \u043d\u0430 '+pub[l]+' (\u0441\u0435\u0439\u0447\u0430\u0441: '+(m?m[1]:'\u043d\u0435\u0442')+')');
    } else {
      check(!m, '\u043d\u0430 /'+l+' \u0435\u0441\u0442\u044c \u043a\u043d\u043e\u043f\u043a\u0430 Telegram, \u0445\u043e\u0442\u044f \u043a\u0430\u043d\u0430\u043b\u0430 \u043d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043d\u0435\u0442');
    }

    // RSS: без фида сайт не попадает в агрегаторы и читалки
    const rss = path.join(DIST,l,'rss.xml');
    check(fs.existsSync(rss), '\u043d\u0435\u0442 RSS \u043d\u0430 /'+l);
    if (fs.existsSync(rss)) {
      const x = fs.readFileSync(rss,'utf8');
      check(/<item>/.test(x), 'RSS /'+l+' \u043f\u0443\u0441\u0442\u043e\u0439');
      check(x.includes('/'+l+'/</link>') && x.includes('<language>'+l+'</language>'),
        'RSS /'+l+' \u0441\u0441\u044b\u043b\u0430\u0435\u0442\u0441\u044f \u043d\u0435 \u043d\u0430 \u0441\u0432\u043e\u0439 \u044f\u0437\u044b\u043a');
      check(h.includes('/'+l+'/rss.xml'), '\u0432 <head> /'+l+' \u043d\u0435\u0442 \u0441\u0441\u044b\u043b\u043a\u0438 \u043d\u0430 \u0444\u0438\u0434');
    }

    // sameAs: связывает сайт и каналы в один бренд для Google
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h);
    check(!!ld, '\u043d\u0430 /'+l+' \u043d\u0435\u0442 JSON-LD');
    if (ld) {
      let j = null;
      try { j = JSON.parse(ld[1]); } catch (e) { check(false, '\u0431\u0438\u0442\u044b\u0439 JSON-LD \u043d\u0430 /'+l); }
      const org = j && j['@graph'] && j['@graph'].find(x => x['@type'] === 'Organization');
      check(!!org, '\u043d\u0430 /'+l+' \u043d\u0435\u0442 Organization \u0432 JSON-LD');
      if (org) {
        // sameAs = каналы Telegram + аккаунты в соцсетях из data/social.json
        const socialCount = Object.entries(
          fs.existsSync(path.join(__dirname,'data/social.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname,'data/social.json'),'utf8')) : {}
        ).filter(([k,v]) => !k.startsWith('_') && typeof v === 'string' && v.trim()).length;
        check(Array.isArray(org.sameAs) && org.sameAs.length === Object.keys(pub).length + socialCount,
          '\u043d\u0430 /'+l+' sameAs \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442 \u0441 \u043a\u0430\u0440\u0442\u043e\u0439 \u043a\u0430\u043d\u0430\u043b\u043e\u0432');
      }
    }
  }
}

// --- \u0412\u0441\u0435 \u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0435 \u0441\u0441\u044b\u043b\u043a\u0438 \u0434\u043e\u043b\u0436\u043d\u044b \u0432\u0435\u0441\u0442\u0438 \u043d\u0430 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0435 \u0444\u0430\u0439\u043b\u044b -------------
// \u041f\u043e\u0439\u043c\u0430\u043b\u043e \u0440\u0435\u0430\u043b\u044c\u043d\u044b\u0439 \u0431\u0430\u0433: \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c \u044f\u0437\u044b\u043a\u043e\u0432 \u043d\u0430 \u0433\u0430\u0439\u0434\u0435 \u0432\u0451\u043b \u043d\u0430 /ja/guide/... \u2014 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u043d\u0435\u0442.
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc);
    else if (e.name.endsWith('.html')) acc.push(f);
  }
  return acc;
}
{
  const pages = walk(DIST, []);
  const broken = new Set();
  for (const f of pages) {
    const h = fs.readFileSync(f, 'utf8');
    for (const m of h.matchAll(/href="(\/[^"#]*)"/g)) {
      const u = m[1];
      if (/\.(png|txt|xml|ico|svg|webmanifest)$/.test(u)) continue;
      // При сборке под project pages все ссылки начинаются с BASE (/finpulse),
      // а в dist такой папки нет — dist и есть корень сайта. Отрезаем префикс.
      const rel = BASE && u.startsWith(BASE + '/') ? u.slice(BASE.length) : u;
      const target = path.join(DIST, rel.replace(/^\//, ''), rel.endsWith('/') ? 'index.html' : '');
      if (!fs.existsSync(target)) broken.add(u + '  \u2190 ' + path.relative(DIST, f));
    }
  }
  for (const b of broken) check(false, '\u0431\u0438\u0442\u0430\u044f \u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u0441\u0441\u044b\u043b\u043a\u0430: ' + b);
  console.log('\u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043e \u0441\u0442\u0440\u0430\u043d\u0438\u0446: ' + pages.length + ', \u0431\u0438\u0442\u044b\u0445 \u0441\u0441\u044b\u043b\u043e\u043a: ' + broken.size);
}

// Аналитика. Ловим две противоположные ошибки:
//  - счётчик забыли выключить и он висит на всех страницах, пока id пустой (лишний внешний запрос);
//  - id заведён, но скрипт не попал на страницы или партнёрские ссылки без data-offer —
//    тогда счётчик покажет визиты и НЕ покажет главное: дошёл ли кто-то до партнёрки.
{
  const anFile = path.join(__dirname, 'data/analytics.json');
  const an = fs.existsSync(anFile) ? JSON.parse(fs.readFileSync(anFile, 'utf8')) : {};
  const ga4 = String(an.ga4 || '');
  const pages = walk(DIST, []).filter(f => path.relative(DIST, f) !== 'index.html');
  let withGa = 0, withEvent = 0, ctas = 0, ctasTagged = 0;
  for (const f of pages) {
    const h = fs.readFileSync(f, 'utf8');
    if (h.includes('googletagmanager.com/gtag/js?id=' + (ga4 || '\u0000'))) withGa++;
    if (h.includes("'affiliate_click'")) withEvent++;
    // внутренняя навигация тоже носит класс cta — она не оффер, метка ей не нужна
    for (const m of h.matchAll(/<a class="cta"([^>]*)>/g)) {
      if (!/href="https?:\/\//.test(m[1])) continue;
      ctas++;
      if (/data-offer="[^"]+"/.test(m[1])) ctasTagged++;
    }
  }
  check(ctas > 0, '\u043d\u0438 \u043e\u0434\u043d\u043e\u0439 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u043e\u0439 \u043a\u043d\u043e\u043f\u043a\u0438 \u043d\u0430 \u0441\u0430\u0439\u0442\u0435 \u0432\u043e\u043e\u0431\u0449\u0435');
  check(ctas === ctasTagged, '\u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438 \u0431\u0435\u0437 data-offer: ' + (ctas - ctasTagged) + ' \u0438\u0437 ' + ctas + ' \u2014 \u043a\u043b\u0438\u043a\u0438 \u043f\u043e \u043d\u0438\u043c \u043d\u0435 \u0431\u0443\u0434\u0443\u0442 \u0441\u0447\u0438\u0442\u0430\u0442\u044c\u0441\u044f');
  if (ga4) {
    check(withGa === pages.length, 'GA4 \u0437\u0430\u0432\u0435\u0434\u0451\u043d, \u043d\u043e \u0441\u0447\u0451\u0442\u0447\u0438\u043a \u0435\u0441\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u043d\u0430 ' + withGa + ' \u0438\u0437 ' + pages.length + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446');
    check(withEvent === pages.length, 'GA4 \u0437\u0430\u0432\u0435\u0434\u0451\u043d, \u043d\u043e \u0441\u043e\u0431\u044b\u0442\u0438\u0435 affiliate_click \u0435\u0441\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u043d\u0430 ' + withEvent + ' \u0438\u0437 ' + pages.length + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446');
  } else {
    let ext = 0;
    for (const f of pages) if (fs.readFileSync(f, 'utf8').includes('googletagmanager')) ext++;
    check(ext === 0, 'ga4 \u043f\u0443\u0441\u0442, \u043d\u043e googletagmanager \u043e\u0441\u0442\u0430\u043b\u0441\u044f \u043d\u0430 ' + ext + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430\u0445');
  }
  console.log('analytics: ga4 ' + (ga4 || '\u043f\u0443\u0441\u0442') + ', \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0438\u0445 \u043a\u043d\u043e\u043f\u043e\u043a \u0441 data-offer: ' + ctasTagged + '/' + ctas);
}

// CNAME. Pages публикуется из артефакта: нет файла в артефакте — кастомный домен
// держится только на настройке репозитория. 24.08.2026 сайт уже лежал из-за домена,
// второй раз наступать на это не надо.
{
  const f = path.join(DIST, 'CNAME');
  const site = SITE.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (site && !/example\.com$/.test(site) && !/(^|\.)github\.io$/.test(site)) {
    check(fs.existsSync(f), 'SITE_URL задан (' + site + '), но dist/CNAME не создан \u2014 \u043a\u0430\u0441\u0442\u043e\u043c\u043d\u044b\u0439 \u0434\u043e\u043c\u0435\u043d \u0441\u043b\u0435\u0442\u0438\u0442 \u043f\u0440\u0438 \u0434\u0435\u043f\u043b\u043e\u0435');
    if (fs.existsSync(f)) {
      const got = fs.readFileSync(f, 'utf8').trim();
      check(got === site, 'dist/CNAME = "' + got + '", \u0430 SITE_URL \u0443\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442 \u043d\u0430 "' + site + '"');
      console.log('CNAME: ' + got);
    }
  } else {
    console.log('CNAME: SITE_URL \u043d\u0435 \u0437\u0430\u0434\u0430\u043d \u2014 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u0430');
  }
}

// Служебные страницы и раскрытие партнёрства.
// Для YMYL-тематики отсутствие «кто мы» и «на чём зарабатываем» — прямая причина,
// по которой Google не берёт страницы в индекс. А пометка рядом с партнёрскими
// ссылками требуется правилами сетей: убрать её молча нельзя.
{
  const pf = path.join(__dirname, 'data/pages.json');
  const praw = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const slugs = Object.keys(praw).filter(k => !k.startsWith('_'));
  check(slugs.length >= 3, '\u0432 data/pages.json \u043c\u0435\u043d\u044c\u0448\u0435 \u0442\u0440\u0451\u0445 \u0441\u043b\u0443\u0436\u0435\u0431\u043d\u044b\u0445 \u0441\u0442\u0440\u0430\u043d\u0438\u0446');

  let missing = 0, noLink = 0, thin = 0;
  for (const l of langs) {
    const home = fs.readFileSync(path.join(DIST, l, 'index.html'), 'utf8');
    for (const sl of slugs) {
      const f = path.join(DIST, l, sl, 'index.html');
      if (!fs.existsSync(f)) { check(false, '\u043d\u0435\u0442 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b /' + l + '/' + sl + '/'); missing++; continue; }
      const h = fs.readFileSync(f, 'utf8');
      const art = (h.match(/<article class="art">([\s\S]*?)<\/article>/) || [, ''])[1].replace(/<[^>]*>/g, ' ').trim();
      const min = ['zh', 'ja', 'ko', 'th'].includes(l) ? 150 : 250;  // иероглифика плотнее
      if (art.length < min) { check(false, '/' + l + '/' + sl + '/ \u043f\u043e\u0447\u0442\u0438 \u043f\u0443\u0441\u0442\u0430\u044f (' + art.length + ' \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)'); thin++; }
      if (!home.includes('href="' + BASE + '/' + l + '/' + sl + '/"')) {
        check(false, '\u043d\u0430 /' + l + '/ \u043d\u0435\u0442 \u0441\u0441\u044b\u043b\u043a\u0438 \u0432 \u043f\u043e\u0434\u0432\u0430\u043b\u0435 \u043d\u0430 ' + sl); noLink++;
      }
    }
  }

  // раскрытие обязано быть на каждой странице, где есть партнёрская кнопка
  const pages2 = walk(DIST, []).filter(f => path.relative(DIST, f) !== 'index.html');
  let withCta = 0, withDisc = 0;
  for (const f of pages2) {
    const h = fs.readFileSync(f, 'utf8');
    if (!/<a class="cta"[^>]*href="https?:\/\//.test(h)) continue;
    withCta++;
    if (/class="addisc"/.test(h)) withDisc++;
  }
  check(withCta > 0, '\u043d\u0438 \u043e\u0434\u043d\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0441 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u043e\u0439 \u043a\u043d\u043e\u043f\u043a\u043e\u0439');
  check(withCta === withDisc, '\u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438 \u0431\u0435\u0437 \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f: ' + (withCta - withDisc) + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446 \u0438\u0437 ' + withCta);
  console.log('pages: ' + slugs.length + '\u00d7' + langs.length + ', \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u0435 \u043d\u0430 ' + withDisc + '/' + withCta + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446 \u0441 \u043e\u0444\u0444\u0435\u0440\u0430\u043c\u0438');
}

// Тонкие новости: noindex + вне sitemap.
// Плюс защита от бага, который уже случился: счёт «слов» по пробелам отправил
// в noindex 100% страниц zh, ja и th, потому что эти языки пишутся без пробелов.
{
  const arts = JSON.parse(fs.readFileSync(path.join(__dirname, 'content/articles.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/site.json'), 'utf8'));
  const minW = Number(cfg.newsMinWords || 0);
  const K = { zh: 2.0, ja: 3.1, th: 6.7, ko: 2.6 };
  const wc = (t, l) => { const s2 = String(t || '').trim(); if (!s2) return 0;
    return K[l] ? Math.round(s2.replace(/\s+/g, '').length / K[l]) : s2.split(/\s+/).filter(Boolean).length; };

  if (minW > 0) {
    const sm = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
    let noTag = 0, leaked = 0, wrongTag = 0;
    const per = {};
    for (const a of arts) for (const [l, t] of Object.entries(a.i18n)) {
      const f = path.join(DIST, l, 'news', a.slug, 'index.html');
      if (!fs.existsSync(f)) continue;
      const h = fs.readFileSync(f, 'utf8');
      const hasNo = /<meta name="robots" content="noindex/.test(h);
      const inSm = sm.includes(BASE + '/' + l + '/news/' + a.slug + '/<');
      const thin = wc((t.body || []).join(' '), l) < minW;
      per[l] = per[l] || { thin: 0, tot: 0 };
      per[l].tot++; if (thin) per[l].thin++;
      if (thin && !hasNo) noTag++;
      if (thin && inSm) leaked++;
      if (!thin && hasNo) wrongTag++;
    }
    check(noTag === 0, '\u0442\u043e\u043d\u043a\u0438\u0445 \u0441\u0442\u0440\u0430\u043d\u0438\u0446 \u0431\u0435\u0437 noindex: ' + noTag);
    check(leaked === 0, '\u0442\u043e\u043d\u043a\u0438\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u043f\u043e\u043f\u0430\u043b\u0438 \u0432 sitemap: ' + leaked);
    check(wrongTag === 0, '\u043f\u043e\u043b\u043d\u043e\u0446\u0435\u043d\u043d\u044b\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0437\u0430\u043a\u0440\u044b\u0442\u044b noindex: ' + wrongTag);
    // ни один язык не должен уходить в noindex целиком — это признак сломанного счётчика
    for (const [l, v] of Object.entries(per)) {
      check(!(v.tot >= 5 && v.thin === v.tot),
        '\u044f\u0437\u044b\u043a ' + l + ': \u0432\u0441\u0435 ' + v.tot + ' \u0441\u0442\u0440\u0430\u043d\u0438\u0446 \u0443\u0448\u043b\u0438 \u0432 noindex \u2014 \u043f\u043e\u0445\u043e\u0436\u0435 \u043d\u0430 \u0441\u043b\u043e\u043c\u0430\u043d\u043d\u044b\u0439 \u0441\u0447\u0451\u0442\u0447\u0438\u043a \u0441\u043b\u043e\u0432');
    }
    const thinAll = Object.values(per).reduce((n, v) => n + v.thin, 0);
    const totAll = Object.values(per).reduce((n, v) => n + v.tot, 0);
    console.log('news: ' + thinAll + '/' + totAll + ' \u0442\u043e\u043d\u043a\u0438\u0445 \u2192 noindex');
  }
}

// --- Соцсети: одна точка правды ------------------------------------------
// Аккаунты живут в data/social.json. Пустое значение = аккаунта ещё нет,
// и ссылка НЕ должна появиться нигде: битая ссылка на несуществующий профиль
// хуже отсутствия ссылки и роняет доверие ровно там, где мы его строим.
{
  const socialFile = path.join(__dirname, 'data/social.json');
  const social = fs.existsSync(socialFile) ? JSON.parse(fs.readFileSync(socialFile, 'utf8')) : {};
  const live = Object.entries(social)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
    .map(([k, v]) => [k, v.trim()]);

  const home = fs.readFileSync(path.join(DIST, 'en', 'index.html'), 'utf8');
  for (const [net, handle] of live) {
    const url = net === 'tiktok' ? 'https://www.tiktok.com/@' + handle.replace(/^@/, '')
      : net === 'youtube' ? 'https://www.youtube.com/@' + handle.replace(/^@/, '')
      : net === 'instagram' ? 'https://www.instagram.com/' + handle.replace(/^@/, '') + '/'
      : net === 'x' ? 'https://x.com/' + handle.replace(/^@/, '') : null;
    if (!url) continue;
    check(home.includes(url), 'нет ссылки на ' + net + ' (' + url + ') в подвале /en/');
    check(home.includes('"' + url + '"'), 'ссылка на ' + net + ' не попала в sameAs — Google не свяжет аккаунт с сайтом');
  }
  // Пустые сети не должны протекать в разметку даже пустой строкой
  for (const [k, v] of Object.entries(social)) {
    if (k.startsWith('_') || (typeof v === 'string' && v.trim())) continue;
    check(!/tiktok\.com\/@["'\s>]|youtube\.com\/@["'\s>]/.test(home),
      'в разметке есть ссылка на соцсеть без аккаунта');
  }
  console.log('social: ' + (live.length ? live.map(([k, v]) => k + ' ' + v).join(', ') : 'аккаунтов пока нет'));
}

if (incompleteGuides.length) {
  console.log('guides: \u043d\u0435\u0434\u043e\u043f\u0438\u0441\u0430\u043d\u043e ' + incompleteGuides.length + ' \u2014 ' + incompleteGuides.join('; ') + ' (\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u043f\u0440\u043e\u0433\u043e\u043d \u0434\u043e\u043f\u0438\u0448\u0435\u0442)');
}
if (fails){console.error(fails+' failures');process.exit(1);} console.log('OK - all checks passed');
