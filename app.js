/* app.js — интерфейс «Быстрого списка»: режимы добавления и списка. */
'use strict';

(function () {
  var LONGPRESS_MS = 3000;
  var L = window.QLLogic;
  var state = null;
  var selectedCat = null;
  var syncStatus = '';

  function el(id) { return document.getElementById(id); }

  function longPress(node, fn) {
    var timer = null;
    function start(e) {
      if (e && e.type === 'mousedown' && e.button !== 0) return;
      timer = setTimeout(function () { timer = null; fn(); }, LONGPRESS_MS);
    }
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function save() {
    window.QLStore.save(state).then(function () {
      renderStatus();
      scheduleSync();
    });
  }

  var syncTimer = null;
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(doSync, 5000);
  }

  function doSync() {
    if (!state.settings.token) { syncStatus = ''; renderStatus(); return; }
    syncStatus = 'синхронизация…';
    renderStatus();
    window.QLSync.syncNow(state).then(function (res) {
      syncStatus = res.status === 'error' ? ('ошибка синка: ' + res.error) : ('синк: ' + res.status);
      state = res.state;
      return window.QLStore.save(state);
    }).then(render);
  }

  /* --- Режим добавления --- */

  function catButton(c, ci) {
    var b = document.createElement('div');
    b.className = 'btn' + (c.name ? '' : ' empty');
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = c.name || '+';
    b.appendChild(label);
    b.addEventListener('click', function () {
      if (!c.name) {
        var name = prompt('Название категории:');
        if (name === null) return;
        L.setCategoryName(state, ci, name);
        save(); render();
      } else {
        selectedCat = ci;
        render();
      }
    });
    longPress(b, function () {
      var name = prompt('Название категории (пусто — убрать):', c.name);
      if (name === null) return;
      L.setCategoryName(state, ci, name);
      save(); render();
    });
    return b;
  }

  function prodButton(c, ci, p, pi) {
    var b = document.createElement('div');
    b.className = 'btn' + (p.name ? '' : ' empty');
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = p.name || '+';
    b.appendChild(label);
    if (p.name && p.qty > 0) {
      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = String(p.qty);
      b.appendChild(badge);
    }
    if (p.name) {
      var minus = document.createElement('button');
      minus.className = 'minus';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Уменьшить');
      minus.addEventListener('click', function (e) {
        e.stopPropagation();
        L.decProduct(state, ci, pi);
        save(); render();
      });
      b.appendChild(minus);
    }
    b.addEventListener('click', function () {
      if (!p.name) {
        var name = prompt('Название товара:');
        if (name === null) return;
        L.setProductName(state, ci, pi, name);
        save(); render();
      } else {
        L.incProduct(state, ci, pi);
        save(); render();
      }
    });
    longPress(b, function () {
      var name = prompt('Название товара (пусто — убрать):', p.name);
      if (name === null) return;
      L.setProductName(state, ci, pi, name);
      save(); render();
    });
    return b;
  }

  function renderAdd() {
    var grid = el('grid');
    grid.innerHTML = '';
    var crumb = el('crumb');
    crumb.innerHTML = '';
    if (selectedCat === null) {
      state.catalog.categories.forEach(function (c, ci) {
        grid.appendChild(catButton(c, ci));
      });
    } else {
      var back = document.createElement('button');
      back.textContent = '← Категории';
      back.addEventListener('click', function () { selectedCat = null; render(); });
      crumb.appendChild(back);
      var title = document.createElement('span');
      title.textContent = ' ' + (state.catalog.categories[selectedCat].name || 'Категория');
      crumb.appendChild(title);
      var c = state.catalog.categories[selectedCat];
      c.products.forEach(function (p, pi) {
        grid.appendChild(prodButton(c, selectedCat, p, pi));
      });
    }
  }

  /* --- Режим списка --- */

  function renderList() {
    var box = el('groups');
    box.innerHTML = '';
    var groups = L.listView(state.catalog);
    if (groups.length === 0) {
      var empty = document.createElement('p');
      empty.textContent = 'Список пуст. Добавьте товары в режиме добавления.';
      box.appendChild(empty);
      return;
    }
    groups.forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'group' + (g.allChecked ? ' done' : '');
      var ht = document.createElement('div');
      ht.className = 'group-title';
      ht.textContent = (g.name || 'Без категории') + ':';
      h.appendChild(ht);
      g.items.forEach(function (it) {
        var row = document.createElement('label');
        row.className = 'row' + (it.product.checked ? ' done' : '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = it.product.checked;
        cb.addEventListener('change', function () {
          L.setChecked(state, it.catIndex, it.prodIndex, cb.checked, Date.now());
          save(); render();
        });
        var nm = document.createElement('span');
        nm.className = 'row-name';
        nm.textContent = it.product.name || 'Товар';
        var qty = document.createElement('span');
        qty.className = 'row-qty';
        qty.textContent = it.product.qty > 0 ? ('×' + it.product.qty) : '';
        row.appendChild(cb);
        row.appendChild(nm);
        row.appendChild(qty);
        longPress(row, function () {
          L.removeFromList(state, it.catIndex, it.prodIndex);
          save(); render();
        });
        h.appendChild(row);
      });
      box.appendChild(h);
    });
  }

  function renderStatus() {
    var parts = [];
    parts.push('Активных: ' + L.activeCount(state.catalog));
    parts.push(navigator.onLine ? 'online' : 'offline');
    if (syncStatus) parts.push(syncStatus);
    el('status').textContent = parts.join(' · ');
    el('netStatus').textContent = navigator.onLine ? '●' : '○';
  }

  function render() {
    var isAdd = state.settings.mode === 'add';
    el('screen-add').style.display = isAdd ? '' : 'none';
    el('screen-list').style.display = isAdd ? 'none' : '';
    el('modeAdd').classList.toggle('on', isAdd);
    el('modeList').classList.toggle('on', !isAdd);
    if (isAdd) renderAdd(); else renderList();
    renderStatus();
  }

  function wire() {
    el('menuBtn').addEventListener('click', function () {
      el('drawer').classList.toggle('open');
    });
    el('modeAdd').addEventListener('click', function () {
      state.settings.mode = 'add'; selectedCat = null; save(); render();
    });
    el('modeList').addEventListener('click', function () {
      state.settings.mode = 'list'; save(); render();
    });
    el('clearList').addEventListener('click', function () {
      if (!confirm('Очистить список? Количества и отметки будут сброшены.')) return;
      L.clearList(state.catalog);
      save(); render();
    });
    el('clearAll').addEventListener('click', function () {
      if (!confirm('Очистить ВСЕ кнопки? Названия категорий и товаров будут удалены.')) return;
      L.clearAll(state.catalog);
      selectedCat = null;
      save(); render();
    });
    el('saveSettings').addEventListener('click', function () {
      state.settings.repo = el('repoInput').value.trim() || 'russkin/purchases';
      state.settings.token = el('tokenInput').value.trim();
      save(); render();
    });
    el('syncBtn').addEventListener('click', doSync);
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state) {
        L.purgeChecked(state.catalog, Date.now());
        render();
      }
    });
  }

  function init() {
    wire();
    window.QLStore.load().then(function (s) {
      state = s;
      L.purgeChecked(state.catalog, Date.now());
      el('repoInput').value = state.settings.repo || '';
      el('tokenInput').value = state.settings.token || '';
      render();
      return window.QLStore.save(state);
    }).then(function () {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
