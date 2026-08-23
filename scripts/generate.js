#!/usr/bin/env node
/**
 * FinPulse content engine.
 * 1. Pulls fresh headlines from RSS feeds (crypto, stocks, world, forex, Ukraine)
 * 2. Asks Anthropic API to pick top stories, write unique articles and translate to 17 languages
 * 3. Appends to content/articles.json (keeps last 60 articles)
 * Requires: ANTHROPIC_API_KEY env var. Run: node scripts/generate.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_KEY = process.env.ANTHROPIC_API_KEY;

const LANGS = ['en','uk','ru','es','pt','de','fr','ar','zh','hi','id','vi','tr','ja','ko','pl','th'];
const FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  { url: 'https://cointelegraph.com/rss', category: 'crypto' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'stocks' },
  { url: 'https://www.investing.com/rss/news_1.rss', category: 'forex' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'world' },
  { url: 'https://www.epravda.com.ua/rss/', category: 'ukraine' }
];

// --- Дедупликация -------------------------------------------------------
// Проблема, которую это чинит: раньше единственной защитой от повторов была
// просьба к модели «пропусти похожее». Модель обязана была вернуть ровно 2 статьи,
// поэтому при отсутствии свежих новостей она переписывала уже опубликованное
// другими словами. Слаг получал уникальный суффикс от Date.now(), так что даже
// дословный повтор считался новой статьёй. Итог: ~40% ленты — дубли.
const STOP = new Set(('the a an and or of to in on for as at by with from after over into amid ahead ' +
  'its his her their new says say said is are was were be been has have had this that these those ' +
  'up down out off more most than then when while about against between during without within ' +
  'first last major key top big news report reports').split(' '));

function keywords(title) {
  const out = new Set();
  for (let w of String(title).toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/)) {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w || STOP.has(w)) continue;
    if (w.length >= 4 || /\d/.test(w)) out.add(w);
  }
  return out;
}

// Мера Жаккара по значимым словам заголовка.
// Порог подобран на реальных данных прода (31 статья, 465 пар):
// настоящие дубли дали 0.45-0.70, разные новости — не выше 0.25. Берём 0.40 с запасом.
function titleSimilarity(a, b) {
  const A = keywords(a), B = keywords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const DUP_THRESHOLD = Number(process.env.DUP_THRESHOLD || 0.40);

// Сколько статей писать за прогон. Снижено 2 -> 1 на месяц (23.08.2026):
// сайт молодой, без ссылочной массы, а 17 языковых версий каждой статьи дают
// до 100 новых страниц в сутки — это профиль, который Google разбирает
// по политике scaled content abuse. Возвращать обратно через env, без правки кода.
const ARTICLES_PER_RUN = Number(process.env.ARTICLES_PER_RUN || 1);
// Слаг у нас всегда получает суффикс -xxxx, поэтому сравниваем базовую часть.
const slugBase = s => String(s).toLowerCase().replace(/-[a-z0-9]{4}$/, '');

function parseRss(xml, category) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 8) {
    const block = m[1];
    const pick = tag => {
      const r = new RegExp('<' + tag + '[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/' + tag + '>').exec(block);
      return r ? r[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    items.push({ title: pick('title'), desc: pick('description').slice(0, 400), date: pick('pubDate'), category });
  }
  return items;
}

async function fetchFeeds() {
  const all = [];
  for (const f of FEEDS) {
    try {
      const r = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 FinPulseBot' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) { all.push(...parseRss(await r.text(), f.category)); console.log('feed ok:', f.url); }
      else console.warn('feed http ' + r.status + ':', f.url);
    } catch (e) { console.warn('feed failed:', f.url, e.message); }
  }
  return all;
}

async function callClaude(headlines) {
  const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'));
  const recentTitles = existing.slice(0, 30).map(a => a.i18n.en.title);
  const prompt = 'You are the editor of FinPulse, a multilingual crypto & finance news site.\n\n' +
'Below are fresh headlines from RSS feeds. Pick UP TO ' + ARTICLES_PER_RUN + ' genuinely NEW and DISTINCT stor' + (ARTICLES_PER_RUN === 1 ? 'y' : 'ies') + ' (prefer variety across runs: crypto, stocks/world economy, and if present something about Ukraine economy). Choose the single most consequential story, not the most sensational one.\n\n' +
'WE ALREADY PUBLISHED THESE STORIES: ' + JSON.stringify(recentTitles) + '\n\n' +
'A story counts as ALREADY COVERED if it is the same event, the same company/country, or the same figures as anything above — even if the wording, angle or framing differs. Only a genuinely NEW development (new decision, new number, new consequence) counts as a new story.\n\n' +
'IMPORTANT: you are NOT required to return 2 articles. Return 1, or an empty array [], if there is nothing genuinely new. Publishing nothing is BETTER than republishing a story we already covered — repeats destroy reader trust. Do not stretch to fill a quota.\n\n' +
'For each story write an ORIGINAL article (do not copy source text): a catchy title, a 1-2 sentence excerpt, and a body of 6-8 paragraphs totalling 450-600 words in English.\n\n' +
'DEPTH MATTERS MORE THAN SPEED. Our earlier articles averaged only ~190 words and read as thin rewrites of a headline — that is exactly what search engines discard. Each article must add something a reader cannot get from the headline alone: what actually happened, the concrete numbers, why it matters, who is affected, what it changes for an ordinary investor, and what to watch next. Explain mechanisms, not just events. No filler sentences, no restating the title, no empty hedging.\n\n' +
'Then translate title, excerpt and body into ALL of: en, uk, ru, es, pt, de, fr, ar, zh, hi, id, vi, tr, ja, ko, pl, th. Native-quality natural translations — a native reader must not be able to tell it was translated.\n\n' +
'Category must be one of: crypto, stocks, forex, world, ukraine. Pick a fitting emoji for each article.\n\n' +
'Respond with ONLY valid JSON (no markdown fences), an array of 0 to ' + ARTICLES_PER_RUN + ' objects (empty array [] is a valid and welcome answer):\n' +
'[{"slug":"kebab-case-slug","category":"crypto","emoji":"X","i18n":{"en":{"title":"...","excerpt":"...","body":["p1","p2","p3","p4","p5","p6"]}, ...all 17 langs}}]\n\n' +
'HEADLINES:\n' + JSON.stringify(headlines.slice(0, 40), null, 1);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 64000,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) throw new Error('Anthropic API ' + r.status + ': ' + await r.text());
  // Parse SSE stream (avoids headers timeout on long generations)
  let text = '';
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) text += ev.delta.text;
        if (ev.type === 'error') throw new Error('Stream error: ' + JSON.stringify(ev.error));
      } catch (e) { if (String(e).includes('Stream error')) throw e; }
    }
  }
  console.log('Received ' + text.length + ' chars from Claude');
  text = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(text);
}

async function main() {
  if (!API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }
  const headlines = await fetchFeeds();
  if (!headlines.length) { console.error('No headlines fetched'); process.exit(1); }
  console.log('Fetched', headlines.length, 'headlines. Generating articles...');
  const fresh = await callClaude(headlines);

  const file = path.join(ROOT, 'content/articles.json');
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Date().toISOString();
  const gradients = {
    crypto: 'linear-gradient(135deg,#f7931a33,#0b0e1400)',
    stocks: 'linear-gradient(135deg,#34d39933,#0b0e1400)',
    forex: 'linear-gradient(135deg,#818cf833,#0b0e1400)',
    world: 'linear-gradient(135deg,#3b82f633,#0b0e1400)',
    ukraine: 'linear-gradient(135deg,#facc1533,#0b0e1400)'
  };
  // --- Жёсткая отбраковка дублей -----------------------------------------
  // Модель может ошибиться или переписать старую новость другими словами —
  // здесь это ловится механически, до записи в ленту.
  const existingTitles = existing.map(a => (a.i18n && a.i18n.en && a.i18n.en.title) || '').filter(Boolean);
  const existingSlugs = new Set(existing.map(a => slugBase(a.slug)));
  const accepted = [];
  let rejected = 0;

  for (const a of fresh) {
    const title = a.i18n && a.i18n.en && a.i18n.en.title;
    if (!title) { console.warn('SKIP: статья без английского заголовка'); rejected++; continue; }

    const rawSlug = String(a.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);
    if (existingSlugs.has(slugBase(rawSlug))) {
      console.warn('ДУБЛЬ (слаг): ' + title);
      rejected++; continue;
    }

    let dupTitle = null, dupScore = 0;
    for (const t of existingTitles.concat(accepted.map(x => x.i18n.en.title))) {
      const sim = titleSimilarity(title, t);
      if (sim >= DUP_THRESHOLD && sim > dupScore) { dupScore = sim; dupTitle = t; }
    }
    if (dupTitle) {
      console.warn('ДУБЛЬ (' + dupScore.toFixed(2) + '): "' + title + '"  ~  "' + dupTitle + '"');
      rejected++; continue;
    }

    a._rawSlug = rawSlug;
    accepted.push(a);
  }

  if (accepted.length > ARTICLES_PER_RUN) {
    console.log('Модель вернула ' + accepted.length + ', оставляем ' + ARTICLES_PER_RUN + ' (лимит ARTICLES_PER_RUN)');
    accepted.length = ARTICLES_PER_RUN;
  }
  if (rejected) console.log('Отброшено дублей: ' + rejected + ' из ' + fresh.length);

  if (!accepted.length) {
    console.log('Свежих новостей нет — ничего не публикуем. Это нормально: повтор хуже паузы.');
    return;
  }

  accepted.forEach((a, i) => {
    for (const l of LANGS) if (!a.i18n[l]) a.i18n[l] = a.i18n.en;
    a.date = now;
    a.gradient = gradients[a.category] || gradients.world;
    a.slug = a._rawSlug + '-' + (Date.now() + i).toString(36).slice(-4);
    delete a._rawSlug;
  });

  // Лимит ленты. Раньше было 60: при 8 статьях в сутки страницы старше недели
  // выпадали из articles.json, их URL начинали отдавать 404, хотя уже были
  // в sitemap и в индексе Google. 200 — это несколько недель истории;
  // сборка 3400 страниц занимает считаные секунды.
  const KEEP = Number(process.env.KEEP_ARTICLES || 200);
  const merged = [...accepted, ...existing].slice(0, KEEP);
  fs.writeFileSync(file, JSON.stringify(merged, null, 1));
  console.log('Добавлено статей: ' + accepted.length + '. Всего в ленте: ' + merged.length);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { keywords, titleSimilarity, slugBase, DUP_THRESHOLD };
