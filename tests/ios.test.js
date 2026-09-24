'use strict';
/* Регресс-тест iOS-бага: системные prompt/confirm блокируются в Chrome на iPhone
 * вне user-activation (таймер лонгпресса), поэтому используются только встроенные диалоги. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');

describe('ios: без системных диалогов', () => {
  it('нет вызовов prompt(', () => {
    assert.ok(!/(^|[^A-Za-z_$])prompt\s*\(/.test(appSrc), 'найден prompt(');
  });
  it('нет вызовов confirm(', () => {
    assert.ok(!/(^|[^A-Za-z_$])confirm\s*\(/.test(appSrc), 'найден confirm(');
  });
  it('есть встроенный диалог и подавление клика после лонгпресса', () => {
    assert.ok(appSrc.includes('modalBack'), 'нет modalBack');
    assert.ok(appSrc.includes('askText'), 'нет askText');
    assert.ok(appSrc.includes('afterLongPress'), 'нет afterLongPress');
  });
  it('есть диагностика нажатий: onerror и lastAction', () => {
    assert.ok(appSrc.includes("addEventListener('error'"), 'нет onerror');
    assert.ok(appSrc.includes('lastAction'), 'нет lastAction');
  });
  it('есть стек и кнопка диагностики', () => {
    assert.ok(appSrc.includes('bootStack'), 'нет bootStack');
    assert.ok(appSrc.includes('diagBtn'), 'нет diagBtn');
    assert.ok(syncSrc.includes('normalizeCatalog'), 'нет normalizeCatalog в sync');
  });
  it('мутации логики получают state.catalog, а не state', () => {
    const fns = ['setCategoryName', 'setProductName', 'incProduct', 'decProduct', 'setChecked', 'removeFromList'];
    for (const fn of fns) {
      assert.ok(!new RegExp('L\\.' + fn + '\\(state[^.]').test(appSrc), 'найден вызов ' + fn + '(state, …)');
      assert.ok(appSrc.includes('L.' + fn + '(state.catalog,'), 'нет вызова ' + fn + '(state.catalog, …)');
    }
  });
  it('версия видна на экране (шапка)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="appVerHead"'), 'нет appVerHead в шапке');
    assert.ok(appSrc.includes("el('appVerHead')"), 'версия не подставляется');
  });
  it('журнал подключён: QLJournal, публикация, скрипт', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('journal.js'), 'нет journal.js в index.html');
    assert.ok(appSrc.includes('QLJournal'), 'нет QLJournal в app');
    assert.ok(syncSrc.includes('publishFile'), 'нет publishFile в sync');
  });
  it('очистка кэша с гарантированной перезагрузкой и автообновлением', () => {
    assert.ok(appSrc.includes('clearCacheNow'), 'нет clearCacheNow');
    assert.ok(appSrc.includes('setTimeout(done, 4000)'), 'нет страховки перезагрузки');
    assert.ok(appSrc.includes('controllerchange'), 'нет автообновления');
  });
  it('конфликт записи повторяется с паузой (409/422 + backoff)', () => {
    assert.ok(/github-put \(409\|422\)/.test(syncSrc), 'нет ретрая 409/422');
    assert.ok(syncSrc.includes('backoffDelay'), 'нет backoff перед ретраем');
  });
  it('синк объединяет попродуктово', () => {
    assert.ok(syncSrc.includes('mergeCatalogs'), 'нет mergeCatalogs в sync');
    assert.ok(syncSrc.includes('bad response'), 'нет проверки тела ответа API');
    assert.ok(syncSrc.includes('fmtErr'), 'нет форматирования ошибок');
  });
});
