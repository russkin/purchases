/* logic.js — чистая логика «Быстрого списка» без DOM.
 * Совместимость: ES2017 без optional chaining, работает в Node и в браузере (WebView Android 7).
 * Модель:
 *   catalog = { categories: [ { name: '', products: [ { name, qty, checked, checkedAt } ] } ] }
 * Пустое имя = кнопка «+». Удаление имени возвращает «+».
 */
'use strict';

var MAX_CATEGORIES = 20;
var MAX_PRODUCTS = 20;

function blankProduct() {
  return { name: '', qty: 0, checked: false, checkedAt: 0, ts: 0 };
}

function blankCategory() {
  var products = [];
  for (var i = 0; i < MAX_PRODUCTS; i++) products.push(blankProduct());
  return { name: '', products: products, ts: 0 };
}

function blankCatalog() {
  var categories = [];
  for (var i = 0; i < MAX_CATEGORIES; i++) categories.push(blankCategory());
  return { categories: categories };
}

/* Стартовый каталог для новых установок: заполняет только имена,
 * количества нулевые. С var SEED = [ [категория, [товары...]], ... ]. */
var SEED = [
  ['Молочка', ['Молоко', 'Кефир', 'Йогурт', 'Сыр', 'Масло', 'Творог', 'Сметана', 'Яйца']],
  ['Хлеб', ['Батон', 'Чёрный хлеб', 'Лаваш', 'Булочки']],
  ['Овощи', ['Картофель', 'Морковь', 'Лук', 'Помидоры', 'Огурцы', 'Зелень']],
  ['Фрукты', ['Яблоки', 'Бананы', 'Апельсины', 'Лимоны']],
  ['Мясо и рыба', ['Курица', 'Фарш', 'Рыба', 'Колбаса', 'Сосиски']],
  ['Крупы', ['Гречка', 'Рис', 'Макароны', 'Овсянка', 'Мука', 'Сахар']],
  ['Бытовая химия', ['Порошок', 'Мыло', 'Шампунь', 'Туалетная бумага']]
];

function seedCatalog() {
  var catalog = blankCatalog();
  fillEmptyNames(catalog);
  return catalog;
}

/* Заполняет ПУСТЫЕ имена категорий/товаров из SEED.
 * Количества, отметки и непустые имена не трогает.
 * Возвращает число заполненных ячеек. */
function fillEmptyNames(catalog) {
  var filled = 0;
  SEED.forEach(function (entry, ci) {
    var c = catalog.categories[ci];
    if (!c) return;
    if (!c.name) { c.name = entry[0]; filled += 1; }
    entry[1].forEach(function (name, pi) {
      var p = c.products[pi];
      if (p && !p.name) { p.name = name; filled += 1; }
    });
  });
  return filled;
}

function normName(s) {
  return String(s == null ? '' : s).trim();
}

/* --- Категории / товары --- */

function setCategoryName(catalog, catIndex, name, nowMs) {
  var c = catalog.categories[catIndex];
  c.name = normName(name);
  c.ts = nowMs || Date.now();
  return catalog;
}

function setProductName(catalog, catIndex, prodIndex, name, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.name = normName(name);
  p.ts = nowMs || Date.now();
  return catalog;
}

/* Нажатие на большую кнопку товара: +1, снимает отметку «куплен». */
function incProduct(catalog, catIndex, prodIndex, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.qty += 1;
  p.checked = false;
  p.checkedAt = 0;
  p.ts = nowMs || Date.now();
  return p.qty;
}

/* Маленькая кнопка «−»: минимум 0. */
function decProduct(catalog, catIndex, prodIndex, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  if (p.qty > 0) p.qty -= 1;
  if (p.qty === 0) { p.checked = false; p.checkedAt = 0; }
  p.ts = nowMs || Date.now();
  return p.qty;
}

/* Отметка в режиме списка. nowMs — миллисекунды (Date.now()). */
function setChecked(catalog, catIndex, prodIndex, checked, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.checked = !!checked;
  p.checkedAt = checked ? (nowMs || Date.now()) : 0;
  p.ts = nowMs || Date.now();
  return p;
}

/* Долгое нажатие в списке: удалить товар из списка насовсем (имя в справочнике остаётся). */
function removeFromList(catalog, catIndex, prodIndex, nowMs) {
  var p = catalog.categories[catIndex].products[prodIndex];
  p.qty = 0;
  p.checked = false;
  p.checkedAt = 0;
  p.ts = nowMs || Date.now();
  return catalog;
}

/* Ручная сортировка: перенос элемента на позицию to со сдвигом остальных.
 * Слияние позиционное, поэтому свежая метка ts ставится ВСЕМ ячейкам
 * затронутого диапазона — иначе чужой порядок или старые данные победят.
 * У категорий едут и товары целиком (им тоже свежая ts), иначе на принимающем
 * устройстве имя возьмётся из нового порядка, а товары останутся из старого.
 * Вне диапазона и from===to — ничего не делает. */
function moveCategory(catalog, from, to, nowMs) {
  var t = nowMs || Date.now();
  var cats = catalog.categories;
  if (from < 0 || from >= cats.length || to < 0 || to >= cats.length || from === to) return catalog;
  var item = cats.splice(from, 1)[0];
  cats.splice(to, 0, item);
  var lo = Math.min(from, to);
  var hi = Math.max(from, to);
  for (var i = lo; i <= hi; i++) {
    cats[i].ts = t;
    cats[i].products.forEach(function (p) { p.ts = t; });
  }
  return catalog;
}

function moveProduct(catalog, catIndex, from, to, nowMs) {
  var t = nowMs || Date.now();
  var prods = catalog.categories[catIndex].products;
  if (from < 0 || from >= prods.length || to < 0 || to >= prods.length || from === to) return catalog;
  var item = prods.splice(from, 1)[0];
  prods.splice(to, 0, item);
  var lo = Math.min(from, to);
  var hi = Math.max(from, to);
  for (var i = lo; i <= hi; i++) prods[i].ts = t;
  return catalog;
}

/* Кнопка «Очистить список»: обнулить количества и отметки, имена оставить. */
function clearList(catalog, nowMs) {
  var t = nowMs || Date.now();
  catalog.categories.forEach(function (c) {
    c.products.forEach(function (p) {
      p.qty = 0;
      p.checked = false;
      p.checkedAt = 0;
      p.ts = t;
    });
  });
  return catalog;
}

/* Кнопка «Очистить все кнопки»: сброс имён категорий и товаров. */
function clearAll(catalog, nowMs) {
  var t = nowMs || Date.now();
  catalog.categories.forEach(function (c) {
    c.name = '';
    c.ts = t;
    c.products.forEach(function (p) {
      p.name = '';
      p.qty = 0;
      p.checked = false;
      p.checkedAt = 0;
      p.ts = t;
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
        p.ts = nowMs;
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

/* Текст для «Поделиться списком»: звёздочка перед категорией,
 * каждый товар с новой строки, после названия — тире и количество. */
function shareText(catalog) {
  var lines = [];
  listView(catalog).forEach(function (g) {
    lines.push('* ' + (g.name || 'Без категории'));
    g.items.forEach(function (it) {
      var p = it.product;
      lines.push(p.qty > 0 ? ((p.name || 'Товар') + ' - ' + p.qty) : (p.name || 'Товар'));
    });
  });
  return lines.join('\n');
}

/* --- Нормализация (защита от битых данных старых версий/синка) --- */

function normalizeProduct(p) {
  if (!p || typeof p !== 'object') p = {};
  var qty = parseInt(p.qty, 10);
  if (!(qty > 0)) qty = 0;
  var checked = !!p.checked;
  var checkedAt = parseInt(p.checkedAt, 10);
  if (!(checkedAt > 0)) checkedAt = 0;
  var ts = parseInt(p.ts, 10);
  if (!(ts > 0)) ts = 0;
  return { name: normName(p.name), qty: qty, checked: checked, checkedAt: checked ? checkedAt : 0, ts: ts };
}

function normalizeCategory(c) {
  if (!c || typeof c !== 'object') c = {};
  var src = Array.isArray(c.products) ? c.products : [];
  var products = [];
  for (var i = 0; i < MAX_PRODUCTS; i++) products.push(normalizeProduct(src[i]));
  var ts = parseInt(c.ts, 10);
  if (!(ts > 0)) ts = 0;
  return { name: normName(c.name), products: products, ts: ts };
}

/* Приводит любой вход к форме 20×20, сохраняя имеющиеся данные. */
function normalizeCatalog(catalog) {
  var src = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];
  var categories = [];
  for (var i = 0; i < MAX_CATEGORIES; i++) categories.push(normalizeCategory(src[i]));
  return { categories: categories };
}

/* --- Попродуктовое слияние --- */

/* Для каждой ячейки (товар, название категории) побеждает запись
 * с более свежей меткой ts; при равных метках — локальная.
 * Устаревшие/пустые данные (ts=0) реальные правки не затирают. */
function cloneProduct(p) {
  return { name: p.name, qty: p.qty, checked: p.checked, checkedAt: p.checkedAt, ts: p.ts || 0 };
}

function isProductEmpty(p) {
  return !p.name && !(p.qty > 0) && !p.checked;
}

function mergeProduct(local, remote) {
  var lt = local.ts || 0;
  var rt = remote.ts || 0;
  if (rt > lt) return cloneProduct(remote);
  if (lt > rt) return cloneProduct(local);
  // равные метки: пустое не затирает непустое, иначе локальное
  if (isProductEmpty(local) && !isProductEmpty(remote)) return cloneProduct(remote);
  return cloneProduct(local);
}

function mergeCategory(local, remote) {
  var lt = local.ts || 0;
  var rt = remote.ts || 0;
  var name;
  var ts;
  if (rt > lt) { name = remote.name; ts = rt; }
  else if (lt > rt) { name = local.name; ts = lt; }
  else if (!local.name && remote.name) { name = remote.name; ts = rt; }
  else { name = local.name; ts = lt; }
  var products = [];
  for (var i = 0; i < MAX_PRODUCTS; i++) {
    products.push(mergeProduct(local.products[i], remote.products[i]));
  }
  return { name: name, products: products, ts: ts };
}

function mergeCatalogs(localCatalog, remoteCatalog) {
  var a = normalizeCatalog(localCatalog);
  var b = normalizeCatalog(remoteCatalog);
  var categories = [];
  for (var i = 0; i < MAX_CATEGORIES; i++) {
    categories.push(mergeCategory(a.categories[i], b.categories[i]));
  }
  return { categories: categories };
}

function catalogsEqual(a, b) {
  return JSON.stringify(normalizeCatalog(a)) === JSON.stringify(normalizeCatalog(b));
}

/* --- Решение о слиянии локального и удалённого состояний --- */

function isCatalogEmpty(catalog) {
  if (!catalog || !catalog.categories) return true;
  for (var i = 0; i < catalog.categories.length; i++) {
    var c = catalog.categories[i];
    if (c.name) return false;
    for (var j = 0; j < c.products.length; j++) {
      if (c.products[j].name) return false;
    }
  }
  return true;
}

/* Пустое состояние никогда не затирает непустое (защита от рассинхрона часов
 * и случайных очисток): 'pull' | 'push' | 'in-sync'. */
function mergeDecision(localState, remoteState) {
  var localEmpty = isCatalogEmpty(localState.catalog);
  var remoteEmpty = isCatalogEmpty(remoteState.catalog);
  if (localEmpty && !remoteEmpty) return 'pull';
  if (!localEmpty && remoteEmpty) return 'push';
  var rTime = remoteState.updatedAt || 0;
  var lTime = localState.updatedAt || 0;
  if (rTime > lTime) return 'pull';
  if (lTime > rTime) return 'push';
  return 'in-sync';
}

var api = {
  MAX_CATEGORIES: MAX_CATEGORIES,
  MAX_PRODUCTS: MAX_PRODUCTS,
  blankProduct: blankProduct,
  blankCategory: blankCategory,
  blankCatalog: blankCatalog,
  seedCatalog: seedCatalog,
  fillEmptyNames: fillEmptyNames,
  setCategoryName: setCategoryName,
  setProductName: setProductName,
  incProduct: incProduct,
  decProduct: decProduct,
  setChecked: setChecked,
  removeFromList: removeFromList,
  moveCategory: moveCategory,
  moveProduct: moveProduct,
  clearList: clearList,
  clearAll: clearAll,
  startOfDayMs: startOfDayMs,
  purgeChecked: purgeChecked,
  listView: listView,
  activeCount: activeCount,
  shareText: shareText,
  isCatalogEmpty: isCatalogEmpty,
  mergeDecision: mergeDecision,
  normalizeProduct: normalizeProduct,
  normalizeCategory: normalizeCategory,
  normalizeCatalog: normalizeCatalog,
  mergeProduct: mergeProduct,
  isProductEmpty: isProductEmpty,
  mergeCategory: mergeCategory,
  mergeCatalogs: mergeCatalogs,
  catalogsEqual: catalogsEqual
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.QLLogic = api;
}
