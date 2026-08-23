#!/usr/bin/env node
/**
 * FinPulse — генератор вечнозелёных SEO-гайдов.
 *
 * Зачем отдельно от новостей:
 *  1. Новости молодого сайта не ранжируются — по «bitcoin price» стоят CoinDesk
 *     и Cointelegraph. Ранжироваться можно по длинному хвосту: «как купить крипту
 *     в Таиланде», «Binance или Coinbase». Там же и коммерческий интент,
 *     то есть там партнёрские ссылки реально конвертят.
 *  2. Гайды НЕ ротируются: новости выпадают из content/articles.json по лимиту,
 *     гайды живут вечно и накапливают возраст, который в SEO работает на нас.
 *  3. Гайд переводится ТОЛЬКО на языки из своего поля langs, а не на все 17.
 *     Гайд «как купить крипту в Таиланде» по-японски — это дубль-мусор,
 *     ровно та проблема, из-за которой пришлось резать новости.
 *
 * Темы курируются вручную в data/guides.json — это не автопоток.
 * За один запуск пишется ОДИН гайд (самый первый ещё не сгенерированный),
 * чтобы не выдавать пачку страниц одним днём.
 *
 * Запуск: ANTHROPIC_API_KEY=sk-... node scripts/guides.js
 *         SLUG=crypto-glossary node scripts/guides.js   — конкретный гайд
 *         REGENERATE=1 ...                              — перезаписать существующий
 *         GUIDES_PER_RUN=9 ...                          — написать несколько за прогон
 *
 * Почему по умолчанию 1: чтобы гайды не вываливались одной пачкой на молодой сайт.
 * Файл сохраняется после КАЖДОГО гайда, а не в конце: если прогон упадёт на седьмом
 * из девяти, шесть уже написанных не пропадут.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const TOPICS_FILE = path.join(ROOT, 'data/guides.json');
const OUT_FILE = path.join(ROOT, 'content/guides.json');

const LANG_NAMES = {
  en: 'English', uk: 'Ukrainian', ru: 'Russian', es: 'Spanish', pt: 'Portuguese',
  de: 'German', fr: 'French', ar: 'Arabic', zh: 'Chinese', hi: 'Hindi',
  id: 'Indonesian', vi: 'Vietnamese', tr: 'Turkish', ja: 'Japanese',
  ko: 'Korean', pl: 'Polish', th: 'Thai'
};

function loadOut() {
  if (!fs.existsSync(OUT_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch { return []; }
}

function buildPrompt(t) {
  const langs = t.langs.map(l => l + ' (' + (LANG_NAMES[l] || l) + ')').join(', ');
  return 'You are writing an evergreen reference guide for FinPulse, a multilingual crypto & finance site.\n\n' +
'TOPIC: ' + t.topic + '\n\n' +
'WHAT TO COVER: ' + t.brief + '\n\n' +
'THIS IS NOT A NEWS POST. It must stay useful and accurate for months, so avoid current prices, ' +
'"this week", "recently", and anything that expires. Write what remains true.\n\n' +
'LENGTH AND DEPTH: 900-1400 words in English. Structure it as 5-8 sections, each with a short ' +
'heading and 1-3 paragraphs. Be concrete: name real mechanisms, real document types, real fee models, ' +
'real numbers where they are stable. A reader must finish able to act, not merely informed that a topic exists. ' +
'No filler, no "in conclusion", no restating the heading, no vague hedging.\n\n' +
'HONESTY: where rules differ by country or change often, say so plainly. Where something is a risk, ' +
'name the risk. Never promise returns. For anything tax- or law-related add a brief, natural caveat ' +
'that rules change and this is not legal or tax advice — woven into the text, not as a disclaimer block.\n\n' +
'TRANSLATION: produce the guide in ALL of these languages: ' + langs + '. ' +
'These are native-quality translations, not literal ones: adapt examples, currency and payment methods ' +
'to what a reader in that language actually uses. A native reader must not be able to tell it was translated.\n\n' +
'Respond with ONLY valid JSON (no markdown fences), one object:\n' +
'{"i18n":{"en":{"title":"...","excerpt":"1-2 sentences","sections":[{"h":"Section heading","p":["paragraph","paragraph"]}]}, ...one entry per requested language}}\n';
}

async function callClaude(prompt) {
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
  let text = '', buf = '';
  const reader = r.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
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
  console.log('Получено ' + text.length + ' символов');
  return JSON.parse(text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim());
}

async function writeOne(topic, out, topics) {
  console.log('Пишу гайд: ' + topic.slug + ' (' + topic.langs.join(', ') + ')');
  const res = await callClaude(buildPrompt(topic));
  const i18n = res.i18n || res;

  const missing = topic.langs.filter(l => !i18n[l] || !i18n[l].sections || !i18n[l].sections.length);
  if (missing.length) throw new Error('Модель не вернула языки: ' + missing.join(', '));

  const words = i18n.en.sections.reduce((n, s) => n + s.p.join(' ').split(/\s+/).length, 0);
  console.log('Английская версия: ' + i18n.en.sections.length + ' секций, ~' + words + ' слов');
  if (words < 600) console.warn('ВНИМАНИЕ: получилось меньше 600 слов — для вечнозелёного гайда это мало');

  const entry = {
    slug: topic.slug,
    category: topic.category || 'guide',
    emoji: topic.emoji || '📘',
    langs: topic.langs,
    updated: new Date().toISOString(),
    i18n: Object.fromEntries(topic.langs.map(l => [l, i18n[l]]))
  };

  const idx = out.findIndex(g => g.slug === entry.slug);
  if (idx >= 0) out[idx] = entry; else out.push(entry);
  // Пишем сразу: прогон на несколько гайдов не должен терять уже готовые из-за сбоя на последнем.
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log('Готово. Гайдов в content/guides.json: ' + out.length + ' из ' + topics.length);
}

async function main() {
  if (!API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }
  const topics = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const out = loadOut();
  const done = new Set(out.map(g => g.slug));

  if (process.env.SLUG) {
    const topic = topics.find(t => t.slug === process.env.SLUG);
    if (!topic) { console.error('Нет темы со slug=' + process.env.SLUG); process.exit(1); }
    if (done.has(topic.slug) && !process.env.REGENERATE) {
      console.log('Гайд ' + topic.slug + ' уже есть. REGENERATE=1 чтобы перезаписать.'); return;
    }
    return writeOne(topic, out, topics);
  }

  const perRun = Math.max(1, Number(process.env.GUIDES_PER_RUN || 1));
  const queue = topics.filter(t => !done.has(t.slug)).slice(0, perRun);
  if (!queue.length) {
    console.log('Все ' + topics.length + ' гайдов уже написаны. Добавьте тему в data/guides.json.'); return;
  }
  console.log('В очереди на этот прогон: ' + queue.length + ' (осталось всего: ' + topics.filter(t => !done.has(t.slug)).length + ')');

  let ok = 0;
  for (const topic of queue) {
    try { await writeOne(topic, out, topics); ok++; }
    catch (e) {
      // Один неудачный гайд не должен ронять остальные: следующий прогон подберёт его снова.
      console.error('Гайд ' + topic.slug + ' не получился: ' + (e && e.message ? e.message : e));
    }
  }
  console.log('Прогон завершён: написано ' + ok + ' из ' + queue.length);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { buildPrompt, LANG_NAMES };
