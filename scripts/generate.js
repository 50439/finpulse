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
if (!API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }

const LANGS = ['en','uk','ru','es','pt','de','fr','ar','zh','hi','id','vi','tr','ja','ko','pl','th'];
const FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  { url: 'https://cointelegraph.com/rss', category: 'crypto' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'stocks' },
  { url: 'https://www.investing.com/rss/news_1.rss', category: 'forex' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'world' },
  { url: 'https://www.epravda.com.ua/rss/', category: 'ukraine' }
];

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
  const recentTitles = existing.slice(0, 15).map(a => a.i18n.en.title);
  const prompt = 'You are the editor of FinPulse, a multilingual crypto & finance news site.\n\n' +
'Below are fresh headlines from RSS feeds. Pick the 2 MOST important and DISTINCT stories (prefer variety: crypto, stocks/world economy, and if present something about Ukraine economy). Skip stories too similar to these recently published titles: ' + JSON.stringify(recentTitles) + '\n\n' +
'For each story write an ORIGINAL article (do not copy source text): a catchy title, a 1-2 sentence excerpt, and a body of 3-4 paragraphs. Then translate title, excerpt and body into ALL of: en, uk, ru, es, pt, de, fr, ar, zh, hi, id, vi, tr, ja, ko, pl, th. Native-quality natural translations.\n\n' +
'Category must be one of: crypto, stocks, forex, world, ukraine. Pick a fitting emoji for each article.\n\n' +
'Respond with ONLY valid JSON (no markdown fences), an array of 2 objects:\n' +
'[{"slug":"kebab-case-slug","category":"crypto","emoji":"X","i18n":{"en":{"title":"...","excerpt":"...","body":["p1","p2","p3"]}, ...all 17 langs}}]\n\n' +
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

(async function main() {
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
  for (const a of fresh) {
    for (const l of LANGS) if (!a.i18n[l]) a.i18n[l] = a.i18n.en;
    a.date = now;
    a.gradient = gradients[a.category] || gradients.world;
    a.slug = a.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60) + '-' + Date.now().toString(36).slice(-4);
  }
  const merged = [...fresh, ...existing].slice(0, 60);
  fs.writeFileSync(file, JSON.stringify(merged, null, 1));
  console.log('Added', fresh.length, 'articles. Total:', merged.length);
})().catch(e => { console.error(e); process.exit(1); });
