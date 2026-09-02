#!/usr/bin/env node
/**
 * Тесты генератора вертикальных видео-новостей.
 *
 * Проверяем ТОЛЬКО чистую логику: как текст статьи превращается в карточки,
 * какой кегль получает карточка, что попадает в описание под роликом.
 * Рендер Chrome и вызовы ffmpeg сюда не тянем — они требуют бинарей и секунд,
 * а ломается на практике не они, а разбивка текста.
 */
const assert = require('assert');
const { sentences, bodyCards, fitSize, caption, cardHtml, cardDuration, ttsMode, hookSplit, kickerFor, buildCards, pickQueue, emphasize } = require('./video.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('sentences:');

t('делит абзац на предложения', () => {
  assert.deepStrictEqual(
    sentences('Bitcoin rose. Analysts disagree! What next?'),
    ['Bitcoin rose.', 'Analysts disagree!', 'What next?']
  );
});

t('сокращение не считается концом предложения', () => {
  // «U.S.» в середине фразы резало карточку пополам — на экране получался обрывок
  assert.deepStrictEqual(
    sentences('The U.S. Treasury acted. Markets fell.'),
    ['The U.S. Treasury acted.', 'Markets fell.']
  );
});

console.log('bodyCards:');

const para = [
  'Short one.',
  'The exchange said the new custody arrangement will cover institutional clients from the first quarter.',
  'Regulators in three jurisdictions have already signed off on the structure, according to the filing.',
  'A spokesperson declined to comment on the fee schedule for the new service tier.'
];

t('карточка из двух слов не выходит на экран', () => {
  // Карточка «Short one.» — это пустой экран на 3 секунды, зритель уходит.
  // Короткое предложение должно склеиваться со следующим, а не жить отдельно.
  const cards = bodyCards(para, 4);
  assert.ok(cards.length > 0, 'не собралось ни одной карточки');
  assert.ok(cards.every(c => c.length >= 60), 'карточка короче 60 символов: ' + JSON.stringify(cards));
});

t('гигантское предложение не утаскивает за собой нормальное', () => {
  const huge = ['x'.repeat(400) + '.', 'This sentence is a perfectly reasonable length for a single card on the screen.'];
  const cards = bodyCards(huge, 3);
  assert.ok(cards.every(c => c.length <= 200), 'карточка длиннее 200 символов: ' + JSON.stringify(cards));
  assert.strictEqual(cards.length, 1, 'нормальное предложение потерялось вместе с гигантским');
});

t('не отдаёт больше карточек, чем просили', () => {
  assert.strictEqual(bodyCards(para, 2).length, 2);
});

t('пустой текст не роняет генератор', () => {
  assert.deepStrictEqual(bodyCards([], 4), []);
});

console.log('fitSize:');

t('длинному тексту достаётся меньший кегль', () => {
  // Один и тот же кегль для 30 и для 190 символов даёт либо пустую карточку,
  // либо нечитаемую стену — на телефоне и то, и другое пролистывают.
  assert.ok(fitSize('x'.repeat(30), true) > fitSize('x'.repeat(150), true));
  assert.ok(fitSize('x'.repeat(30), false) > fitSize('x'.repeat(150), false));
});

t('заголовок крупнее обычной карточки', () => {
  assert.ok(fitSize('x'.repeat(50), true) > fitSize('x'.repeat(50), false));
});

console.log('caption:');

const tr = { title: 'Bitcoin hits new high', excerpt: 'Institutional demand drives the move.' };

t('в описании нет кликабельной ссылки, но есть отсылка к профилю', () => {
  // TikTok не делает ссылки в описании кликабельными: «https://…» только съедает
  // место и читается как спам. Работает ТОЛЬКО ссылка в профиле.
  const c = caption(tr);
  assert.ok(c.includes('Bitcoin hits new high'), 'нет заголовка');
  assert.ok(c.includes('#FinPulse'), 'нет фирменного хештега');
  assert.ok(!/https?:\/\//.test(c), 'в описание попал URL: ' + c);
  assert.ok(/link in bio/i.test(c), 'нет отсылки к ссылке в профиле');
});

console.log('cardDuration:');

t('с озвучкой длительность идёт от реального аудио, а не от настройки', () => {
  // Если брать фиксированную длительность при живой озвучке, голос и текст
  // разъезжаются уже к третьей карточке — ролик выглядит сломанным.
  assert.ok(Math.abs(cardDuration(5.2) - 5.65) < 1e-9, 'ожидалось 5.2 + пауза 0.45');
  assert.notStrictEqual(cardDuration(5.2), cardDuration(null));
});

t('без озвучки берётся длительность из data/video.json', () => {
  assert.strictEqual(cardDuration(null), 3.6);
  assert.strictEqual(cardDuration(0), 3.6);
});

console.log('ttsMode:');

t('локальная модель не требует ключа', () => {
  // Kokoro и Piper крутятся на своём же раннере: ключа нет, счёта нет,
  // лимита нет. Требовать для них переменную окружения — значит без причины
  // выключить единственный бесплатный вариант.
  assert.strictEqual(ttsMode({ enabled: true, provider: 'kokoro' }, {}), 'kokoro');
  assert.strictEqual(ttsMode({ enabled: true, provider: 'piper' }, {}), 'piper');
});

t('облачный провайдер без ключа отключается, а не роняет прогон', () => {
  assert.strictEqual(ttsMode({ enabled: true, provider: 'openai' }, {}), 'none');
  assert.strictEqual(ttsMode({ enabled: true, provider: 'elevenlabs' }, {}), 'none');
  assert.strictEqual(ttsMode({ enabled: true, provider: 'openai' }, { OPENAI_API_KEY: 'sk-x' }), 'openai');
});

t('enabled:false выключает озвучку даже с ключом', () => {
  assert.strictEqual(ttsMode({ enabled: false, provider: 'openai' }, { OPENAI_API_KEY: 'sk-x' }), 'none');
  assert.strictEqual(ttsMode({ enabled: false, provider: 'kokoro' }, {}), 'none');
});

console.log('hookSplit:');

t('длинный заголовок разбивается на крючок и продолжение', () => {
  // Замер первого ролика: среднее время просмотра 3,64 с из 39, «большинство
  // зрителей перестали смотреть в 0:01». Причина — первый кадр требовал прочесть
  // девятисловный заголовок. Первый кадр должен читаться за полсекунды.
  const [hook, rest] = hookSplit('Standard Chartered Becomes First Bank to Distribute Hong Kong Dollar Stablecoin');
  assert.ok(hook.length <= 22, 'крючок длиннее 22 символов: ' + hook);
  assert.ok(hook.split(/\s+/).length <= 3, 'в крючке больше 3 слов: ' + hook);
  assert.strictEqual(hook, 'Standard Chartered',
    'крючок должен быть узнаваемым именем, а не обрывком фразы');
  assert.ok(rest.length > 0, 'продолжение пустое');
  assert.strictEqual((hook + ' ' + rest).replace(/\s+/g, ' '),
    'Standard Chartered Becomes First Bank to Distribute Hong Kong Dollar Stablecoin',
    'при разбивке потерялись или задвоились слова');
});

console.log('kickerFor:');

t('свежая новость получает BREAKING, несвежая — нет', () => {
  // Плашка BREAKING на новости шестидневной давности — это враньё зрителю,
  // и для новостного аккаунта это дороже любого охвата.
  const now = Date.parse('2026-08-29T12:00:00Z');
  assert.strictEqual(kickerFor('2026-08-29T06:00:00Z', now), 'Breaking');
  assert.strictEqual(kickerFor('2026-08-23T06:00:00Z', now), 'Crypto');
});

console.log('buildCards:');

const artFixture = { slug: 'x', category: 'crypto', date: '2026-08-30T06:00:00Z' };
const trFixture = {
  title: 'Standard Chartered Becomes First Bank to Distribute Hong Kong Dollar Stablecoin',
  body: [
    'The exchange said the new custody arrangement will cover institutional clients from the first quarter.',
    'Regulators in three jurisdictions have already signed off on the structure, according to the filing.'
  ]
};

t('ставка для зрителя живёт НА кадре с крючком, а не перед ним', () => {
  // Соблазн — поставить «не пропусти важное» отдельным кадром. Но замер обоих
  // роликов: уход в 0:01. Отдельный кадр отодвигает новость на полторы секунды
  // ИМЕННО в ту секунду, когда зритель решает. Ставка идёт первой в озвучке,
  // но крючок при этом на экране с нулевого кадра.
  const withLine = buildCards(artFixture, trFixture, { maxBodyCards: 2, openingLine: 'Hold crypto? This one matters.' });
  const without  = buildCards(artFixture, trFixture, { maxBodyCards: 2 });
  assert.strictEqual(withLine.length, without.length, 'ставка добавила лишний кадр — крючок отодвинулся');
  assert.strictEqual(withLine[0].kind, 'hook');
  assert.strictEqual(withLine[0].text, without[0].text, 'текст крючка изменился');
  assert.strictEqual(withLine[0].stake, 'Hold crypto? This one matters.');
  assert.ok(withLine[0].spoken.startsWith('Hold crypto? This one matters.'),
    'озвучка не начинается со ставки: ' + withLine[0].spoken);
  assert.ok(withLine[0].spoken.includes(without[0].text), 'крючок пропал из озвучки');
});

t('пустая openingLine ничего не добавляет', () => {
  const cards = buildCards(artFixture, trFixture, { maxBodyCards: 2, openingLine: '   ' });
  assert.strictEqual(cards[0].stake, undefined);
  assert.strictEqual(cards[0].spoken, cards[0].text);
});

t('последний кадр — призыв подписаться', () => {
  const cards = buildCards(artFixture, trFixture, { maxBodyCards: 2 });
  assert.strictEqual(cards[cards.length - 1].kind, 'cta');
});

console.log('pickQueue:');

t('старая новость не попадает в очередь рендера', () => {
  // 30.08 после недельного простоя ленты в очереди на рендер стояли статьи
  // от 23 августа. Ролик «новость недельной давности» для новостного аккаунта
  // хуже, чем отсутствие ролика: плашки Breaking нет, но сам факт запоздалой
  // публикации виден любому, кто читает новости где-то ещё.
  const now = Date.parse('2026-08-30T12:00:00Z');
  const arts = [
    { slug: 'old',   date: '2026-08-23T06:00:00Z', i18n: { en: {} } },
    { slug: 'fresh', date: '2026-08-30T06:00:00Z', i18n: { en: {} } }
  ];
  const q = pickQueue(arts, [], { perRun: 5 }, now);
  assert.deepStrictEqual(q.map(a => a.slug), ['fresh'], 'в очередь попала старая статья');
});

t('уже отрендеренная и свежая — очередь пуста, а не откат к старым', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const arts = [
    { slug: 'old',   date: '2026-08-23T06:00:00Z', i18n: { en: {} } },
    { slug: 'fresh', date: '2026-08-30T06:00:00Z', i18n: { en: {} } }
  ];
  const q = pickQueue(arts, ['fresh'], { perRun: 1 }, now);
  assert.deepStrictEqual(q, [], 'после свежей статьи генератор откатился к старой');
});

t('свежие сортируются от новых к старым и режутся по perRun', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const arts = [
    { slug: 'a', date: '2026-08-29T20:00:00Z', i18n: { en: {} } },
    { slug: 'b', date: '2026-08-30T06:00:00Z', i18n: { en: {} } },
    { slug: 'c', date: '2026-08-30T02:00:00Z', i18n: { en: {} } }
  ];
  const q = pickQueue(arts, [], { perRun: 2 }, now);
  assert.deepStrictEqual(q.map(a => a.slug), ['b', 'c']);
});

console.log('emphasize:');

t('деньги и проценты подсвечиваются, обычные слова — нет', () => {
  // Разбор топ-аккаунтов ниши (31.08, @cryptodailyfeed 1M, поисковая выдача):
  // у всех заголовок — ALL CAPS, а ключевая цифра выделена цветом
  // («BITCOIN JUST HIT $73,000», «DIAMONDS CRASHED 70%»). Цифра — это
  // единственное, что зритель успевает прочесть за полсекунды.
  const out = emphasize('Token Crashes 49% After $1.1 Million Hack');
  assert.ok(out.includes('<b class="em">49%</b>'), '49% не подсвечен: ' + out);
  assert.ok(out.includes('<b class="em">$1.1 Million</b>'), '$1.1 Million не подсвечен: ' + out);
  assert.ok(!/class="em">Token/.test(out), 'обычное слово подсвечено');
});

t('HTML в тексте экранируется, а не исполняется', () => {
  const out = emphasize('<script>alert(1)</script> costs $5');
  assert.ok(!out.includes('<script>'), 'сырой HTML прошёл в карточку');
  assert.ok(out.includes('<b class="em">$5</b>'));
});

t('текст без цифр возвращается просто экранированным', () => {
  assert.strictEqual(emphasize('Cronos Blockchain Halted'), 'Cronos Blockchain Halted');
});

console.log('follow-плашка:');

t('плашка Follow появляется со второй карточки и не звучит в озвучке', () => {
  // Замеры: среднее время просмотра 1,6 с из 28 — до финального «Follow»
  // доживают единицы, призыв в конце почти никто не видит. Голосом на 5-й
  // секунде звать «подпишись» нельзя — перебивает новость в момент решения.
  // Ответ: ВИЗУАЛЬНАЯ плашка со второй карточки; первый кадр остаётся чистым,
  // озвучка не трогается.
  const cards = buildCards(artFixture, trFixture, { maxBodyCards: 2, handle: '@finpulse24_en' });
  assert.ok(!cards[0].follow, 'плашка на первом кадре — он должен оставаться чистым');
  const middle = cards.slice(1, -1);
  assert.ok(middle.length > 0 && middle.every(c => c.follow), 'плашки нет на средних карточках');
  assert.ok(!cards[cards.length - 1].follow, 'на финальном кадре свой CTA, плашка дублирует');
  assert.ok(middle.every(c => !/follow/i.test(c.spoken)), 'плашка попала в озвучку');
  const html = cardHtml(middle[0], 1, cards.length);
  assert.ok(html.includes('<div class="follow-pill">'), 'cardHtml не рисует плашку');
  assert.ok(html.includes('@finpulse24_en'), 'в плашке нет хэндла');
  const hookHtml = cardHtml(cards[0], 0, cards.length);
  assert.ok(!hookHtml.includes('<div class="follow-pill">'), 'плашка просочилась на первый кадр');
});

t('финальный кадр говорит «не упусти главное»', () => {
  const cards = buildCards(artFixture, trFixture, { maxBodyCards: 2 });
  const cta = cards[cards.length - 1];
  assert.ok(/don't miss/i.test(cta.text), 'в финале нет «Don\'t miss»: ' + cta.text);
  assert.ok(/follow/i.test(cta.spoken), 'финальная озвучка потеряла призыв подписаться');
});

console.log('\nВсе ' + n + ' проверок прошли.');
