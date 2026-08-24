#!/usr/bin/env node
/**
 * FinPulse -> Telegram. Постит свежие статьи и новые вечнозелёные гайды
 * в КАЖДЫЙ канал на его собственном языке.
 *
 * Карта каналов — data/telegram-channels.json (язык -> "@username" или {chat:"-100...", link:"https://t.me/+..."}).
 * Она лежит в репозитории, а не в секретах: имена публичных каналов не секрет,
 * зато их можно править без доступа к настройкам GitHub. Секрет только токен бота.
 *
 * Учёт опубликованного — content/tg-posted.json, ПОФАЙЛОВО НА КАЖДЫЙ ЯЗЫК:
 *   { "ru": ["slug", ...], "tr": [...], "guides": { "ru": ["slug"], ... } }
 * Старый плоский формат (массив слагов от одноканальной версии) автоматически
 * переносится в ключ языка TG_LANG, чтобы не перепостить в основной канал всё заново.
 *
 * Env: TELEGRAM_BOT_TOKEN (обязателен), SITE_URL, TG_MAX_POSTS (по умолчанию 2),
 *      TG_LANG (язык, куда мигрирует старая история; по умолчанию 'ru'),
 *      TELEGRAM_CHAT_ID — необязательный запасной канал, если файла карты нет.
 *
 * Проверка без публикации:  node scripts/telegram.js --check
 *   Спрашивает у Telegram статус каждого канала и прав бота. Ничего не постит.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE_FILE = path.join(ROOT, 'data/site.json');
const SITE = String((fs.existsSync(SITE_FILE) ? JSON.parse(fs.readFileSync(SITE_FILE,'utf8')).url : '')
  || process.env.SITE_URL || 'https://finpulse24.com').replace(/\/$/, '');
const MAX_POSTS = Number(process.env.TG_MAX_POSTS || 2);
const LEGACY_LANG = process.env.TG_LANG || 'ru';
const CHECK_ONLY = process.argv.includes('--check');

const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/i18n.json'), 'utf8'));
const readMore = l => (i18n.strings.readMore[l] || i18n.strings.readMore.en);

function loadChannels() {
  const f = path.join(ROOT, 'data/telegram-channels.json');
  const map = {};
  if (fs.existsSync(f)) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [lang, chat] of Object.entries(raw)) {
      if (lang.startsWith('_')) continue;                 // комментарии в файле
      if (!i18n.languages[lang]) { console.warn('tg: язык ' + lang + ' не существует на сайте — пропускаю'); continue; }
      // Публичный канал — строка "@username"; приватный — {chat:"-100...", link:"..."}.
      const id = (chat && typeof chat === 'object') ? chat.chat : chat;
      if (!id) { console.warn('tg: у языка ' + lang + ' нет chat id — пропускаю'); continue; }
      map[lang] = String(id);
    }
  }
  if (!Object.keys(map).length && process.env.TELEGRAM_CHAT_ID) {
    map[LEGACY_LANG] = process.env.TELEGRAM_CHAT_ID;      // поведение старой версии
  }
  return map;
}

const postedFile = path.join(ROOT, 'content/tg-posted.json');
function loadPosted() {
  if (!fs.existsSync(postedFile)) return { guides: {} };
  const raw = JSON.parse(fs.readFileSync(postedFile, 'utf8'));
  if (Array.isArray(raw)) {                               // миграция со старого формата
    console.log('tg: старая история (' + raw.length + ' слагов) перенесена в язык ' + LEGACY_LANG);
    return { [LEGACY_LANG]: raw, guides: {} };
  }
  if (!raw.guides) raw.guides = {};
  return raw;
}

async function tg(method, body) {
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

async function checkChannels(channels) {
  console.log('Проверка каналов (публикации не будет):');
  let bad = 0;
  for (const [lang, chat] of Object.entries(channels)) {
    const j = await tg('getChat', { chat_id: chat });
    if (!j.ok) { console.log('  ' + lang + ' ' + chat + ' — НЕДОСТУПЕН: ' + (j.description || '?')); bad++; continue; }
    const me = await tg('getChatMember', { chat_id: chat, user_id: (await tg('getMe')).result.id });
    const st = me.ok ? me.result.status : '?';
    const canPost = me.ok && (me.result.can_post_messages === true || st === 'creator');
    console.log('  ' + lang + ' ' + chat + ' — ok, бот: ' + st + (canPost ? ', может публиковать' : ', ПУБЛИКОВАТЬ НЕ МОЖЕТ'));
    if (!canPost) bad++;
  }
  console.log(bad ? bad + ' канал(ов) требуют внимания' : 'Все каналы готовы');
}

// Проверка живости сайта: две попытки, любой ответ сервера считается «жив»
// (даже 404 на главной означает, что домен резолвится и хост отвечает).
// Ловим именно недоступность домена, а не код ответа.
async function siteAlive() {
  if (process.env.TG_SKIP_SITE_CHECK === '1') return true;
  for (let i = 0; i < 2; i++) {
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 10000);
      const r = await fetch(SITE + '/', { redirect: 'manual', signal: c.signal });
      clearTimeout(timer);
      if (r.status > 0) return true;
    } catch (e) {
      if (i === 0) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return false;
}

(async () => {
  if (!TOKEN) { console.log('TELEGRAM_BOT_TOKEN не задан — пропускаю'); return; }
  const channels = loadChannels();
  if (!Object.keys(channels).length) { console.log('tg: каналов не настроено — пропускаю'); return; }

  if (CHECK_ONLY) return checkChannels(channels);

  // Предохранитель. 24.08.2026 DNS-зона домена отвалилась вместе с хостингом,
  // сайт лёг, а автопостинг продолжал бы рассылать ссылки в 10 каналов —
  // подписчик получает битую ссылку, RSS-читалки кэшируют 404, доверие тратится зря.
  // Дешевле пропустить прогон, чем разослать мусор: новости никуда не денутся.
  if (!(await siteAlive())) {
    console.log('tg: ' + SITE + ' не отвечает — пропускаю прогон, чтобы не рассылать битые ссылки');
    return;
  }

  const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'));
  const guidesFile = path.join(ROOT, 'content/guides.json');
  const guides = fs.existsSync(guidesFile) ? JSON.parse(fs.readFileSync(guidesFile, 'utf8')) : [];
  const posted = loadPosted();

  let total = 0;
  for (const [lang, chat] of Object.entries(channels)) {
    const seen = posted[lang] || (posted[lang] = []);
    const seenG = posted.guides[lang] || (posted.guides[lang] = []);

    // Гайд важнее новости: он вечнозелёный и ведёт на страницу, где конвертят ссылки.
    // Поэтому сначала неопубликованные гайды этого языка, потом свежие новости.
    const queue = [];
    for (const g of guides) {
      if (!Array.isArray(g.langs) || !g.langs.includes(lang)) continue;
      if (seenG.includes(g.slug)) continue;
      const t = g.i18n[lang]; if (!t) continue;
      queue.push({ kind: 'guide', slug: g.slug, emoji: g.emoji || '📘', t, url: SITE + '/' + lang + '/guide/' + g.slug + '/' });
    }
    for (const a of articles) {
      if (seen.includes(a.slug)) continue;
      const t = a.i18n[lang] || a.i18n.en;
      queue.push({ kind: 'news', slug: a.slug, emoji: a.emoji, t, url: SITE + '/' + lang + '/news/' + a.slug + '/' });
    }

    const batch = queue.slice(0, MAX_POSTS).reverse();
    if (!batch.length) { console.log('tg ' + lang + ': нечего постить'); continue; }

    for (const item of batch) {
      const text = item.emoji + ' <b>' + item.t.title + '</b>\n\n' + item.t.excerpt +
        '\n\n<a href="' + item.url + '">' + readMore(lang) + ' →</a>';
      const j = await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: false });
      if (j.ok) {
        (item.kind === 'guide' ? seenG : seen).push(item.slug);
        total++;
        console.log('tg ' + lang + ': ' + item.kind + ' ' + item.slug);
      } else {
        // Один сломанный канал не должен ронять остальные шесть.
        console.error('tg ' + lang + ' ОШИБКА (' + chat + '): ' + (j.description || JSON.stringify(j)));
        break;
      }
      await new Promise(res => setTimeout(res, 1500));
    }
  }

  for (const k of Object.keys(posted)) {
    if (k === 'guides') continue;
    posted[k] = posted[k].slice(-200);
  }
  fs.writeFileSync(postedFile, JSON.stringify(posted, null, 1) + '\n');
  console.log('tg: опубликовано ' + total + ' сообщени(й) в ' + Object.keys(channels).length + ' канал(ов)');
})().catch(e => { console.error(e); process.exit(0); });
