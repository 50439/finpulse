const { titleSimilarity, slugBase, DUP_THRESHOLD, feedStall, quotaFull, parseModelReply } = require('./generate.js');

// Пары, которые РЕАЛЬНО были опубликованы дважды (взяты из прода)
const MUST_CATCH = [
  ["Coldcard Ships Firmware Update After $114 Million Bitcoin Theft",
   "Coldcard Releases Emergency Firmware Update After $114 Million Bitcoin Theft"],
  ["Nomura-Backed Laser Digital Wins Japan's First Crypto Approval in Four Years",
   "Japan Approves Nomura-Backed Laser Digital, First Crypto License in Four Years"],
  ["Canada-US Trade Negotiations Reach Final Hours Before Friday Deadline",
   "Canada-US Trade Talks Enter Final Hours as Friday Deadline Approaches"],
  ["Canadian Provinces Resist Trade Concessions as US Deadline Looms",
   "Canadian Provinces Push Back Against Trade Concessions as US Deadline Approaches"],
  ["India's Forex Reserves Surge to $716.9 Billion, Highest in Six Months",
   "India's Forex Reserves Hit $716.9 Billion, Reaching Six-Month Peak"],
  ["Emerging Market Currencies Hit Multi-Year Highs as Dollar Slumps",
   "Emerging Market Currencies Soar to New Highs as Dollar Weakness Deepens"],
];

// Пары, которые НЕЛЬЗЯ считать дублями — это разные новости
const MUST_PASS = [
  ["Canada Announces Retaliatory Tariffs on US Goods After Trade Talks Collapse",
   "Canada-US Trade Talks Enter Final Hours as Friday Deadline Approaches"],
  ["Bitcoin Rally Above $79,000 Sends Crypto Mining Stocks Soaring",
   "Treasury Buyback Strategy Triggers Bitcoin's 25% Surge to $80,000"],
  ["Zcash Soars 48% to $800 as Grayscale ETF Filing Advances",
   "Ethena's ENA Token Soars 48% on Major FalconX Partnership Deal"],
  ["BitMart Exchange Considers Partial Restart and Creditor Payouts After Shutdown",
   "Binance Staff Released After UAE Questioning Over Third-Party Fund Flows"],
  ["Solana Slashes Blockchain Speed to 350 Milliseconds in Historic Upgrade",
   "Major Crypto Industry Groups Challenge Illinois Digital Asset Tax in Court"],
];

let fail = 0;
console.log('Порог: ' + DUP_THRESHOLD + '\n');
console.log('--- ДОЛЖНЫ ловиться как дубли ---');
for (const [a,b] of MUST_CATCH) {
  const s = titleSimilarity(a,b);
  const ok = s >= DUP_THRESHOLD;
  if (!ok) fail++;
  console.log((ok?'  OK  ':'  FAIL') + ' ' + s.toFixed(2) + '  ' + a.slice(0,52));
}
console.log('\n--- НЕ должны считаться дублями ---');
for (const [a,b] of MUST_PASS) {
  const s = titleSimilarity(a,b);
  const ok = s < DUP_THRESHOLD;
  if (!ok) fail++;
  console.log((ok?'  OK  ':'  FAIL') + ' ' + s.toFixed(2) + '  ' + a.slice(0,52));
}
console.log('\n--- база слага (суффикс должен отбрасываться) ---');
const sl = [['india-forex-reserves-surge-716-billion-six-month-high-yug5',
             'india-forex-reserves-surge-716-billion-six-month-high-iif2']];
for (const [a,b] of sl) {
  const ok = slugBase(a) === slugBase(b);
  if (!ok) fail++;
  console.log((ok?'  OK  ':'  FAIL') + ' ' + slugBase(a));
}
// --- Молчаливый простой ленты ------------------------------------------
// Прогоны #76-#92: модель шесть суток подряд возвращала пустой массив,
// скрипт писал «Свежих новостей нет — это нормально» и завершался успешно.
// Новостной сайт неделю не публиковал новости, и ни один прогон об этом
// не сказал. Пустой ответ модели — норма. Пустая лента шестые сутки — нет.
console.log('\n--- простой ленты замечается ---');
{
  const now = Date.parse('2026-08-30T12:00:00Z');
  const cases = [
    [[{ date: '2026-08-30T06:00:00Z' }], false, 'свежая статья — молчим'],
    [[{ date: '2026-08-24T16:54:00Z' }], true,  'шесть суток тишины — кричим'],
    [[],                                 true,  'пустая лента — кричим']
  ];
  for (const [arts, wantWarn, name] of cases) {
    const got = feedStall(arts, now);
    const ok = wantWarn ? typeof got === 'string' && got.length > 0 : got === null;
    if (!ok) fail++;
    console.log((ok ? '  OK  ' : '  FAIL') + ' ' + name + '  ->  ' + JSON.stringify(got));
  }
}

// --- Дрейф суточного лимита --------------------------------------------
// Прогоны идут по сетке раз в 8 часов, а лимит считал «статьи за 24 часа».
// Статья, вышедшая в 06:19, блокирует завтрашний прогон 05:44 (ей 23,4 ч) —
// публикация уезжает на 13:44, послезавтра ещё позже. Фактический каденс
// получался 29-32 часа: «1 статья в сутки» тихо превратилась в «5 статей в
// неделю». Окно 20 ч < 24 - 8/2: тот же слот назавтра всегда проходит.
console.log('\n--- окно лимита не дрейфует ---');
{
  const now = Date.parse('2026-08-31T05:44:00Z');
  const cases = [
    [[{ date: '2026-08-30T06:19:00Z' }], false, 'вчерашняя статья (23.4 ч) не блокирует сегодняшний слот'],
    [[{ date: '2026-08-31T00:00:00Z' }], true,  'сегодняшняя статья (5.7 ч) блокирует'],
    [[{ date: '2026-08-30T06:19:00Z' }], false, 'perDay=0 выключает лимит', { newsPerDay: 0 }]
  ];
  for (const [arts, want, name, cfg] of cases) {
    const got = quotaFull(arts, cfg || { newsPerDay: 1 }, now);
    const ok = got === want || (cfg && cfg.newsPerDay === 0 && got === false);
    if (!ok) fail++;
    console.log((ok ? '  OK  ' : '  FAIL') + ' ' + name + '  ->  ' + got);
  }
}

// --- Ремонт JSON от модели ---------------------------------------------
// 02.09, прогон #105: модель вернула выпуск на 55 707 знаков с одной
// потерянной запятой (позиция 30 398) — и generate.js выбросил ВСЮ статью,
// день остался без новости. У guides.js эта болезнь вылечена repairJson ещё
// 24.08; новостной генератор обязан пользоваться той же аптечкой.
console.log('\n--- кривой JSON чинится, а не выбрасывает выпуск ---');
{
  const broken = '```json\n[{"slug":"a","i18n":{"en":{"title":"T","body":["p1"]}}}\n{"slug":"b"}]\n```';
  let got = null, err = null;
  try { got = parseModelReply(broken); } catch (e) { err = e; }
  const ok1 = !err && Array.isArray(got) && got.length === 2;
  if (!ok1) fail++;
  console.log((ok1 ? '  OK  ' : '  FAIL') + ' пропущенная запятая между объектами массива чинится' + (err ? ' -> ' + err.message : ''));

  let err2 = null;
  try { parseModelReply('[{"slug":"a","i18n":{"en":{"title":"T'); } catch (e) { err2 = e; }
  const ok2 = !!err2;
  if (!ok2) fail++;
  console.log((ok2 ? '  OK  ' : '  FAIL') + ' обрезанный ответ честно падает, а не чинится молча');
}

console.log('\n' + (fail ? 'ПРОВАЛЕНО проверок: ' + fail : 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'));
process.exit(fail ? 1 : 0);
