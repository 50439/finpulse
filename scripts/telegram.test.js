#!/usr/bin/env node
/**
 * Тест мультиканального постинга БЕЗ обращения к Telegram: fetch подменяется заглушкой.
 * Проверяет ровно то, что ломается молча: язык ссылки, изоляцию каналов,
 * миграцию старой истории и то, что падение одного канала не убивает остальные.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let fails = 0;
const check = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

// песочница: копия репозитория с подставным контентом
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'tgtest-'));
fs.mkdirSync(path.join(box, 'data')); fs.mkdirSync(path.join(box, 'scripts')); fs.mkdirSync(path.join(box, 'content'));
fs.copyFileSync(path.join(ROOT, 'data/i18n.json'), path.join(box, 'data/i18n.json'));
fs.copyFileSync(path.join(ROOT, 'scripts/telegram.js'), path.join(box, 'scripts/telegram.js'));
fs.writeFileSync(path.join(box, 'data/telegram-channels.json'), JSON.stringify({
  _comment: 'test', ru: '@ch_ru', pl: '@ch_pl', ja: '@ch_ja', xx: '@bogus'
}));
const i18nFor = titles => Object.fromEntries(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT,'data/i18n.json'),'utf8')).languages)
  .map(l => [l, { title: titles + ' ' + l, excerpt: 'ex ' + l, body: ['b'] }]));
fs.writeFileSync(path.join(box, 'content/articles.json'), JSON.stringify([
  { slug: 'news-new', emoji: '📰', date: '2026-08-23', category: 'crypto', i18n: i18nFor('NEWS-NEW') },
  { slug: 'news-old', emoji: '📰', date: '2026-08-22', category: 'crypto', i18n: i18nFor('NEWS-OLD') }
]));
fs.writeFileSync(path.join(box, 'content/guides.json'), JSON.stringify([
  { slug: 'guide-pl', emoji: '🇵🇱', langs: ['pl', 'en'], i18n: { pl: { title: 'GUIDE pl', excerpt: 'g' }, en: { title: 'GUIDE en', excerpt: 'g' } } }
]));
// старый плоский формат — должен мигрировать в ru и не перепоститься
fs.writeFileSync(path.join(box, 'content/tg-posted.json'), JSON.stringify(['news-old']));

// раннер: подменяет fetch, собирает отправленное
const runner = `
const sent = [];
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  const method = url.split('/').pop();
  if (method === 'sendMessage') {
    if (body.chat_id === '@ch_ja') return { json: async () => ({ ok: false, description: 'chat not found' }) };
    sent.push({ chat: body.chat_id, text: body.text });
  }
  return { json: async () => ({ ok: true, result: { id: 1 } }) };
};
process.on('exit', () => require('fs').writeFileSync(process.env.OUT, JSON.stringify(sent, null, 1)));
require('./scripts/telegram.js');
`;
fs.writeFileSync(path.join(box, 'runner.js'), runner);
const out = path.join(box, 'sent.json');
const res = require('child_process').spawnSync(process.execPath, ['runner.js'], {
  cwd: box, encoding: 'utf8',
  env: { ...process.env, TELEGRAM_BOT_TOKEN: 'x', SITE_URL: 'https://finpulse24.com', OUT: out, TG_MAX_POSTS: '2', TG_SKIP_SITE_CHECK: '1' }
});
const log = (res.stdout || '') + (res.stderr || '');
const sent = JSON.parse(fs.readFileSync(out, 'utf8'));

check(/язык xx не существует/.test(log), 'несуществующий язык в карте каналов должен быть отброшен с предупреждением');
check(!sent.some(s => s.chat === '@bogus'), 'в несуществующий язык постить нельзя');
check(/старая история/.test(log), 'плоский формат tg-posted.json должен мигрировать');

const byChat = c => sent.filter(s => s.chat === c);
check(byChat('@ch_ru').length === 1, 'ru: должна уйти только новая новость (старая уже в истории), ушло ' + byChat('@ch_ru').length);
check(byChat('@ch_ru')[0] && /NEWS-NEW ru/.test(byChat('@ch_ru')[0].text), 'ru-канал обязан получить русский заголовок');
check(byChat('@ch_ru').every(s => /\/ru\/news\//.test(s.text)), 'ru-канал обязан получать ссылки на /ru/');

check(byChat('@ch_pl').length === 2, 'pl: гайд + новость, ушло ' + byChat('@ch_pl').length);
check(byChat('@ch_pl').some(s => /GUIDE pl/.test(s.text) && /\/pl\/guide\//.test(s.text)), 'pl-канал обязан получить польский гайд со ссылкой на /pl/guide/');
check(byChat('@ch_pl').every(s => /finpulse24\.com\/pl\//.test(s.text)), 'pl-канал обязан получать только польские ссылки');
check(!byChat('@ch_ru').some(s => /guide/.test(s.text)), 'гайд, которого нет на русском, не должен попасть в русский канал');

check(byChat('@ch_ja').length === 0, 'сломанный канал ничего не отправляет');
check(sent.length === 3, 'падение одного канала не должно останавливать остальные, всего ушло ' + sent.length);

const after = JSON.parse(fs.readFileSync(path.join(box, 'content/tg-posted.json'), 'utf8'));
check(after.ru.includes('news-new') && after.ru.includes('news-old'), 'история ru должна пополниться');
check(!(after.ja || []).length, 'у сломанного канала история не должна пополняться');
check(after.guides.pl.includes('guide-pl'), 'гайд должен попасть в историю гайдов pl');
check(!(after.guides.ru || []).length, 'гайд не должен числиться опубликованным в ru');

fs.rmSync(box, { recursive: true, force: true });
// Предохранитель: домен не резолвится — не должно уйти ни одного сообщения.
// 24.08.2026 зона отвалилась вместе с хостингом; без этой проверки автопостинг
// разослал бы битые ссылки в 10 каналов. Адрес берётся из data/site.json,
// поэтому подменяем именно файл, а не переменную окружения.
{
  const dead = fs.mkdtempSync(path.join(os.tmpdir(), 'tgdead-'));
  fs.mkdirSync(path.join(dead, 'data')); fs.mkdirSync(path.join(dead, 'scripts')); fs.mkdirSync(path.join(dead, 'content'));
  for (const f of ['data/i18n.json', 'data/telegram-channels.json', 'scripts/telegram.js'])
    fs.copyFileSync(path.join(ROOT, f), path.join(dead, f));
  fs.writeFileSync(path.join(dead, 'data/site.json'), JSON.stringify({ url: 'https://finpulse24-cannot-exist-zzz.invalid' }));
  fs.writeFileSync(path.join(dead, 'content/articles.json'), '[]');
  const outD = path.join(dead, 'sent.json');
  const r = require('child_process').spawnSync(process.execPath, [path.join(dead, 'scripts/telegram.js')], {
    encoding: 'utf8', env: { ...process.env, TELEGRAM_BOT_TOKEN: 'x', OUT: outD, TG_SKIP_SITE_CHECK: '' }
  });
  const log = (r.stdout || '') + (r.stderr || '');
  check(!fs.existsSync(outD), '\u0441\u0430\u0439\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d, \u043d\u043e \u0441\u043a\u0440\u0438\u043f\u0442 \u0432\u0441\u0451 \u0440\u0430\u0432\u043d\u043e \u043f\u043e\u0441\u0442\u0438\u043b');
  check(/\u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442/.test(log),
    '\u043f\u0440\u0435\u0434\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0435\u043b\u044c \u043d\u0435 \u0441\u0440\u0430\u0431\u043e\u0442\u0430\u043b. \u0412\u044b\u0432\u043e\u0434: ' + JSON.stringify(log.slice(0, 200)));
}

if (fails) { console.error(fails + ' failures'); process.exit(1); }
console.log('OK - telegram: ' + sent.length + ' сообщений, каналы изолированы, языки не перепутаны');
