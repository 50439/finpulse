const { titleSimilarity, slugBase, DUP_THRESHOLD } = require('./generate.js');

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
console.log('\n' + (fail ? 'ПРОВАЛЕНО проверок: ' + fail : 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'));
process.exit(fail ? 1 : 0);
