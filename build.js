#!/usr/bin/env node
/* FinPulse static site generator - builds dist/ from content/ + data/ */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const SITE_URL = process.env.SITE_URL || 'https://finpulse.example.com';
const BASE = process.env.BASE_PATH || '';

const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/i18n.json'), 'utf8'));
const allOffers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers.json'), 'utf8'));
// Показываем только офферы с рабочей партнёрской ссылкой.
// Битая CTA (#REPLACE_WITH_...) хуже, чем её отсутствие: пользователь кликает — ничего не происходит.
// Как только ссылка появится в data/offers.json, оффер вернётся на сайт автоматически.
const isLive = (o) => typeof o.url === 'string' && /^https?:\/\//.test(o.url) && !/REPLACE_WITH/i.test(o.url);
const offers = allOffers.filter(isLive);

// Часть офферов рекламодатель разрешает только для витрин / сервисов сравнения
// предложений, но НЕ для редакционного контента (статей). Такие помечены
// "placement": "home" — они попадают в блок-витрину на главной, но не внутрь статей.
// Нарушение типа трафика грозит отменой всех конверсий и баном по офферу.
const isArticleSafe = (o) => o.placement !== 'home';
const articleOffers = offers.filter(isArticleSafe);
const forbiddenInArticles = offers.filter(o => !isArticleSafe(o)).map(o => o.url);

// Гео-таргетинг через языковые версии.
// Часть офферов работает только в одной стране (RockWallet — США, Libertex и ByBit —
// Украина, IN1 — Европа). Показывать их на всех 17 языках бессмысленно: посетитель
// из Таиланда по офферу для США всё равно не сконвертится, а карточка занимает место.
// Поле "langs" ограничивает оффер списком языковых версий. Нет поля — показываем везде.
const forLang = (list, lang) => list.filter(o => !Array.isArray(o.langs) || o.langs.includes(lang));
const targeted = offers.filter(o => Array.isArray(o.langs));
if (targeted.length) {
  console.warn('offers: с языковым таргетингом — ' + targeted.map(o => o.id + ' [' + o.langs.join(',') + ']').join(', '));
}
const homeOnlyIds = offers.filter(o => !isArticleSafe(o)).map(o => o.id);
if (homeOnlyIds.length) {
  console.warn('offers: только на главной (статейный трафик запрещён рекламодателем): ' + homeOnlyIds.join(', '));
}
if (!articleOffers.length) {
  console.warn('offers: ВНИМАНИЕ — для статейных страниц не осталось ни одного оффера');
}

const skippedOffers = allOffers.length - offers.length;
if (skippedOffers > 0) {
  console.warn('offers: ' + offers.length + '/' + allOffers.length + ' с рабочей ссылкой, ' + skippedOffers + ' скрыто (нет партнёрской ссылки): ' + allOffers.filter(o => !isLive(o)).map(o => o.id).join(', '));
}
const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'))
  .sort((a, b) => new Date(b.date) - new Date(a.date));

const LANGS = Object.keys(i18n.languages);
const S = (key, lang) => {
  let node = i18n.strings;
  for (const p of key.split('.')) node = node[p];
  return node[lang] || node.en;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root{--bg:#0b0e14;--bg2:#11151f;--card:#161b28;--card2:#1c2233;--text:#e8ecf4;--muted:#8b93a7;--accent:#22d3ee;--accent2:#818cf8;--green:#34d399;--red:#f87171;--gold:#fbbf24;--radius:16px}
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh}
a{color:inherit;text-decoration:none}
img{max-width:100%}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
header{position:sticky;top:0;z-index:50;background:rgba(11,14,20,.85);backdrop-filter:blur(14px);border-bottom:1px solid #ffffff12}
.nav{display:flex;align-items:center;gap:12px;height:58px}
.logo{font-weight:800;font-size:1.25rem;letter-spacing:-.02em;display:flex;align-items:center;gap:8px}
.logo .dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 0 12px var(--accent)}
.spacer{flex:1}
.langbtn{background:var(--card);border:1px solid #ffffff1a;color:var(--text);border-radius:99px;padding:7px 14px;font-size:.9rem;cursor:pointer;display:flex;align-items:center;gap:6px}
.langmenu{position:absolute;top:60px;inset-inline-end:16px;background:var(--card2);border:1px solid #ffffff1f;border-radius:14px;padding:8px;display:none;grid-template-columns:1fr 1fr;gap:2px;box-shadow:0 20px 50px #0009}
.langmenu.open{display:grid}
.langmenu a{padding:8px 12px;border-radius:9px;font-size:.9rem;white-space:nowrap}
.langmenu a:hover,.langmenu a.cur{background:#ffffff14}
.ticker{background:var(--bg2);border-bottom:1px solid #ffffff0d;overflow:hidden;white-space:nowrap;font-size:.85rem;padding:8px 0}
.ticker-track{display:inline-block;animation:tick 40s linear infinite}
@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tick-item{display:inline-flex;gap:6px;margin:0 18px;color:var(--muted)}
.tick-item b{color:var(--text);font-weight:600}
.up{color:var(--green)}.down{color:var(--red)}
.hero{padding:34px 0 10px}
.hero h1{font-size:clamp(1.5rem,5vw,2.4rem);font-weight:800;letter-spacing:-.03em;background:linear-gradient(90deg,#fff,#a5b4fc);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.badge{display:inline-flex;align-items:center;gap:6px;background:#22d3ee14;color:var(--accent);border:1px solid #22d3ee33;border-radius:99px;padding:4px 12px;font-size:.78rem;font-weight:600;margin-bottom:12px}
.badge .pulse{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
h2.sec{font-size:1.25rem;font-weight:750;margin:30px 0 14px;display:flex;align-items:center;gap:10px}
h2.sec::after{content:"";flex:1;height:1px;background:#ffffff14}
.grid{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:640px){.grid{grid-template-columns:1fr 1fr}}
@media(min-width:960px){.grid{grid-template-columns:1fr 1fr 1fr}}
.card{background:var(--card);border:1px solid #ffffff0f;border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:10px;transition:transform .18s,border-color .18s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-3px);border-color:#22d3ee44}
.card .em{font-size:1.6rem}
.card h3{font-size:1.02rem;font-weight:700;line-height:1.35}
.card p{color:var(--muted);font-size:.9rem;flex:1}
.meta{display:flex;gap:8px;align-items:center;font-size:.75rem;color:var(--muted)}
.chip{background:#ffffff10;border-radius:99px;padding:2px 10px;font-weight:600;color:#c7d2fe}
.more{color:var(--accent);font-size:.88rem;font-weight:600}
.offers{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:720px){.offers{grid-template-columns:1fr 1fr}}
.offer{background:linear-gradient(145deg,var(--card2),var(--card));border:1px solid #ffffff14;border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:12px;position:relative}
.offer-top{display:flex;align-items:center;gap:12px}
.olog{width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.3rem;color:#0b0e14;flex-shrink:0}
.oname{font-weight:800;font-size:1.1rem}
.orate{margin-inline-start:auto;color:var(--gold);font-size:.85rem;font-weight:700}
.obonus{background:#fbbf2415;border:1px dashed #fbbf2450;color:var(--gold);border-radius:10px;padding:7px 12px;font-size:.85rem;font-weight:600}
.ofeat{list-style:none;display:flex;flex-direction:column;gap:5px;font-size:.87rem;color:var(--muted)}
.ofeat li::before{content:"\\2713";color:var(--green);font-weight:700;margin-inline-end:8px}
.cta{display:block;text-align:center;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#0b0e14;font-weight:800;border-radius:12px;padding:13px;font-size:.98rem;transition:filter .15s,transform .15s}
.cta:hover{filter:brightness(1.12);transform:translateY(-1px)}
.tbadge{position:absolute;top:-9px;inset-inline-end:14px;background:linear-gradient(90deg,var(--gold),#f59e0b);color:#0b0e14;font-size:.7rem;font-weight:800;border-radius:99px;padding:3px 10px}
.art{max-width:720px;margin:0 auto;padding:30px 16px 40px}
.art h1{font-size:clamp(1.4rem,4.5vw,2rem);font-weight:800;letter-spacing:-.02em;line-height:1.25;margin:10px 0 16px}
.art p{margin:0 0 16px;color:#cbd2e0;font-size:1.02rem}
.art .lede{font-size:1.1rem;color:var(--text);font-weight:500}
.backlink{color:var(--accent);font-size:.9rem;font-weight:600}
.strip{background:linear-gradient(145deg,#1e2438,#161b28);border:1px solid #22d3ee2e;border-radius:var(--radius);padding:16px;margin:24px 0;display:flex;flex-direction:column;gap:10px}
.mcta{position:fixed;bottom:0;left:0;right:0;z-index:60;background:rgba(17,21,31,.92);backdrop-filter:blur(12px);border-top:1px solid #ffffff1a;padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px}
.mcta .cta{flex:1;padding:11px;margin:0}
.mcta .t{font-size:.8rem;color:var(--muted);line-height:1.3;max-width:45%}
@media(min-width:900px){.mcta{display:none}}
footer{border-top:1px solid #ffffff0f;margin-top:44px;padding:26px 0 90px;color:var(--muted);font-size:.82rem}
footer .langs{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
footer .langs a{color:#a5b4fc}
[dir=rtl] .ticker-track{animation-direction:reverse}
`;

const TICKER_JS = `
(async function(){
  try{
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,the-open-network&vs_currencies=usd&include_24hr_change=true');
    const d = await r.json();
    const map = [['bitcoin','BTC'],['ethereum','ETH'],['solana','SOL'],['binancecoin','BNB'],['ripple','XRP'],['cardano','ADA'],['dogecoin','DOGE'],['the-open-network','TON']];
    const items = map.filter(m=>d[m[0]]).map(function(m){
      const p=d[m[0]].usd, c=d[m[0]].usd_24h_change||0;
      const cls=c>=0?'up':'down', arrow=c>=0?'\\u25B2':'\\u25BC';
      return '<span class="tick-item"><b>'+m[1]+'</b> $'+p.toLocaleString('en-US',{maximumFractionDigits:p>100?0:4})+' <span class="'+cls+'">'+arrow+Math.abs(c).toFixed(2)+'%</span></span>';
    }).join('');
    const t=document.getElementById('tk'); if(t&&items){t.innerHTML=items+items;}
  }catch(e){}
})();
document.addEventListener('click',function(e){
  const b=document.getElementById('langbtn'), m=document.getElementById('langmenu');
  if(!b||!m)return;
  if(b.contains(e.target)){m.classList.toggle('open');}
  else if(!m.contains(e.target)){m.classList.remove('open');}
});
`;

function langLinks(pathFn) {
  return LANGS.map(l => '<link rel="alternate" hreflang="' + l + '" href="' + SITE_URL + pathFn(l) + '">').join('\n  ')
    + '\n  <link rel="alternate" hreflang="x-default" href="' + SITE_URL + pathFn('en') + '">';
}

function page(opt) {
  const { lang, title, desc, pathFn, body, jsonld } = opt;
  const L = i18n.languages[lang];
  return '<!DOCTYPE html>\n<html lang="' + lang + '" dir="' + L.dir + '">\n<head>\n' +
    '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n' +
    '<link rel="canonical" href="' + SITE_URL + pathFn(lang) + '">\n  ' + langLinks(pathFn) + '\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:type" content="website">\n<meta name="theme-color" content="#0b0e14">\n' +
    '<meta property="og:image" content="' + SITE_URL + '/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="' + SITE_URL + '/og.png">\n' +
    '<link rel="icon" type="image/png" sizes="32x32" href="' + BASE + '/favicon-32.png">\n<link rel="icon" type="image/png" sizes="192x192" href="' + BASE + '/favicon-192.png">\n<link rel="apple-touch-icon" href="' + BASE + '/apple-touch-icon.png">\n' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><text y=%27.9em%27 font-size=%2790%27>\\uD83D\\uDCC8</text></svg>">\n' +
    (jsonld ? '<script type="application/ld+json">' + JSON.stringify(jsonld) + '</script>\n' : '') +
    '<style>' + CSS + '</style>\n</head>\n<body>\n' +
    header(lang, pathFn) + '\n' + body + '\n' + footer(lang) +
    '\n<script>' + TICKER_JS + '</script>\n</body>\n</html>';
}

function header(lang, pathFn) {
  const L = i18n.languages[lang];
  const menu = LANGS.map(l =>
    '<a href="' + pathFn(l) + '" class="' + (l === lang ? 'cur' : '') + '" hreflang="' + l + '">' + i18n.languages[l].flag + ' ' + i18n.languages[l].name + '</a>').join('');
  return '<header><div class="wrap nav">' +
    '<a class="logo" href="' + BASE + '/' + lang + '/"><span class="dot"></span>FinPulse</a>' +
    '<div class="spacer"></div>' +
    '<button class="langbtn" id="langbtn">' + L.flag + ' ' + lang.toUpperCase() + ' \\u25BE</button>'.replace('\\u25BE','\u25BE') +
    '<div class="langmenu" id="langmenu">' + menu + '</div>' +
    '</div></header>' +
    '<div class="ticker"><div class="ticker-track" id="tk"><span class="tick-item">' + esc(S('marketsNow', lang)) + '\u2026</span></div></div>';
}

function footer(lang) {
  const links = LANGS.map(l => '<a href="' + BASE + '/' + l + '/">' + i18n.languages[l].name + '</a>').join('');
  return '<footer><div class="wrap">' +
    '<div><b>FinPulse</b> \u2014 ' + esc(S('tagline', lang)) + '</div>' +
    '<div class="langs">' + links + '</div>' +
    '<div>\u26A0\uFE0F ' + esc(S('riskDisclaimer', lang)) + '</div>' +
    '<div style="margin-top:8px">\u00A9 ' + new Date().getFullYear() + ' FinPulse</div>' +
    '</div></footer>';
}

function offerCard(o, lang, top) {
  return '<div class="offer">' + (top ? '<div class="tbadge">TOP</div>' : '') +
    '<div class="offer-top"><div class="olog" style="background:' + o.color + '">' + o.logo + '</div>' +
    '<div><div class="oname">' + o.name + '</div><div class="meta">' + esc(S('categories.' + (o.type === 'forex' ? 'forex' : 'crypto'), lang)) + '</div></div>' +
    '<div class="orate">\u2605 ' + o.rating + '</div></div>' +
    '<div class="obonus">\uD83C\uDF81 ' + esc(o.bonus[lang] || o.bonus.en) + '</div>' +
    '<ul class="ofeat">' + (o.features[lang] || o.features.en).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
    '<a class="cta" href="' + o.url + '" rel="nofollow sponsored noopener" target="_blank">' + esc(S('startTrading', lang)) + ' \u2192</a>' +
    '</div>';
}

function newsCard(a, lang) {
  const t = a.i18n[lang] || a.i18n.en;
  const d = new Date(a.date).toLocaleDateString(i18n.languages[lang].locale, { day: 'numeric', month: 'short' });
  return '<a class="card" href="' + BASE + '/' + lang + '/news/' + a.slug + '/" style="background:' + a.gradient + ',var(--card)">' +
    '<div class="em">' + a.emoji + '</div>' +
    '<div class="meta"><span class="chip">' + esc(S('categories.' + a.category, lang)) + '</span><span>' + d + '</span></div>' +
    '<h3>' + esc(t.title) + '</h3><p>' + esc(t.excerpt) + '</p>' +
    '<span class="more">' + esc(S('readMore', lang)) + ' \u2192</span>' +
    '</a>';
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const urls = [];

for (const lang of LANGS) {
  const pathHome = l => BASE + '/' + l + '/';
  const home = page({
    lang,
    title: 'FinPulse \u2014 ' + S('tagline', lang),
    desc: S('tagline', lang),
    pathFn: pathHome,
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'FinPulse', url: SITE_URL + '/' + lang + '/' },
    body: '<main class="wrap">' +
      '<section class="hero"><div class="badge"><span class="pulse"></span>' + esc(S('updatedEvery', lang)) + '</div>' +
      '<h1>' + esc(S('tagline', lang)) + '</h1></section>' +
      '<h2 class="sec" id="offers">\uD83C\uDFC6 ' + esc(S('topPlatforms', lang)) + '</h2>' +
      '<div class="offers">' + forLang(offers, lang).map((o, i) => offerCard(o, lang, i === 0)).join('') + '</div>' +
      '<h2 class="sec">\uD83D\uDCF0 ' + esc(S('latestNews', lang)) + '</h2>' +
      '<div class="grid">' + articles.slice(0, 6).map(a => newsCard(a, lang)).join('') + '</div>' +
      '<p style="margin:18px 0"><a class="cta" style="max-width:340px;margin:0 auto" href="' + BASE + '/' + lang + '/news/">' + esc(S('allNews', lang)) + ' \u2192</a></p>' +
      '</main>' +
      '<div class="mcta"><div class="t">\uD83C\uDFC6 ' + esc(S('topPlatforms', lang)) + '</div><a class="cta" href="#offers">' + esc(S('startTrading', lang)) + '</a></div>'
  });
  fs.mkdirSync(path.join(DIST, lang), { recursive: true });
  fs.writeFileSync(path.join(DIST, lang, 'index.html'), home);
  urls.push(pathHome(lang));

  // News archive page
  {
    const pfn = l => BASE + '/' + l + '/news/';
    const newsHtml = page({
      lang,
      title: S('allNews', lang) + ' \u2014 FinPulse',
      desc: S('tagline', lang),
      pathFn: pfn,
      body: '<main class="wrap">' +
        '<section class="hero"><h1>\uD83D\uDCF0 ' + esc(S('allNews', lang)) + '</h1></section>' +
        '<div class="grid">' + articles.map(a => newsCard(a, lang)).join('') + '</div>' +
        '</main>'
    });
    fs.mkdirSync(path.join(DIST, lang, 'news'), { recursive: true });
    fs.writeFileSync(path.join(DIST, lang, 'news', 'index.html'), newsHtml);
    urls.push(pfn(lang));
  }

  for (const a of articles) {
    const t = a.i18n[lang] || a.i18n.en;
    const pf = l => BASE + '/' + l + '/news/' + a.slug + '/';
    const topOffers = forLang(articleOffers, lang).slice(0, 2);
    const artHtml = page({
      lang,
      title: t.title + ' \u2014 FinPulse',
      desc: t.excerpt,
      pathFn: pf,
      jsonld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: t.title, datePublished: a.date, inLanguage: lang, publisher: { '@type': 'Organization', name: 'FinPulse' } },
      body: '<main class="art">' +
        '<a class="backlink" href="' + BASE + '/' + lang + '/">\u2190 ' + esc(S('allNews', lang)) + '</a>' +
        '<div class="meta" style="margin-top:14px"><span class="chip">' + esc(S('categories.' + a.category, lang)) + '</span><span>' + new Date(a.date).toLocaleDateString(i18n.languages[lang].locale, { day: 'numeric', month: 'long', year: 'numeric' }) + '</span></div>' +
        '<h1>' + esc(t.title) + '</h1>' +
        '<p class="lede">' + esc(t.excerpt) + '</p>' +
        t.body.map(p => '<p>' + esc(p) + '</p>').join('') +
        '<div class="strip">' + topOffers.map(o => offerCard(o, lang)).join('') + '</div>' +
        '</main>' +
        (topOffers.length
          ? '<div class="mcta"><div class="t">\uD83C\uDF81 ' + esc(topOffers[0].bonus[lang] || topOffers[0].bonus.en) + '</div><a class="cta" href="' + topOffers[0].url + '" rel="nofollow sponsored noopener" target="_blank">' + esc(S('startTrading', lang)) + '</a></div>'
          : '')
    });
    // Страховка: оффер, запрещённый рекламодателем для редакционного контента,
    // не должен попасть в статью ни при каких изменениях кода выше.
    for (const badUrl of forbiddenInArticles) {
      if (artHtml.includes(badUrl)) {
        throw new Error('НАРУШЕНИЕ ТИПА ТРАФИКА: оффер со ссылкой ' + badUrl +
          ' разрешён только для витрин, но попал в статью ' + lang + '/' + a.slug +
          '. Сборка остановлена — публикация этого нарушает правила оффера.');
      }
    }

    const dir = path.join(DIST, lang, 'news', a.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), artHtml);
    urls.push(pf(lang));
  }
}

fs.writeFileSync(path.join(DIST, 'index.html'),
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FinPulse</title>' +
  '<script>var l=(navigator.language||"en").slice(0,2);var s=' + JSON.stringify(LANGS) + ';location.replace("' + BASE + '/"+(s.indexOf(l)>-1?l:"en")+"/");</script>' +
  '<meta http-equiv="refresh" content="1;url=' + BASE + '/en/"></head><body></body></html>');

fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => '<url><loc>' + SITE_URL + u + '</loc><changefreq>hourly</changefreq></url>').join('\n') + '\n</urlset>');
fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

console.log('Built ' + urls.length + ' pages for ' + LANGS.length + ' languages -> dist/');

// IndexNow key file
fs.writeFileSync(path.join(DIST, 'ee221c0a3d35f01be5577688fa06a50a.txt'), 'ee221c0a3d35f01be5577688fa06a50a');

// Brand assets -> dist
for (const f of ['og.png','favicon-32.png','favicon-192.png','apple-touch-icon.png','logo-512.png','logo-text-512.png','logo-animated.svg']) {
  const src = path.join(__dirname, 'brand', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
}
