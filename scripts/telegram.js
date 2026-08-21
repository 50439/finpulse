#!/usr/bin/env node
/**
 * Posts fresh FinPulse articles to a Telegram channel.
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (e.g. @finpulse24), optional TG_LANG (default 'ru'), SITE_URL
 * Tracks posted slugs in content/tg-posted.json (committed by workflow).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const LANG = process.env.TG_LANG || 'ru';
const SITE = (process.env.SITE_URL || 'https://finpulse24.com').replace(/\/$/, '');
if (!TOKEN || !CHAT) { console.log('Telegram secrets not set - skipping'); process.exit(0); }

const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'));
const postedFile = path.join(ROOT, 'content/tg-posted.json');
const posted = fs.existsSync(postedFile) ? JSON.parse(fs.readFileSync(postedFile, 'utf8')) : [];
const fresh = articles.filter(a => !posted.includes(a.slug)).slice(0, 3).reverse();

(async () => {
  for (const a of fresh) {
    const t = a.i18n[LANG] || a.i18n.en;
    const url = SITE + '/' + LANG + '/news/' + a.slug + '/';
    const text = a.emoji + ' <b>' + t.title + '</b>\n\n' + t.excerpt + '\n\n<a href="' + url + '">Читать полностью →</a>';
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: false })
    });
    const j = await r.json();
    if (j.ok) { posted.push(a.slug); console.log('posted:', a.slug); }
    else console.error('telegram error:', JSON.stringify(j));
    await new Promise(res => setTimeout(res, 1500));
  }
  fs.writeFileSync(postedFile, JSON.stringify(posted.slice(-200), null, 1));
})().catch(e => { console.error(e); process.exit(0); });
