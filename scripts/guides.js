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
'JSON RULES: escape every double quote inside text as \\", never put a raw newline inside a string, ' +
'do not use smart quotes \u201c \u201d as string delimiters. The response must parse with JSON.parse as-is.\n\n' +
'Respond with ONLY valid JSON (no markdown fences), one object:\n' +
'{"i18n":{"en":{"title":"...","excerpt":"1-2 sentences","sections":[{"h":"Section heading","p":["paragraph","paragraph"]}]}, ...one entry per requested language}}\n';
}

// Перевод уже написанного английского гайда на партию языков.
// Зачем отдельно: один запрос на 14 языков упирается в потолок ответа модели
// и приходит обрезанный JSON (реальный сбой на crypto-scams-how-to-avoid, 23.08).
function buildTranslatePrompt(t, en, langs) {
  const list = langs.map(l => l + ' (' + (LANG_NAMES[l] || l) + ')').join(', ');
  return 'Translate this evergreen guide into: ' + list + '.\n\n' +
'These are native-quality translations, not literal ones: adapt examples, currency, payment methods ' +
'and regulators to what a reader in that language actually uses. A native reader must not be able to ' +
'tell it was translated. Keep the same section structure and the same number of paragraphs.\n\n' +
'SOURCE (English):\n' + JSON.stringify({ title: en.title, excerpt: en.excerpt, sections: en.sections }) + '\n\n' +
'JSON RULES: escape every double quote inside text as \\", never put a raw newline inside a string. ' +
'The response must parse with JSON.parse as-is.\n\n' +
'Respond with ONLY valid JSON (no markdown fences):\n' +
'{"i18n":{"<lang>":{"title":"...","excerpt":"...","sections":[{"h":"...","p":["...","..."]}]}, ...one entry per requested language}}\n';
}

// Ошибки, которые повтором не лечатся: кончился баланс, неверный ключ, нет доступа.
// Прогон #75 после исчерпания баланса ещё трижды долбился в API по каждой из
// оставшихся тем — впустую и с задержками. Такую ошибку надо признавать сразу
// и останавливать весь прогон, а не только текущий гайд.
const FATAL = /credit balance|authentication_error|invalid x-api-key|permission_error|Anthropic API 40[13]/i;
const isFatal = e => FATAL.test(e && e.message ? e.message : String(e));

// Генерация через LLM время от времени возвращает невалидный JSON (сорванное
// экранирование, обрыв по лимиту). Один повтор дешевле, чем потерянный гайд.
async function callClaudeRetry(prompt, tries) {
  const n = tries || 3;
  let last;
  for (let i = 1; i <= n; i++) {
    try { return await callClaude(prompt); }
    catch (e) {
      last = e;
      const msg = e && e.message ? e.message : String(e);
      if (isFatal(e)) { console.error('  ошибка не лечится повтором: ' + msg.slice(0, 160)); throw e; }
      if (i < n) console.warn('  попытка ' + i + ' не разобралась (' + msg.slice(0, 90) + '), повторяю');
    }
  }
  throw last;
}

// Таймаут на запрос: без него один подвисший стрим держит прогон часами
// (реальный случай 23.08 — crypto-glossary висел 45 минут и ничего не отдал).
const REQ_TIMEOUT_MS = Number(process.env.GUIDE_TIMEOUT_MS || 8 * 60 * 1000);

// Модель регулярно отдаёт почти-валидный JSON: пропущенная запятая между
// элементами массива, сырой перевод строки внутри строки, текст вокруг объекта.
// Раньше на это тратился ЦЕЛЫЙ повторный запрос (в прогоне #73 повтор случился
// в 4 вызовах из 5 — двойной расход токенов). Чиним локально и бесплатно;
// если починить не вышло — только тогда повторяем запрос.
function stripFences(raw) {
  let s = String(raw).replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return s;
}

// Чистый посимвольный ремонт (без обрезки и без разбора) — им пользуется и
// repairJson здесь, и parseModelReply в generate.js: stripFences заточен под
// объект гайда {...} и срезал бы скобки у массива статей.
function repairWalk(s) {
  let out = '', inStr = false, esc = false, lastSig = '';
  const needsComma = c => c === '"' || c === '}' || c === ']' || /[0-9a-z]/i.test(c);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { inStr = false; out += c; lastSig = '"'; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      out += c; continue;
    }
    if (c === '"' || c === '{' || c === '[') {
      if (needsComma(lastSig)) out += ',';
      if (c === '"') { inStr = true; out += c; continue; }
      out += c; lastSig = c; continue;
    }
    if (/\s/.test(c)) { out += c; continue; }
    out += c; lastSig = c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

function repairJson(raw) {
  const s = stripFences(raw);
  try { return JSON.parse(s); } catch (e) { /* чиним ниже */ }
  return JSON.parse(repairWalk(s));
}

// Пауза в стриме: абсолютный таймаут рубит и честную долгую генерацию,
// а зависший стрим отличается тем, что байты перестают идти совсем.
const IDLE_TIMEOUT_MS = Number(process.env.GUIDE_IDLE_MS || 150 * 1000);

async function callClaude(prompt) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  let idleAt = Date.now(), stalled = false;
  const idleTimer = setInterval(() => {
    if (Date.now() - idleAt > IDLE_TIMEOUT_MS) { stalled = true; ac.abort(); }
  }, 5000);
  try {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    signal: ac.signal,
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
    idleAt = Date.now();
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
  try {
    return JSON.parse(stripFences(text));
  } catch (e1) {
    try {
      const fixed = repairJson(text);
      console.log('  JSON починен локально (' + String(e1.message || '').slice(0, 60) + ') — повторный запрос не нужен');
      return fixed;
    } catch (e2) {
      const m = /position (\d+)/.exec(String(e1.message || ''));
      if (m) {
        const at = Number(m[1]);
        console.warn('  около ошибки: …' + text.slice(Math.max(0, at - 120), at + 120).replace(/\n/g, '\\n') + '…');
      }
      throw e1;
    }
  }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(stalled
        ? 'стрим завис: ' + Math.round(IDLE_TIMEOUT_MS / 1000) + ' с без единого байта'
        : 'таймаут ' + Math.round(REQ_TIMEOUT_MS / 1000) + ' с — ответ не пришёл');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    clearInterval(idleTimer);
  }
}

// Сколько языков просить за один запрос. Больше — и ответ не влезает в лимит модели.
const LANG_BATCH = Math.max(1, Number(process.env.GUIDE_LANG_BATCH || 3));

// Партия переводов, которая не далась, повторяется НЕ тем же запросом, а двумя
// вдвое меньшими. Причина отказа в прогонах #73 и #75 одна и та же — ответ на 4
// языка не успевал прийти за отведённое время; половинный ответ приходит вдвое
// быстрее. Повтор идентичного запроса, наоборот, гарантированно повторяет отказ.
async function translateBatch(topic, i18n, batch) {
  console.log('  перевод: ' + batch.join(', '));
  try {
    const part = await callClaudeRetry(buildTranslatePrompt(topic, i18n.en, batch), 2);
    Object.assign(i18n, part.i18n || part);
    return;
  } catch (e) {
    if (isFatal(e)) throw e;
    const msg = e && e.message ? e.message : String(e);
    if (batch.length > 1) {
      const half = Math.ceil(batch.length / 2);
      console.warn('  партия ' + batch.join(', ') + ' не далась (' + msg.slice(0, 70) + ') — делю пополам');
      await translateBatch(topic, i18n, batch.slice(0, half));
      await translateBatch(topic, i18n, batch.slice(half));
      return;
    }
    console.error('  язык ' + batch[0] + ' не получился: ' + msg.slice(0, 160));
  }
}

// Язык считается готовым, только если есть непустые секции.
const hasLang = (i18n, l) => !!(i18n && i18n[l] && Array.isArray(i18n[l].sections) && i18n[l].sections.length);

// Каких языков темы ещё нет в уже сохранённом гайде.
function missingLangs(topic, entry) {
  if (!entry) return topic.langs.slice();
  return topic.langs.filter(l => !hasLang(entry.i18n, l));
}

// Сокращение партии первого запроса после провала. Первый запрос — самый
// хрупкий: гайд на английском ПЛЮС несколько переводов, 25-35 тыс. знаков
// одним JSON; на такой длине модель стабильно теряет запятую (01.09 гайд
// crypto-wallet-vs-exchange упал так три раза подряд — 10 минут токенов
// впустую). Повторять тот же гигантский запрос бессмысленно: при провале
// режем партию вдвое, в пределе — чистый английский. null = резать некуда.
function shrinkHead(head) {
  if (head.length <= 1) return null;
  const next = head.slice(0, Math.ceil(head.length / 2));
  if (!next.includes('en')) next.unshift('en');
  return next;
}

async function writeOne(topic, out, topics) {
  const idx = out.findIndex(g => g.slug === topic.slug);
  const prev = idx >= 0 && !process.env.REGENERATE ? out[idx] : null;
  // Гайд, у которого прошлый прогон добил не все языки, дописываем, а не пишем заново:
  // английский текст уже оплачен, платить за него второй раз незачем.
  const i18n = prev && prev.i18n ? { ...prev.i18n } : {};
  const todo = missingLangs(topic, prev);
  if (!todo.length) { console.log('Гайд ' + topic.slug + ' уже полный.'); return; }
  console.log('Пишу гайд: ' + topic.slug + ' (' + todo.join(', ') + (prev ? '; уже есть: ' + topic.langs.filter(l => hasLang(i18n, l)).join(', ') : '') + ')');

  if (!hasLang(i18n, 'en')) {
    // Первый запрос: гайд на английском и первых нескольких языках. При провале
    // разбора НЕ повторяем тот же гигантский запрос в третий раз, а сокращаем
    // партию (см. shrinkHead): короткий ответ разбирается стабильно, а
    // недостающие языки дописывает обычный переводной цикл ниже.
    let head = todo.slice(0, LANG_BATCH);
    if (!head.includes('en')) head.unshift('en');
    for (;;) {
      try {
        const first = await callClaudeRetry(buildPrompt({ ...topic, langs: head }), 2);
        Object.assign(i18n, first.i18n || first);
        break;
      } catch (e) {
        const next = isFatal(e) ? null : shrinkHead(head);
        if (!next) throw e;
        console.warn('  первый запрос (' + head.join(', ') + ') не дался — сокращаю партию до: ' + next.join(', '));
        head = next;
      }
    }
    if (!hasLang(i18n, 'en')) {
      throw new Error('Модель не вернула английскую версию — переводить нечего');
    }
  }

  // Остальные языки догоняем партиями, переводя уже написанный английский текст.
  // Партия, которая не далась, НЕ роняет гайд: сохраняем то, что получилось,
  // и следующий прогон допишет остаток (в прогоне #73 из-за одной зависшей партии
  // выбрасывался целый готовый гайд вместе с английским текстом).
  const rest = topic.langs.filter(l => !hasLang(i18n, l));
  for (let i = 0; i < rest.length; i += LANG_BATCH) {
    await translateBatch(topic, i18n, rest.slice(i, i + LANG_BATCH));
  }

  const produced = topic.langs.filter(l => hasLang(i18n, l));
  if (!produced.includes('en')) throw new Error('Нет английской версии — сохранять нечего');

  const words = i18n.en.sections.reduce((n, s) => n + s.p.join(' ').split(/\s+/).length, 0);
  console.log('Английская версия: ' + i18n.en.sections.length + ' секций, ~' + words + ' слов');
  if (words < 600) console.warn('ВНИМАНИЕ: получилось меньше 600 слов — для вечнозелёного гайда это мало');

  const entry = {
    slug: topic.slug,
    category: topic.category || 'guide',
    emoji: topic.emoji || '📘',
    langs: produced,
    updated: new Date().toISOString(),
    i18n: Object.fromEntries(produced.map(l => [l, i18n[l]]))
  };

  if (idx >= 0) out[idx] = entry; else out.push(entry);
  // Пишем сразу: прогон на несколько гайдов не должен терять уже готовые из-за сбоя на последнем.
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  const short = topic.langs.filter(l => !produced.includes(l));
  console.log('Готово: ' + topic.slug + ' на ' + produced.length + ' из ' + topic.langs.length + ' языков' +
    (short.length ? ' (не хватает: ' + short.join(', ') + ' — допишет следующий прогон)' : '') +
    '. Гайдов в content/guides.json: ' + out.length + ' из ' + topics.length);
}

async function main() {
  if (!API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }
  const topics = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const out = loadOut();
  const byslug = new Map(out.map(g => [g.slug, g]));
  // Гайд считается готовым, только если написаны ВСЕ языки его темы.
  // Иначе он снова попадёт в очередь и следующий прогон допишет недостающие.
  const done = new Set(topics.filter(t => !missingLangs(t, byslug.get(t.slug)).length).map(t => t.slug));

  if (process.env.SLUG) {
    const topic = topics.find(t => t.slug === process.env.SLUG);
    if (!topic) { console.error('Нет темы со slug=' + process.env.SLUG); process.exit(1); }
    if (done.has(topic.slug) && !process.env.REGENERATE) {
      console.log('Гайд ' + topic.slug + ' уже написан целиком. REGENERATE=1 чтобы перезаписать.'); return;
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
      if (isFatal(e)) {
        console.error('Дальше идти незачем — проблема не в теме, а в доступе к API. Прогон остановлен.');
        break;
      }
    }
  }
  console.log('Прогон завершён: написано ' + ok + ' из ' + queue.length);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { buildPrompt, LANG_NAMES, repairJson, repairWalk, stripFences, missingLangs, hasLang, isFatal, shrinkHead };
