/* logic.js — чистая логика «Быстрого списка» без DOM.
 * Совместимость: ES2017 без optional chaining, работает в Node и в браузере (WebView Android 7).
 * Модель:
 *   catalog = { categories: [ { name: '', products: [ { name, qty, checked, checkedAt } ] } ] }
 * Пустое имя = кнопка «+». Удаление имени возвращает «+».
 */
'use strict';

var MAX_CATEGORIES = 12;
var MAX_PRODUCTS = 12;

function blankProduct() {
  return { name: '', qty: 0, checked: false, checkedAt: 0 };
}

function blankCategory() {
  var products = [];
  for (var i = 0; i < MAX_PRODUCTS; i++) products.push(blankProduct());
  return { name: '', products: products };
}

function blankCatalog() {
  var categories = [];
  for (var i = 0; i < MAX_CATEGORIES; i++) categories.push(blankCategory());
  return { categories: categories };
}

function normName(s) {
  return String(s == null ? '' : s).trim();
}

/* --- Категории / товары --- */

function setCategoryName(catalog, catIndex, name) {
  catalog.categories[catIndex].name = normName(name);
  return catalog;
}

function setProductName(catalog, catIndex, prodIndex, name) {
  catalog.categories[catIndex].products[prodIndex].name = normName(name);
  return catalog;
}

/* Нажатие на большую кнопку товара: +1, снимает отметку «куплен». */
function incProduct(catalog, catIndex, prodIndex) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.qty += 1;
  p.checked = false;
  p.checkedAt = 0;
  return p.qty;
}

/* Маленькая кнопка «−»: минимум 0. */
function decProduct(catalog, catIndex, prodIndex) {
  var p = catalog.categories[catIndex].products[prodIndex];
  if (p.qty > 0) p.qty -= 1;
  if (p.qty === 0) { p.checked = false; p.checkedAt = 0; }
  return p.qty;
}

/* Отметка в режиме списка. nowMs — миллисекунды (Date.now()). */
function setChecked(catalog, catIndex, prodIndex, checked, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.checked = !!checked;
  p.checkedAt = checked ? (nowMs || Date.now()) : 0;
  return p;
}

/* Долгое нажатие в списке: удалить товар из списка насовсем (имя в справочнике остаётся). */
function removeFromList(catalog, catIndex, prodIndex) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.qty = 0;
  p.checked = false;
  p.checkedAt = 0;
  return catalog;
}

/* Кнопка «Очистить список»: обнулить количества и отметки, имена оставить. */
function clearList(catalog) {
  catalog.categories.forEach(function (c) {
    c.products.forEach(function (p) {
      p.qty = 0;
      p.checked = false;
      p.checkedAt = 0;
    });
  });
  return catalog;
}

/* Кнопка «Очистить все кнопки»: сброс имён категорий и товаров. */
function clearAll(catalog) {
  catalog.categories.forEach(function (c) {
    c.name = '';
    c.products.forEach(function (p) {
      p.name = '';
      p.qty = 0;
      p.checked = false;
      p.checkedAt = 0;
    });
  });
  return catalog;
}

/* --- Полуночная очистка --- */

function startOfDayMs(nowMs) {
  var d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* Удалить отмеченные товары, отмеченные до начала текущих суток. */
function purgeChecked(catalog, nowMs) {
  var dayStart = startOfDayMs(nowMs);
  var removed = 0;
  catalog.categories.forEach(function (c) {
    c.products.forEach(function (p) {
      if (p.checked && p.checkedAt < dayStart) {
        p.qty = 0;
        p.checked = false;
        p.checkedAt = 0;
        removed += 1;
      }
    });
  });
  return removed;
}

/* --- Представление для режима списка --- */

function isListed(p) {
  return p.qty > 0 || p.checked;
}

/* Группы для рендера: сначала категории с активными товарами,
 * затем полностью отмеченные, пустые категории исключаются.
 * Внутри категории: неотмеченные, затем отмеченные (в конец). */
function listView(catalog) {
  var groups = [];
  catalog.categories.forEach(function (c, ci) {
    var items = [];
    c.products.forEach(function (p, pi) {
      if (isListed(p)) items.push({ catIndex: ci, prodIndex: pi, product: p });
    });
    if (items.length === 0) return;
    var active = items.filter(function (it) { return !it.product.checked; });
    var done = items.filter(function (it) { return it.product.checked; });
    groups.push({
      catIndex: ci,
      name: c.name,
      items: active.concat(done),
      allChecked: active.length === 0,
      activeCount: active.length
    });
  });
  var head = groups.filter(function (g) { return !g.allChecked; });
  var tail = groups.filter(function (g) { return g.allChecked; });
  return head.concat(tail);
}

function activeCount(catalog) {
  var n = 0;
  catalog.categories.forEach(function (c) {
    c.products.forEach(function (p) {
      if (p.qty > 0 && !p.checked) n += 1;
    });
  });
  return n;
}

var api = {
  MAX_CATEGORIES: MAX_CATEGORIES,
  MAX_PRODUCTS: MAX_PRODUCTS,
  blankProduct: blankProduct,
  blankCategory: blankCategory,
  blankCatalog: blankCatalog,
  setCategoryName: setCategoryName,
  setProductName: setProductName,
  incProduct: incProduct,
  decProduct: decProduct,
  setChecked: setChecked,
  removeFromList: removeFromList,
  clearList: clearList,
  clearAll: clearAll,
  startOfDayMs: startOfDayMs,
  purgeChecked: purgeChecked,
  listView: listView,
  activeCount: activeCount
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.QLLogic = api;
}
