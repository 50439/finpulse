#!/usr/bin/env node
/**
 * Тесты генератора гайдов.
 *
 * Что проверяем и почему именно это:
 *  1. repairJson — модель раз за разом отдаёт почти-валидный JSON. Раньше на каждый
 *     такой ответ уходил ЦЕЛЫЙ повторный запрос к API (прогон #73: повтор в 4 вызовах
 *     из 5). Локальная починка должна закрывать типовые поломки бесплатно.
 *  2. repairJson НЕ должен «чинить» обрезанный ответ: половина текста хуже,
 *     чем честный повтор запроса.
 *  3. missingLangs — гайд, у которого прошлый прогон не добил часть языков,
 *     обязан снова попадать в очередь, а не считаться готовым.
 */
const assert = require('assert');
const { repairJson, missingLangs, hasLang, isFatal } = require('./guides.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('repairJson:');

t('валидный JSON проходит как есть', () => {
  assert.deepStrictEqual(repairJson('{"a":[1,2]}'), { a: [1, 2] });
});

t('markdown-заборы снимаются', () => {
  assert.deepStrictEqual(repairJson('```json\n{"a":1}\n```'), { a: 1 });
});

t('болтовня вокруг объекта отрезается', () => {
  assert.deepStrictEqual(repairJson('Here is the JSON:\n{"a":1}\nHope that helps!'), { a: 1 });
});

t('пропущенная запятая между элементами массива', () => {
  // ровно эта поломка ловилась как «Expected \',\' or \']\' after array element»
  assert.deepStrictEqual(repairJson('{"p":["первый абзац" "второй абзац"]}'),
    { p: ['первый абзац', 'второй абзац'] });
});

t('пропущенная запятая между объектами', () => {
  assert.deepStrictEqual(repairJson('{"s":[{"h":"A"} {"h":"B"}]}'),
    { s: [{ h: 'A' }, { h: 'B' }] });
});

t('пропущенная запятая между полями объекта', () => {
  assert.deepStrictEqual(repairJson('{"a":1 "b":2}'), { a: 1, b: 2 });
});

t('сырой перевод строки внутри строки', () => {
  assert.deepStrictEqual(repairJson('{"p":"первая\nвторая"}'), { p: 'первая\nвторая' });
});

t('висячая запятая', () => {
  assert.deepStrictEqual(repairJson('{"p":["a","b",]}'), { p: ['a', 'b'] });
});

t('экранированная кавычка внутри строки не ломает разбор', () => {
  assert.deepStrictEqual(repairJson('{"p":["он сказал \\"да\\"" "и ушёл"]}'),
    { p: ['он сказал "да"', 'и ушёл'] });
});

t('обрезанный ответ НЕ чинится молча', () => {
  // Дописывать за модель хвост нельзя: получится гайд с оборванным абзацем.
  assert.throws(() => repairJson('{"i18n":{"en":{"title":"How to buy cry'));
});

console.log('missingLangs:');

const topic = { slug: 'x', langs: ['en', 'de', 'fr'] };
const full = { slug: 'x', i18n: { en: { sections: [1] }, de: { sections: [1] }, fr: { sections: [1] } } };
const part = { slug: 'x', i18n: { en: { sections: [1] }, de: { sections: [1] } } };

t('полный гайд ничего не требует', () => {
  assert.deepStrictEqual(missingLangs(topic, full), []);
});

t('недописанный гайд возвращает недостающие языки', () => {
  assert.deepStrictEqual(missingLangs(topic, part), ['fr']);
});

t('отсутствующий гайд требует все языки темы', () => {
  assert.deepStrictEqual(missingLangs(topic, undefined), ['en', 'de', 'fr']);
});

t('язык с пустыми секциями считается ненаписанным', () => {
  assert.strictEqual(hasLang({ fr: { sections: [] } }, 'fr'), false);
  assert.deepStrictEqual(missingLangs(topic, { i18n: { en: { sections: [1] }, de: { sections: [1] }, fr: { sections: [] } } }), ['fr']);
});

console.log('isFatal:');

t('исчерпанный баланс — повторять бессмысленно', () => {
  // ровно эта ошибка съела 40 минут прогона #75: скрипт трижды повторял запрос
  // к API, у которого кончились деньги, по каждой из оставшихся тем
  assert.strictEqual(isFatal(new Error('Anthropic API 400: {"message":"Your credit balance is too low to access the Anthropic API."}')), true);
});

t('неверный ключ — повторять бессмысленно', () => {
  assert.strictEqual(isFatal(new Error('Anthropic API 401: authentication_error')), true);
});

t('таймаут — повторять СТОИТ', () => {
  assert.strictEqual(isFatal(new Error('таймаут 480 с — ответ не пришёл')), false);
});

t('кривой JSON — повторять СТОИТ', () => {
  assert.strictEqual(isFatal(new Error("Expected ',' or ']' after array element in JSON at position 8516")), false);
});

t('перегрузка API — повторять СТОИТ', () => {
  assert.strictEqual(isFatal(new Error('Anthropic API 529: overloaded_error')), false);
});

console.log('\nВсе ' + n + ' проверок прошли.');
