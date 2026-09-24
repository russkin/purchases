'use strict';
/* Тесты журнала синхронизации: кольцевой буфер, персистентность, device id. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const factory = require('../journal.js');

function memStorage(broken) {
  const m = {};
  return {
    getItem: (k) => {
      if (broken) throw new Error('denied');
      return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
    },
    setItem: (k, v) => {
      if (broken) throw new Error('denied');
      m[k] = String(v);
    },
    _raw: m
  };
}

describe('journal', () => {
  it('push/list roundtrip', () => {
    const j = factory(memStorage());
    j.push('sync', 'pulled');
    j.push('sync', 'pushed');
    const list = j.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].type, 'sync');
    assert.equal(list[1].text, 'pushed');
    assert.ok(list[0].t > 0);
  });

  it('кольцо: хранит последние MAX', () => {
    const j = factory(memStorage());
    for (let i = 0; i < j.MAX + 5; i++) j.push('sync', 'e' + i);
    const list = j.list();
    assert.equal(list.length, j.MAX);
    assert.equal(list[0].text, 'e5');
    assert.equal(list[list.length - 1].text, 'e' + (j.MAX + 4));
  });

  it('текст обрезается до 300 символов', () => {
    const j = factory(memStorage());
    j.push('sync', 'x'.repeat(500));
    assert.equal(j.list()[0].text.length, 300);
  });

  it('deviceId стабилен в рамках хранилища', () => {
    const s = memStorage();
    const j = factory(s);
    const a = j.deviceId();
    const b = j.deviceId();
    assert.ok(/^[0-9a-f]{1,8}$/.test(a));
    assert.equal(a, b);
  });

  it('битое хранилище не роняет: пустой журнал, nodev', () => {
    const j = factory(memStorage(true));
    assert.deepEqual(j.list(), []);
    assert.equal(j.deviceId(), 'nodev');
    j.push('sync', 'x'); // не должно бросать
    assert.deepEqual(j.list(), []);
  });

  it('битый JSON в ключе — пустой список', () => {
    const s = memStorage();
    s._raw['quicklist-journal-v1'] = '###not-json';
    const j = factory(s);
    assert.deepEqual(j.list(), []);
  });

  it('без хранилища работает в памяти вызова', () => {
    const j = factory(null);
    assert.deepEqual(j.list(), []);
    assert.equal(j.deviceId(), 'nodev');
  });
});
