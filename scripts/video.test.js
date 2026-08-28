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
const { sentences, bodyCards, fitSize, caption, cardDuration } = require('./video.js');

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

console.log('\nВсе ' + n + ' проверок прошли.');
