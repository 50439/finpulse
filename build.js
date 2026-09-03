#!/usr/bin/env node
/* FinPulse static site generator - builds dist/ from content/ + data/ */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
// SITE_URL — единственная точка правды об адресе сайта. Он может содержать
// подпуть (project pages: https://user.github.io/repo), поэтому разбираем его:
//   ORIGIN — протокол+хост, к нему приклеиваются пути, В КОТОРЫХ BASE УЖЕ ЕСТЬ;
//   BASE   — подпуть, его добавляют все внутренние ссылки.
// Без этого разделения canonical получал /finpulse дважды.
const SITE_FILE = path.join(ROOT, 'data/site.json');
const siteCfg = fs.existsSync(SITE_FILE) ? JSON.parse(fs.readFileSync(SITE_FILE, 'utf8')) : {};
const SITE_URL = String(siteCfg.url || process.env.SITE_URL || 'https://finpulse.example.com').replace(/\/$/, '');
const ORIGIN = SITE_URL.replace(/^(https?:\/\/[^/]+).*$/, '$1');
const BASE = SITE_URL.slice(ORIGIN.length).replace(/\/$/, '');

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

// Вечнозелёные гайды. Файл может отсутствовать (первая сборка до генерации) — это не ошибка.
const GUIDES_FILE = path.join(ROOT, 'content/guides.json');
const guides = fs.existsSync(GUIDES_FILE)
  ? JSON.parse(fs.readFileSync(GUIDES_FILE, 'utf8'))
  : [];
const GUIDES_LABEL = { en: 'Guides', uk: '\u041f\u043e\u0441\u0456\u0431\u043d\u0438\u043a\u0438', ru: '\u0413\u0430\u0439\u0434\u044b', es: 'Gu\u00edas', pt: 'Guias',
  de: 'Ratgeber', fr: 'Guides', ar: '\u0623\u062f\u0644\u0629', zh: '\u6307\u5357', hi: '\u0917\u093e\u0907\u0921',
  id: 'Panduan', vi: 'H\u01b0\u1edbng d\u1eabn', tr: 'Rehberler', ja: '\u30ac\u30a4\u30c9', ko: '\uac00\uc774\ub4dc',
  pl: 'Poradniki', th: '\u0e04\u0e39\u0e48\u0e21\u0e37\u0e2d' };
const gLabel = l => GUIDES_LABEL[l] || GUIDES_LABEL.en;
const guidesFor = lang => guides.filter(g => Array.isArray(g.langs) && g.langs.includes(lang));

// Telegram-каналы. Берём ту же карту, что и автопостинг, чтобы ссылка на сайте
// и канал, куда реально идут посты, не разъехались.
const TG_FILE = path.join(ROOT, 'data/telegram-channels.json');
const tgRaw = fs.existsSync(TG_FILE) ? JSON.parse(fs.readFileSync(TG_FILE, 'utf8')) : {};
const tgChannels = {};
for (const [l, chat] of Object.entries(tgRaw)) {
  if (l.startsWith('_')) continue;
  // Публичный канал: строка "@username". Приватный: {chat:"-100...", link:"https://t.me/+..."}.
  // В обоих случаях нужна ссылка, по которой посетитель сайта может вступить.
  if (typeof chat === 'string') {
    if (!chat.startsWith('@')) continue;                       // числовой id без invite-ссылки — показать нечего
    tgChannels[l] = 'https://t.me/' + chat.slice(1);
  } else if (chat && typeof chat === 'object' && typeof chat.link === 'string' && /^https:\/\/t\.me\//.test(chat.link)) {
    tgChannels[l] = chat.link;
  }
}
const tgFor = lang => tgChannels[lang] || null;

// Соцсети из data/social.json. Пустое значение = аккаунта ещё нет, ссылка не
// появляется нигде: битая ссылка на несуществующий профиль хуже её отсутствия.
// Одно место правки — и подвал, и sameAs, и подпись в роликах меняются вместе.
const SOCIAL_FILE = path.join(ROOT, 'data/social.json');
const socialRaw = fs.existsSync(SOCIAL_FILE) ? JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8')) : {};
const SOCIAL_URL = {
  tiktok: h => 'https://www.tiktok.com/@' + h,
  youtube: h => 'https://www.youtube.com/@' + h,
  instagram: h => 'https://www.instagram.com/' + h + '/',
  x: h => 'https://x.com/' + h
};
const SOCIAL_LABEL = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', x: 'X' };
const socialLinks = Object.entries(socialRaw)
  .filter(([k, v]) => !k.startsWith('_') && SOCIAL_URL[k] && typeof v === 'string' && v.trim())
  .map(([k, v]) => ({ net: k, label: SOCIAL_LABEL[k], url: SOCIAL_URL[k](v.trim().replace(/^@/, '')) }));
console.log('social: ' + (socialLinks.length
  ? socialLinks.map(s => s.net + ' ' + s.url).join(', ') : 'аккаунтов пока нет'));
console.log('telegram: публичных каналов для сайта — ' + Object.keys(tgChannels).length +
  ' (' + Object.keys(tgChannels).join(', ') + ')');

// Аналитика. Без неё нельзя ответить на вопрос «трафик доходит до партнёрской ссылки?» —
// а без этого ответа любой платный или бесплатный источник трафика оценивать нечем.
// Пустой ga4 = ни одного внешнего запроса со страницы. Так и должно быть, пока id не заведён.
const AN_FILE = path.join(ROOT, 'data/analytics.json');
const anRaw = fs.existsSync(AN_FILE) ? JSON.parse(fs.readFileSync(AN_FILE, 'utf8')) : {};
const GA4 = /^G-[A-Z0-9]{6,}$/.test(String(anRaw.ga4 || '')) ? String(anRaw.ga4) : '';
if (anRaw.ga4 && !GA4) throw new Error('data/analytics.json: ga4 "' + anRaw.ga4 + '" не похож на идентификатор GA4 (G-XXXXXXXXXX)');
console.log('analytics: ' + (GA4 ? 'GA4 ' + GA4 + ', cookieless' : 'выключена (ga4 пуст)'));

// Счётчик грузится только при непустом id. storage:'none' — без cookies, поэтому
// баннер согласия не нужен ни на одной из европейских языковых версий.
const analyticsHead = () => GA4 ? '<script async src="https://www.googletagmanager.com/gtag/js?id=' + GA4 + '"></script>\n' +
  '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag(\'js\',new Date());' +
  'gtag(\'config\',\'' + GA4 + '\',{client_storage:\'none\',anonymize_ip:true});</script>\n' : '';

// Делегированный обработчик: одна ссылка на страницу не нужна — ловим всплытие.
// data-offer проставляется на каждой партнёрской ссылке в offerCard().
const analyticsBody = lang => GA4 ? '\n<script>document.addEventListener(\'click\',function(e){' +
  'var a=e.target.closest&&e.target.closest(\'a[data-offer]\');if(!a||!window.gtag)return;' +
  'gtag(\'event\',\'affiliate_click\',{offer:a.getAttribute(\'data-offer\'),lang:\'' + lang + '\',page_path:location.pathname});' +
  '},{passive:true});</script>' : '';

// Служебные страницы: «О проекте», «Контакты», «Раскрытие».
// Для финансовой тематики (YMYL) это не украшение: без указания, кто отвечает
// за контент и на чём сайт зарабатывает, Google оценивает страницы как
// низкокачественные — что и показал отчёт «просканирована, но не проиндексирована».
// Порог «тонкой» страницы. Новость короче него закрывается от индексации
// и не попадает в sitemap. Причина: Google отверг 207 страниц из 213 как
// «просканирована, но не проиндексирована» — это оценка качества, и пока
// в индекс просятся пересказы на 50 слов, страдает доверие ко всему домену.
// noindex,follow — важно именно follow: ссылки со страницы продолжают работать.
const NEWS_MIN_WORDS = Number(siteCfg.newsMinWords || 0);
// Считать «слова» по пробелам можно не везде: китайский и японский пишутся без
// них вовсе, тайский тоже. Первый прогон отправил в noindex 100% страниц zh, ja и th —
// ложное срабатывание. Коэффициенты замерены на собственных переводах: столько
// символов приходится в этом языке на одно английское слово.
const CHARS_PER_WORD = { zh: 2.0, ja: 3.1, th: 6.7, ko: 2.6 };
const wordCount = (t, lang) => {
  const str = String(t || '').trim();
  if (!str) return 0;
  const k = CHARS_PER_WORD[lang];
  if (k) return Math.round(str.replace(/\s+/g, '').length / k);
  return str.split(/\s+/).filter(Boolean).length;
};
let thinCount = 0;

const PAGES_FILE = path.join(ROOT, 'data/pages.json');
const pagesRaw = fs.existsSync(PAGES_FILE) ? JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8')) : {};
const staticPages = Object.entries(pagesRaw)
  .filter(([k]) => !k.startsWith('_'))
  .map(([slug, p]) => ({ slug, ...p }))
  .sort((x, y) => (x.order || 0) - (y.order || 0));
const pageLabel = (slug, lang) => {
  const p = pagesRaw[slug];
  return p ? (p.title[lang] || p.title.en) : slug;
};
const adNotice = lang => (pagesRaw._adNotice || {})[lang] || (pagesRaw._adNotice || {}).en || '';
const moreLabel = lang => (pagesRaw._moreLabel || {})[lang] || (pagesRaw._moreLabel || {}).en || '';
// **жирный** -> <b>, остального markdown в этих текстах нет
const mdBold = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
console.log('pages: ' + staticPages.length + ' \u0441\u043b\u0443\u0436\u0435\u0431\u043d\u044b\u0445 \u0441\u0442\u0440\u0430\u043d\u0438\u0446 \u00d7 ' +
  (staticPages[0] ? Object.keys(staticPages[0].title).length : 0) + ' \u044f\u0437\u044b\u043a\u043e\u0432');

const TG_LABEL = { en: 'Our Telegram', uk: '\u041d\u0430\u0448 Telegram', ru: '\u041d\u0430\u0448 Telegram', es: 'Nuestro Telegram',
  pt: 'Nosso Telegram', de: 'Unser Telegram', fr: 'Notre Telegram', ar: '\u062a\u0644\u064a\u062c\u0631\u0627\u0645 \u0627\u0644\u062e\u0627\u0635 \u0628\u0646\u0627',
  zh: '\u6211\u4eec\u7684 Telegram', hi: '\u0939\u092e\u093e\u0930\u093e Telegram', id: 'Telegram Kami', vi: 'Telegram c\u1ee7a ch\u00fang t\u00f4i',
  tr: 'Telegram kanal\u0131m\u0131z', ja: '\u516c\u5f0f Telegram', ko: '\uacf5\uc2dd Telegram', pl: 'Nasz Telegram', th: 'Telegram \u0e02\u0e2d\u0e07\u0e40\u0e23\u0e32' };
const tgLabel = l => TG_LABEL[l] || TG_LABEL.en;

// \u041f\u043e\u0434\u043f\u0438\u0441\u044c \u0431\u043b\u043e\u043a\u0430 \u043f\u0435\u0440\u0435\u043b\u0438\u043d\u043a\u043e\u0432\u043a\u0438.
const RELATED_LABEL = { en: 'Worth reading', uk: '\u0412\u0430\u0440\u0442\u043e \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u0438', ru: '\u041f\u043e\u043b\u0435\u0437\u043d\u043e \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c',
  es: 'Vale la pena leer', pt: 'Vale a pena ler', de: 'Lesenswert', fr: '\u00c0 lire aussi',
  ar: '\u064a\u0633\u062a\u062d\u0642 \u0627\u0644\u0642\u0631\u0627\u0621\u0629', zh: '\u503c\u5f97\u4e00\u8bfb', hi: '\u092f\u0939 \u092d\u0940 \u092a\u0922\u093c\u0947\u0902',
  id: 'Layak dibaca', vi: '\u0110\u00e1ng \u0111\u1ecdc', tr: 'Okumaya de\u011fer', ja: '\u5408\u308f\u305b\u3066\u8aad\u307f\u305f\u3044',
  ko: '\ud568\uaed8 \uc77d\uae30', pl: 'Warto przeczyta\u0107', th: '\u0e19\u0e48\u0e32\u0e2d\u0e48\u0e32\u0e19' };
const rLabel = l => RELATED_LABEL[l] || RELATED_LABEL.en;

// \u0412\u044b\u0431\u043e\u0440 \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0445 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u043e\u0432 \u0434\u0435\u0442\u0435\u0440\u043c\u0438\u043d\u0438\u0440\u043e\u0432\u0430\u043d: \u0431\u0435\u0437 \u044d\u0442\u043e\u0433\u043e \u0432\u0441\u0435 \u0441\u0442\u0430\u0442\u044c\u0438
// \u0432\u0435\u043b\u0438 \u0431\u044b \u043d\u0430 \u043e\u0434\u0438\u043d \u0438 \u0442\u043e\u0442 \u0436\u0435 \u043f\u0435\u0440\u0432\u044b\u0439 \u0433\u0430\u0439\u0434, \u0430 \u0441\u043b\u0443\u0447\u0430\u0439\u043d\u044b\u0439 \u0432\u044b\u0431\u043e\u0440 \u043c\u0435\u043d\u044f\u043b \u0431\u044b \u0441\u0441\u044b\u043b\u043a\u0438 \u043d\u0430 \u043a\u0430\u0436\u0434\u043e\u0439
// \u0441\u0431\u043e\u0440\u043a\u0435 \u2014 \u0434\u043b\u044f \u043f\u043e\u0438\u0441\u043a\u0430 \u044d\u0442\u043e \u0448\u0443\u043c. \u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u043e\u0442 \u0441\u043b\u0430\u0433\u0430.
function seedFrom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function pickRelated(list, seedStr, n, excludeSlug) {
  const pool = list.filter(x => x.slug !== excludeSlug);
  if (!pool.length) return [];
  const start = seedFrom(seedStr) % pool.length;
  const out = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}
if (guides.length) console.log('guides: ' + guides.length + ' \u0433\u0430\u0439\u0434\u043e\u0432');

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
.art h2{font-size:clamp(1.1rem,3vw,1.35rem);font-weight:700;letter-spacing:-.01em;margin:26px 0 10px}
.art .upd{color:var(--muted);font-size:.85rem;margin-bottom:18px}
.related{margin:26px 0 4px;padding:14px 16px;border:1px solid #ffffff14;border-radius:14px;background:#ffffff08}
.related .rt{font-size:.82rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.related ul{margin:0;padding:0;list-style:none}
.related li{margin:6px 0}
.related a{color:var(--accent);font-weight:600;font-size:.98rem;line-height:1.4}
.tgbtn{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:999px;background:#229ED9;color:#fff;font-weight:700;font-size:.95rem;text-decoration:none}.socbtn{display:inline-flex;align-items:center;padding:9px 18px;border-radius:999px;border:1px solid #ffffff2e;background:#ffffff0f;color:#E8ECF4;font-weight:700;font-size:.95rem;text-decoration:none;margin-right:8px}
.tgbtn:hover{background:#1c8ac0}
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

function langLinks(pathFn, only) {
  // only — список языков, на которых страница РЕАЛЬНО существует.
  // Для новостей это все языки, для гайда — только его собственные.
  // hreflang на несуществующую страницу Google считает ошибкой.
  const list = (Array.isArray(only) && only.length) ? LANGS.filter(l => only.includes(l)) : LANGS;
  const def = list.includes('en') ? 'en' : list[0];
  return list.map(l => '<link rel="alternate" hreflang="' + l + '" href="' + ORIGIN + pathFn(l) + '">').join('\n  ')
    + '\n  <link rel="alternate" hreflang="x-default" href="' + ORIGIN + pathFn(def) + '">';
}

function page(opt) {
  const { lang, title, desc, pathFn, body, jsonld, hreflangs, robots } = opt;
  const L = i18n.languages[lang];
  return '<!DOCTYPE html>\n<html lang="' + lang + '" dir="' + L.dir + '">\n<head>\n' +
    '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n' +
    (robots ? '<meta name="robots" content="' + robots + '">\n' : '') +
    '<link rel="canonical" href="' + ORIGIN + pathFn(lang) + '">\n  ' + langLinks(pathFn, hreflangs) + '\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:type" content="website">\n<meta name="theme-color" content="#0b0e14">\n' +
    '<meta property="og:image" content="' + SITE_URL + '/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="' + SITE_URL + '/og.png">\n' +
    '<link rel="alternate" type="application/rss+xml" title="FinPulse RSS" href="' + BASE + '/' + lang + '/rss.xml">\n' +
    '<link rel="icon" type="image/png" sizes="32x32" href="' + BASE + '/favicon-32.png">\n<link rel="icon" type="image/png" sizes="192x192" href="' + BASE + '/favicon-192.png">\n<link rel="apple-touch-icon" href="' + BASE + '/apple-touch-icon.png">\n' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><text y=%27.9em%27 font-size=%2790%27>\\uD83D\\uDCC8</text></svg>">\n' +
    (jsonld ? '<script type="application/ld+json">' + JSON.stringify(jsonld) + '</script>\n' : '') +
    analyticsHead() +
    '<style>' + CSS + '</style>\n</head>\n<body>\n' +
    header(lang, pathFn, hreflangs) + '\n' + body + '\n' + footer(lang) +
    '\n<script>' + TICKER_JS + '</script>' + analyticsBody(lang) + '\n</body>\n</html>';
}

function header(lang, pathFn, only) {
  const L = i18n.languages[lang];
  // \u0415\u0441\u043b\u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0435\u0441\u0442\u044c \u043d\u0435 \u043d\u0430 \u0432\u0441\u0435\u0445 \u044f\u0437\u044b\u043a\u0430\u0445 (\u0433\u0430\u0439\u0434\u044b), \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c \u0432\u0435\u0434\u0451\u0442
  // \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e \u044d\u0442\u043e\u0433\u043e \u044f\u0437\u044b\u043a\u0430, \u0430 \u043d\u0435 \u0432 404.
  const has = l => !Array.isArray(only) || !only.length || only.includes(l);
  const menu = LANGS.map(l =>
    '<a href="' + (has(l) ? pathFn(l) : BASE + '/' + l + '/') + '" class="' + (l === lang ? 'cur' : '') + '" hreflang="' + l + '">' + i18n.languages[l].flag + ' ' + i18n.languages[l].name + '</a>').join('');
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
  const tg = tgFor(lang);
  return '<footer><div class="wrap">' +
    '<div><b>FinPulse</b> \u2014 ' + esc(S('tagline', lang)) + '</div>' +
    (tg ? '<div style="margin:14px 0"><a class="tgbtn" href="' + tg + '" target="_blank" rel="noopener">\u2708\uFE0F ' + esc(tgLabel(lang)) + '</a></div>' : '') +
    (socialLinks.length ? '<div style="margin:14px 0">' + socialLinks
      .map(x => '<a class="socbtn" href="' + x.url + '" target="_blank" rel="noopener">' + esc(x.label) + '</a>')
      .join(' ') + '</div>' : '') +
    (staticPages.length ? '<div style="margin:12px 0">' + staticPages
      .map(p => '<a href="' + BASE + '/' + lang + '/' + p.slug + '/">' + esc(pageLabel(p.slug, lang)) + '</a>')
      .join(' \u00b7 ') + '</div>' : '') +
    '<div class="langs">' + links + '</div>' +
    '<div>\u26A0\uFE0F ' + esc(S('riskDisclaimer', lang)) + '</div>' +
    '<div style="margin-top:8px">\u00A9 ' + new Date().getFullYear() + ' FinPulse</div>' +
    '</div></footer>';
}

// Раскрытие рядом с самими ссылками, а не только на отдельной странице:
// правила партнёрских сетей и законы ряда стран требуют, чтобы читатель видел
// пометку там, где он принимает решение о переходе.
function adDisclosure(lang) {
  if (!adNotice(lang)) return '';
  return '<p class="addisc" style="font-size:13px;opacity:.75;margin:0 0 10px">' +
    esc(adNotice(lang)) + ' <a href="' + BASE + '/' + lang + '/disclosure/">' +
    esc(moreLabel(lang)) + '</a></p>';
}

function offerCard(o, lang, top) {
  return '<div class="offer">' + (top ? '<div class="tbadge">TOP</div>' : '') +
    '<div class="offer-top"><div class="olog" style="background:' + o.color + '">' + o.logo + '</div>' +
    '<div><div class="oname">' + o.name + '</div><div class="meta">' + esc(S('categories.' + (o.type === 'forex' ? 'forex' : 'crypto'), lang)) + '</div></div>' +
    '<div class="orate">\u2605 ' + o.rating + '</div></div>' +
    '<div class="obonus">\uD83C\uDF81 ' + esc(o.bonus[lang] || o.bonus.en) + '</div>' +
    '<ul class="ofeat">' + (o.features[lang] || o.features.en).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
    '<a class="cta" data-offer="' + esc(o.id) + '" href="' + o.url + '" rel="nofollow sponsored noopener" target="_blank">' + esc(S('startTrading', lang)) + ' \u2192</a>' +
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

function guideCard(g, lang) {
  const t = g.i18n[lang] || g.i18n.en;
  return '<a class="card" href="' + BASE + '/' + lang + '/guide/' + g.slug + '/" style="background:linear-gradient(135deg,#22d3ee18,#818cf818),var(--card)">' +
    '<div class="em">' + g.emoji + '</div>' +
    '<div class="meta"><span class="chip">' + esc(gLabel(lang)) + '</span></div>' +
    '<h3>' + esc(t.title) + '</h3><p>' + esc(t.excerpt) + '</p>' +
    '<span class="more">' + esc(S('readMore', lang)) + ' \u2192</span>' +
    '</a>';
}

function relatedBlock(items, lang) {
  if (!items.length) return '';
  return '<aside class="related"><div class="rt">\uD83D\uDCD8 ' + esc(rLabel(lang)) + '</div><ul>' +
    items.map(g => {
      const t = g.i18n[lang] || g.i18n.en;
      return '<li><a href="' + BASE + '/' + lang + '/guide/' + g.slug + '/">' + esc(t.title) + '</a></li>';
    }).join('') + '</ul></aside>';
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const urls = [];        // новости и витрины — changefreq hourly
const slowUrls = [];    // вечнозелёные гайды — changefreq monthly

for (const lang of LANGS) {
  const pathHome = l => BASE + '/' + l + '/';
  const home = page({
    lang,
    title: 'FinPulse \u2014 ' + S('tagline', lang),
    desc: S('tagline', lang),
    pathFn: pathHome,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'FinPulse', url: SITE_URL + '/' + lang + '/',
          inLanguage: lang, publisher: { '@id': SITE_URL + '/#org' } },
        // sameAs связывает сайт и каналы в один бренд — без этого Google
        // считает их несвязанными и не переносит доверие с одного на другой.
        { '@type': 'Organization', '@id': SITE_URL + '/#org', name: 'FinPulse',
          url: SITE_URL + '/', logo: SITE_URL + '/logo-512.png',
          sameAs: [...Object.values(tgChannels), ...socialLinks.map(x => x.url)] }
      ]
    },
    body: '<main class="wrap">' +
      '<section class="hero"><div class="badge"><span class="pulse"></span>' + esc(S('updatedEvery', lang)) + '</div>' +
      '<h1>' + esc(S('tagline', lang)) + '</h1></section>' +
      '<h2 class="sec" id="offers">\uD83C\uDFC6 ' + esc(S('topPlatforms', lang)) + '</h2>' +
      adDisclosure(lang) +
      '<div class="offers">' + forLang(offers, lang).map((o, i) => offerCard(o, lang, i === 0)).join('') + '</div>' +
      (guidesFor(lang).length
        ? '<h2 class="sec">\uD83D\uDCD8 ' + esc(gLabel(lang)) + '</h2>' +
          '<div class="grid">' + guidesFor(lang).slice(0, 6).map(g => guideCard(g, lang)).join('') + '</div>' +
          (guidesFor(lang).length > 6
            ? '<p style="margin:14px 0"><a class="cta" style="max-width:340px;margin:0 auto" href="' + BASE + '/' + lang + '/guides/">' + esc(gLabel(lang)) + ' \u2192</a></p>'
            : '')
        : '') +
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
    const thin = NEWS_MIN_WORDS > 0 && wordCount((t.body || []).join(' '), lang) < NEWS_MIN_WORDS;
    if (thin) thinCount++;
    const artHtml = page({
      lang,
      robots: thin ? 'noindex,follow' : undefined,
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
        relatedBlock(pickRelated(guidesFor(lang), a.slug, 2), lang) +
        '<div class="strip">' + topOffers.map(o => offerCard(o, lang)).join('') + '</div>' +
        '</main>' +
        (topOffers.length
          ? adDisclosure(lang) + '<div class="mcta"><div class="t">\uD83C\uDF81 ' + esc(topOffers[0].bonus[lang] || topOffers[0].bonus.en) + '</div><a class="cta" data-offer="' + esc(topOffers[0].id) + '" href="' + topOffers[0].url + '" rel="nofollow sponsored noopener" target="_blank">' + esc(S('startTrading', lang)) + '</a></div>'
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
    if (!thin) urls.push(pf(lang));   // тонкую страницу не зовём в индекс и сами
  }

  // ---- \u0412\u0435\u0447\u043d\u043e\u0437\u0435\u043b\u0451\u043d\u044b\u0435 \u0433\u0430\u0439\u0434\u044b ----
  const langGuides = guidesFor(lang);
  if (langGuides.length) {
    const gIdxPath = l => BASE + '/' + l + '/guides/';
    const guidesIdxLangs = LANGS.filter(l => guidesFor(l).length);
    const gIdxHtml = page({
      lang,
      hreflangs: guidesIdxLangs,
      title: gLabel(lang) + ' \u2014 FinPulse',
      desc: gLabel(lang) + ' \u2014 FinPulse',
      pathFn: gIdxPath,
      body: '<main class="wrap">' +
        '<section class="hero"><h1>\uD83D\uDCD8 ' + esc(gLabel(lang)) + '</h1></section>' +
        '<div class="grid">' + langGuides.map(g => guideCard(g, lang)).join('') + '</div>' +
        '</main>'
    });
    fs.mkdirSync(path.join(DIST, lang, 'guides'), { recursive: true });
    fs.writeFileSync(path.join(DIST, lang, 'guides', 'index.html'), gIdxHtml);
    slowUrls.push(gIdxPath(lang));
  }

  // ---- Служебные страницы ----
  for (const p of staticPages) {
    const pPath = l => BASE + '/' + l + '/' + p.slug + '/';
    const title = p.title[lang] || p.title.en;
    const body = p.body[lang] || p.body.en;
    const html = page({
      lang,
      title: title + ' \u2014 FinPulse',
      desc: String(body[0] || title).replace(/\*\*/g, '').slice(0, 155),
      pathFn: pPath,
      jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: title, inLanguage: lang,
        publisher: { '@type': 'Organization', name: 'FinPulse', url: ORIGIN + '/' } },
      body: '<main class="wrap">' +
        '<section class="hero"><h1>' + esc(p.emoji || '') + ' ' + esc(title) + '</h1></section>' +
        '<article class="art">' + body.map(t => '<p>' + mdBold(t) + '</p>').join('') + '</article>' +
        '</main>'
    });
    const dir = path.join(DIST, lang, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    slowUrls.push(pPath(lang));

    for (const g of langGuides) {
      const t = g.i18n[lang] || g.i18n.en;
      const gf = l => BASE + '/' + l + '/guide/' + g.slug + '/';
      const topOffers = forLang(articleOffers, lang).slice(0, 2);
      const upd = g.updated ? new Date(g.updated).toLocaleDateString(i18n.languages[lang].locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const gHtml = page({
        lang,
        hreflangs: g.langs,
        title: t.title + ' \u2014 FinPulse',
        desc: t.excerpt,
        pathFn: gf,
        jsonld: {
          '@context': 'https://schema.org', '@type': 'Article', headline: t.title,
          description: t.excerpt, inLanguage: lang,
          dateModified: g.updated || undefined,
          author: { '@type': 'Organization', name: 'FinPulse', url: ORIGIN + BASE + '/' + lang + '/about/' },
          publisher: { '@type': 'Organization', name: 'FinPulse', url: ORIGIN + BASE + '/' + lang + '/' }
        },
        body: '<main class="art">' +
          '<a class="backlink" href="' + BASE + '/' + lang + '/guides/">\u2190 ' + esc(gLabel(lang)) + '</a>' +
          '<div class="meta" style="margin-top:14px"><span class="chip">' + esc(gLabel(lang)) + '</span></div>' +
          '<h1>' + g.emoji + ' ' + esc(t.title) + '</h1>' +
          '<p class="lede">' + esc(t.excerpt) + '</p>' +
          (upd ? '<div class="upd">' + esc(upd) + '</div>' : '') +
          (t.sections || []).map(sec =>
            '<h2>' + esc(sec.h) + '</h2>' + (sec.p || []).map(x => '<p>' + esc(x) + '</p>').join('')
          ).join('') +
          relatedBlock(pickRelated(langGuides, g.slug, 2, g.slug), lang) +
          '<p style="margin-top:18px"><a class="backlink" href="' + BASE + '/' + lang + '/news/">' + esc(S('allNews', lang)) + ' \u2192</a></p>' +
          '<div class="strip">' + topOffers.map(o => offerCard(o, lang)).join('') + '</div>' +
          '</main>' +
          (topOffers.length
            ? adDisclosure(lang) + '<div class="mcta"><div class="t">\uD83C\uDF81 ' + esc(topOffers[0].bonus[lang] || topOffers[0].bonus.en) + '</div><a class="cta" data-offer="' + esc(topOffers[0].id) + '" href="' + topOffers[0].url + '" rel="nofollow sponsored noopener" target="_blank">' + esc(S('startTrading', lang)) + '</a></div>'
            : '')
      });
      // \u0422\u0430 \u0436\u0435 \u0441\u0442\u0440\u0430\u0445\u043e\u0432\u043a\u0430, \u0447\u0442\u043e \u0438 \u0434\u043b\u044f \u0441\u0442\u0430\u0442\u0435\u0439: \u0433\u0430\u0439\u0434 \u2014 \u044d\u0442\u043e \u043a\u043e\u043d\u0442\u0435\u043d\u0442, \u0430 \u043d\u0435 \u0432\u0438\u0442\u0440\u0438\u043d\u0430.
      for (const badUrl of forbiddenInArticles) {
        if (gHtml.includes(badUrl)) {
          throw new Error('\u041d\u0410\u0420\u0423\u0428\u0415\u041d\u0418\u0415 \u0422\u0418\u041f\u0410 \u0422\u0420\u0410\u0424\u0418\u041a\u0410: \u043e\u0444\u0444\u0435\u0440 \u0441\u043e \u0441\u0441\u044b\u043b\u043a\u043e\u0439 ' + badUrl +
            ' \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043d \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0432\u0438\u0442\u0440\u0438\u043d, \u043d\u043e \u043f\u043e\u043f\u0430\u043b \u0432 \u0433\u0430\u0439\u0434 ' + lang + '/' + g.slug + '.');
        }
      }

      const gdir = path.join(DIST, lang, 'guide', g.slug);
      fs.mkdirSync(gdir, { recursive: true });
      fs.writeFileSync(path.join(gdir, 'index.html'), gHtml);
      slowUrls.push(gf(lang));
    }
  }
}

fs.writeFileSync(path.join(DIST, 'index.html'),
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FinPulse</title>' +
  '<script>var l=(navigator.language||"en").slice(0,2);var s=' + JSON.stringify(LANGS) + ';location.replace("' + BASE + '/"+(s.indexOf(l)>-1?l:"en")+"/");</script>' +
  '<meta http-equiv="refresh" content="1;url=' + BASE + '/en/"></head><body></body></html>');

// CNAME обязателен, когда Pages публикуется из артефакта: без файла в самом
// артефакте кастомный домен держится только на настройке репозитория и слетает
// при первом же деплое, который её не подтвердил. Домен берём из SITE_URL —
// одна точка правды, менять в двух местах не нужно.
{
  const host = SITE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host && !/example\.com$/.test(host) && !/(^|\.)github\.io$/.test(host)) {
    fs.writeFileSync(path.join(DIST, 'CNAME'), host + '\n');
    console.log('CNAME: ' + host);
  }
}

fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => '<url><loc>' + ORIGIN + u + '</loc><changefreq>hourly</changefreq></url>')
    .concat(slowUrls.map(u => '<url><loc>' + ORIGIN + u + '</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>'))
    .join('\n') + '\n</urlset>');
if (NEWS_MIN_WORDS > 0) console.log('news: ' + thinCount + ' \u0442\u043e\u043d\u043a\u0438\u0445 \u0441\u0442\u0440\u0430\u043d\u0438\u0446 (<' + NEWS_MIN_WORDS + ' \u0441\u043b\u043e\u0432) \u2014 noindex \u0438 \u0432\u043d\u0435 sitemap');
fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

// ---- RSS на каждом языке ----
// Без фида сайт невидим для агрегаторов, читалок и автопостинг-сервисов —
// то есть для целого класса площадок, куда контент попадает без нашего участия.
const rssEsc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let rssCount = 0;
for (const lang of LANGS) {
  const items = articles.slice(0, 30).map(a => {
    const t = a.i18n[lang] || a.i18n.en;
    const url = SITE_URL + '/' + lang + '/news/' + a.slug + '/';
    return '<item>' +
      '<title>' + rssEsc(t.title) + '</title>' +
      '<link>' + url + '</link>' +
      '<guid isPermaLink="true">' + url + '</guid>' +
      '<pubDate>' + new Date(a.date).toUTCString() + '</pubDate>' +
      '<description>' + rssEsc(t.excerpt) + '</description>' +
      '</item>';
  }).join('\n');
  const feed = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
    '<title>FinPulse \u2014 ' + rssEsc(S('tagline', lang)) + '</title>' +
    '<link>' + SITE_URL + '/' + lang + '/</link>' +
    '<description>' + rssEsc(S('tagline', lang)) + '</description>' +
    '<language>' + lang + '</language>' +
    '<atom:link href="' + SITE_URL + '/' + lang + '/rss.xml" rel="self" type="application/rss+xml"/>' +
    '\n' + items + '\n</channel></rss>';
  fs.writeFileSync(path.join(DIST, lang, 'rss.xml'), feed);
  rssCount++;
}
console.log('rss: ' + rssCount + ' \u0444\u0438\u0434\u043e\u0432');

console.log('Built ' + (urls.length + slowUrls.length) + ' pages for ' + LANGS.length + ' languages -> dist/ (\u0438\u0437 \u043d\u0438\u0445 \u0433\u0430\u0439\u0434\u043e\u0432\u044b\u0445: ' + slowUrls.length + ')');

// IndexNow key file
fs.writeFileSync(path.join(DIST, 'ee221c0a3d35f01be5577688fa06a50a.txt'), 'ee221c0a3d35f01be5577688fa06a50a');

// media/ -> dist/media/ (ролики для TikTok: Studio берёт их fetch'ем со страницы)
const MEDIA = path.join(__dirname, 'media');
if (fs.existsSync(MEDIA)) {
  fs.mkdirSync(path.join(DIST, 'media'), { recursive: true });
  for (const f of fs.readdirSync(MEDIA)) fs.copyFileSync(path.join(MEDIA, f), path.join(DIST, 'media', f));
}

// Brand assets -> dist
for (const f of ['og.png','favicon-32.png','favicon-192.png','apple-touch-icon.png','logo-512.png','logo-text-512.png','logo-animated.svg']) {
  const src = path.join(__dirname, 'brand', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
}
