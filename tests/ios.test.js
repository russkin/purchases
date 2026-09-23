'use strict';
/* Регресс-тест iOS-бага: системные prompt/confirm блокируются в Chrome на iPhone
 * вне user-activation (таймер лонгпресса), поэтому используются только встроенные диалоги. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

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
});
