'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

function demo() {
  const c = L.blankCatalog();
  L.setCategoryName(c, 0, 'Молочка');
  L.setProductName(c, 0, 0, 'Молоко');
  L.setProductName(c, 0, 1, 'Кефир');
  L.setCategoryName(c, 1, 'Хлеб');
  L.setProductName(c, 1, 0, 'Батон');
  return c;
}

describe('каталог: имена и кнопки +', () => {
  it('пустой каталог 12x12', () => {
    const c = L.blankCatalog();
    assert.equal(c.categories.length, 12);
    assert.equal(c.categories[0].products.length, 12);
    assert.equal(c.categories[0].name, '');
  });
  it('переименование и сброс в +', () => {
    const c = L.blankCatalog();
    L.setCategoryName(c, 0, '  Молочка ');
    assert.equal(c.categories[0].name, 'Молочка');
    L.setCategoryName(c, 0, '   ');
    assert.equal(c.categories[0].name, '');
    L.setProductName(c, 0, 0, 'Молоко');
    assert.equal(c.categories[0].products[0].name, 'Молоко');
  });
});

describe('количества: + и −', () => {
  it('inc/dec, минимум 0', () => {
    const c = demo();
    assert.equal(L.incProduct(c, 0, 0), 1);
    assert.equal(L.incProduct(c, 0, 0), 2);
    assert.equal(L.decProduct(c, 0, 0), 1);
    assert.equal(L.decProduct(c, 0, 0), 0);
    assert.equal(L.decProduct(c, 0, 0), 0);
  });
  it('inc снимает отметку', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.setChecked(c, 0, 0, true, 1000);
    assert.equal(c.categories[0].products[0].checked, true);
    L.incProduct(c, 0, 0);
    assert.equal(c.categories[0].products[0].checked, false);
  });
});

describe('режим списка', () => {
  it('отметка уводит товар в конец категории', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.incProduct(c, 0, 1);
    L.setChecked(c, 0, 0, true, 1000);
    const g = L.listView(c).find((x) => x.catIndex === 0);
    assert.equal(g.items[0].prodIndex, 1);
    assert.equal(g.items[1].prodIndex, 0);
  });
  it('полностью отмеченная категория уходит вниз', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.incProduct(c, 1, 0);
    L.setChecked(c, 0, 0, true, 1000);
    const v = L.listView(c);
    assert.equal(v[v.length - 1].catIndex, 0);
    assert.equal(v[v.length - 1].allChecked, true);
  });
  it('снятие отметки возвращает товар', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.setChecked(c, 0, 0, true, 1000);
    L.setChecked(c, 0, 0, false);
    const g = L.listView(c).find((x) => x.catIndex === 0);
    assert.equal(g.allChecked, false);
    assert.equal(g.items[0].product.checked, false);
  });
  it('долгое нажатие удаляет из списка, имя остаётся', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.removeFromList(c, 0, 0);
    assert.equal(c.categories[0].products[0].qty, 0);
    assert.equal(c.categories[0].products[0].name, 'Молоко');
  });
});

describe('очистки и полуночное удаление', () => {
  it('clearList сбрасывает количества, имена оставляет', () => {
    const c = demo();
    L.incProduct(c, 0, 0);
    L.clearList(c);
    assert.equal(c.categories[0].products[0].qty, 0);
    assert.equal(c.categories[0].products[0].name, 'Молоко');
    assert.equal(c.categories[0].name, 'Молочка');
  });
  it('clearAll сбрасывает и имена', () => {
    const c = demo();
    L.clearAll(c);
    assert.equal(c.categories[0].name, '');
    assert.equal(c.categories[0].products[0].name, '');
  });
  it('purgeChecked удаляет вчерашние отметки, сегодняшние оставляет', () => {
    const c = demo();
    const now = new Date(2026, 8, 23, 12, 0, 0).getTime();
    const yesterday = now - 24 * 3600 * 1000;
    L.incProduct(c, 0, 0);
    L.incProduct(c, 0, 1);
    L.setChecked(c, 0, 0, true, yesterday);
    L.setChecked(c, 0, 1, true, now);
    const removed = L.purgeChecked(c, now);
    assert.equal(removed, 1);
    assert.equal(c.categories[0].products[0].qty, 0);
    assert.equal(c.categories[0].products[1].qty, 1);
  });
});

describe('mergeDecision: пустое не затирает непустое', () => {
  const st = (catalog, t) => ({ catalog, updatedAt: t });
  it('локально пусто, удалённо seed → pull', () => {
    assert.equal(L.mergeDecision(st(L.blankCatalog(), 200), st(L.seedCatalog(), 100)), 'pull');
  });
  it('локально seed, удалённо пусто → push', () => {
    assert.equal(L.mergeDecision(st(L.seedCatalog(), 100), st(L.blankCatalog(), 200)), 'push');
  });
  it('оба непустые → побеждает newer', () => {
    const a = st(L.seedCatalog(), 100);
    const b = st(L.seedCatalog(), 200);
    assert.equal(L.mergeDecision(a, b), 'pull');
    assert.equal(L.mergeDecision(b, a), 'push');
    assert.equal(L.mergeDecision(a, st(L.seedCatalog(), 100)), 'in-sync');
  });
  it('оба пустые → решает время (равное время → in-sync)', () => {
    assert.equal(L.mergeDecision(st(L.blankCatalog(), 100), st(L.blankCatalog(), 100)), 'in-sync');
    assert.equal(L.mergeDecision(st(L.blankCatalog(), 300), st(L.blankCatalog(), 100)), 'push');
  });
});
describe('seed-каталог', () => {
  it('seedCatalog: 7 категорий с товарами, количества нулевые', () => {
    const c = L.seedCatalog();
    assert.equal(c.categories[0].name, 'Молочка');
    assert.equal(c.categories[0].products[0].name, 'Молоко');
    assert.equal(c.categories[1].name, 'Хлеб');
    assert.equal(c.categories[6].name, 'Бытовая химия');
    assert.equal(c.categories[7].name, '');
    assert.equal(c.categories[0].products[0].qty, 0);
    assert.equal(L.activeCount(c), 0);
  });
  it('fillEmptyNames не трогает занятые имена и количества', () => {
    const c = L.blankCatalog();
    L.setCategoryName(c, 0, 'Своя');
    L.setProductName(c, 0, 1, 'Свой товар');
    L.incProduct(c, 1, 0);
    const filled = L.fillEmptyNames(c);
    assert.ok(filled > 0);
    assert.equal(c.categories[0].name, 'Своя');
    assert.equal(c.categories[0].products[0].name, 'Молоко');
    assert.equal(c.categories[0].products[1].name, 'Свой товар');
    assert.equal(c.categories[1].products[0].qty, 1);
    assert.equal(c.categories[1].products[0].name, 'Батон');
  });
});
