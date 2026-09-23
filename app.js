/* app.js — интерфейс «Быстрого списка»: режимы добавления и списка. */
'use strict';

(function () {
  var LONGPRESS_MS = 3000;
  var APP_VERSION = 'v25';
  var L = window.QLLogic;
  var state = null;
  var selectedCat = null;
  var syncStatus = '';
  var lastAction = '';
  var bootError = '';
  var bootStack = '';

  function el(id) { return document.getElementById(id); }

  window.addEventListener('error', function (e) {
    var msg = (e && e.message) ? e.message : String(e);
    var stack = '';
    try {
      if (e && e.error && e.error.stack) stack = String(e.error.stack);
    } catch (x) { stack = ''; }
    if (!stack) stack = 'at ' + ((e && e.filename) ? e.filename : '?') + ':' + ((e && e.lineno) ? e.lineno : '?');
    bootError = 'ОШИБКА: ' + msg;
    bootStack = stack.slice(0, 1500);
    try { renderStatus(); } catch (err) {
      var s = document.getElementById('status');
      if (s) s.textContent = bootError;
    }
  });

  function longPress(node, fn) {
    var timer = null;
    function start(e) {
      if (e && e.type === 'mousedown' && e.button !== 0) return;
      timer = setTimeout(function () {
        timer = null;
        node.__lpFiredAt = Date.now();
        fn();
      }, LONGPRESS_MS);
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

  /* Клик, пришедший следом за сработавшим лонгпрессом (особенность тач-браузеров), игнорируем. */
  function afterLongPress(node) {
    return Date.now() - (node.__lpFiredAt || 0) < 800;
  }

  /* Встроенный диалог: на iOS Chrome системный prompt/confirm из отложенных
   * обработчиков (таймер лонгпресса) блокируется, поэтому своё модальное окно. */
  var modalResolve = null;
  function closeModal(value) {
    el('modalBack').classList.remove('open');
    el('modalCancel').style.display = '';
    el('modalClear').style.display = 'none';
    var r = modalResolve;
    modalResolve = null;
    if (r) r(value);
  }
  function askText(title, initial, showInput, showClear) {
    el('modalText').textContent = title;
    var input = el('modalInput');
    input.style.display = showInput === false ? 'none' : '';
    input.value = initial || '';
    el('modalOk').textContent = showInput === false ? 'OK' : 'Сохранить';
    el('modalClear').style.display = showClear ? '' : 'none';
    el('modalBack').classList.add('open');
    setTimeout(function () { if (showInput !== false) input.focus(); }, 50);
    return new Promise(function (resolve) { modalResolve = resolve; });
  }
  function askConfirm(title) {
    return askText(title, '', false).then(function (v) { return v === true; });
  }
  function showInfo(title, body) {
    el('modalText').textContent = title + '\n\n' + body;
    el('modalInput').style.display = 'none';
    el('modalOk').textContent = 'OK';
    el('modalClear').style.display = 'none';
    el('modalCancel').style.display = 'none';
    el('modalBack').classList.add('open');
    return new Promise(function (resolve) { modalResolve = resolve; });
  }
  function diagText() {
    var lines = [];
    lines.push('Версия: ' + APP_VERSION);
    if (!state) return 'Состояние не загружено.';
    lines.push('Режим: ' + state.settings.mode);
    lines.push('Категорий: ' + state.catalog.categories.length);
    lines.push('Выбрана: ' + selectedCat);
    lines.push('Активных: ' + L.activeCount(state.catalog));
    lines.push('updatedAt: ' + state.updatedAt);
    lines.push('Синк: ' + (syncStatus || '—'));
    lines.push('Действие: ' + (lastAction || '—'));
    lines.push('Ошибка: ' + (bootError || 'нет'));
    if (bootStack) lines.push('Стек:\n' + bootStack);
    return lines.join('\n');
  }
  function wireModal() {
    el('modalOk').addEventListener('click', function () {
      var input = el('modalInput');
      if (input.style.display === 'none') closeModal(true);
      else closeModal(input.value);
    });
    el('modalCancel').addEventListener('click', function () {
      var input = el('modalInput');
      closeModal(input.style.display === 'none' ? false : null);
    });
    el('modalClear').addEventListener('click', function () {
      closeModal('');
    });
  }

  var saveError = '';
  function save() {
    window.QLStore.save(state).then(function (ok) {
      saveError = ok ? '' : 'НЕ СОХРАНЕНО (память браузера недоступна)';
      renderStatus();
      scheduleSync();
    });
  }

  var syncTimer = null;
  /* Синк после каждого изменения (с коротким debounce, чтобы серия
   * быстрых нажатий уходила одним запросом). */
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(doSync, 2000);
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

  /* Очистка кэша с видимым прогрессом и гарантированной перезагрузкой:
   * даже если какой-то шаг зависнет, страница перезагрузится по таймеру. */
  function clearCacheNow() {
    var reloaded = false;
    function done() {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    }
    setTimeout(done, 4000);
    try {
      syncStatus = 'чищу кэш…';
      renderStatus();
      var p = Promise.resolve();
      if ('caches' in window) {
        p = p.then(function () { return window.caches.keys(); }).then(function (keys) {
          syncStatus = 'кэш: ' + keys.length + ' зап., удаляю…';
          renderStatus();
          return Promise.all(keys.map(function (k) { return window.caches.delete(k); }));
        });
      }
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        p = p.then(function () { return navigator.serviceWorker.getRegistrations(); })
          .then(function (regs) {
            syncStatus = 'воркеров: ' + regs.length + '…';
            renderStatus();
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          });
      }
      p.then(function () {
        syncStatus = 'перезагрузка…';
        renderStatus();
        setTimeout(done, 400);
      }).catch(done);
    } catch (e) {
      done();
    }
  }

  /* --- Режим добавления --- */

  function catButton(c, ci) {
    var b = document.createElement('div');
    var hasActive = c.products.some(function (p) { return p.qty > 0; });
    b.className = 'btn' + (c.name ? '' : ' empty') + (hasActive ? ' has-active' : '');
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = c.name || '+';
    b.appendChild(label);
    b.addEventListener('click', function () {
      if (afterLongPress(b)) return;
      if (!c.name) {
        askText('Название категории:').then(function (name) {
          if (name === null) return;
          L.setCategoryName(state.catalog, ci, name);
          save(); render();
        });
      } else {
        selectedCat = ci;
        render();
      }
    });
    longPress(b, function () {
      askText('Новое название категории:', c.name, true, true).then(function (name) {
        if (name === null) return;
        L.setCategoryName(state.catalog, ci, name);
        save(); render();
      });
    });
    return b;
  }

  function prodButton(c, ci, p, pi) {
    var b = document.createElement('div');
    b.className = 'btn' + (p.name ? '' : ' empty') + (p.checked ? ' bought' : (p.qty > 0 ? ' has-active' : ''));
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = p.name || '+';
    b.appendChild(label);
    if (p.name) {
      var qty = document.createElement('div');
      qty.className = 'qty';
      qty.textContent = p.qty > 0 ? String(p.qty) : '';
      b.appendChild(qty);
      var minus = document.createElement('button');
      minus.className = 'minus';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Уменьшить');
      minus.addEventListener('click', function (e) {
        e.stopPropagation();
        var q = L.decProduct(state.catalog, ci, pi);
        lastAction = p.name + ': ×' + q;
        save(); render();
      });
      b.appendChild(minus);
      var plus = document.createElement('button');
      plus.className = 'plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Добавить');
      plus.addEventListener('click', function (e) {
        e.stopPropagation();
        var q2 = L.incProduct(state.catalog, ci, pi);
        lastAction = p.name + ': ×' + q2;
        save(); render();
      });
      b.appendChild(plus);
      if (p.checked) { minus.disabled = true; plus.disabled = true; }
    }
    b.addEventListener('click', function () {
      if (afterLongPress(b)) return;
      if (!p.name) {
        askText('Название товара:').then(function (name) {
          if (name === null) return;
          L.setProductName(state.catalog, ci, pi, name);
          save(); render();
        });
      }
    });
    longPress(b, function () {
      askText('Новое название товара:', p.name, true, true).then(function (name) {
        if (name === null) return;
        L.setProductName(state.catalog, ci, pi, name);
        save(); render();
      });
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
          L.setChecked(state.catalog, it.catIndex, it.prodIndex, cb.checked, Date.now());
          save(); render();
        });
        var nm = document.createElement('span');
        nm.className = 'row-name';
        nm.textContent = it.product.name || 'Товар';
        var qty = document.createElement('span');
        qty.className = 'row-qty';
        qty.textContent = it.product.qty > 0 ? ('×' + it.product.qty) : '';
        row.appendChild(qty);
        row.appendChild(cb);
        row.appendChild(nm);
        longPress(row, function () {
          L.removeFromList(state.catalog, it.catIndex, it.prodIndex);
          save(); render();
        });
        h.appendChild(row);
      });
      box.appendChild(h);
    });
  }

  function renderStatus() {
    var parts = [];
    if (state) parts.push('Активных: ' + L.activeCount(state.catalog));
    parts.push(navigator.onLine ? 'online' : 'offline');
    if (lastAction) parts.push(lastAction);
    if (saveError) parts.push(saveError);
    if (syncStatus) parts.push(syncStatus);
    if (bootError) parts.push(bootError);
    el('status').textContent = parts.join(' · ');
    el('netStatus').textContent = navigator.onLine ? '●' : '○';
  }

  function render() {
    var isAdd = state.settings.mode === 'add';
    el('screen-add').style.display = isAdd ? '' : 'none';
    el('screen-list').style.display = isAdd ? 'none' : '';
    el('menuBtn').textContent = isAdd ? 'Д' : 'С';
    el('menuBtn').title = isAdd ? 'Режим добавления (нажми — список)' : 'Режим списка (нажми — добавление)';
    if (isAdd) renderAdd(); else renderList();
    renderStatus();
  }

  function wire() {
    wireModal();
    /* Кнопка-переключатель режимов: показывает текущий (Д/С), нажатие меняет.
     * Долгое нажатие открывает настройки (бывший ☰). */
    var menuBtn = el('menuBtn');
    menuBtn.addEventListener('click', function () {
      if (afterLongPress(menuBtn)) return;
      state.settings.mode = state.settings.mode === 'add' ? 'list' : 'add';
      selectedCat = null;
      save(); render();
    });
    longPress(menuBtn, function () {
      el('drawer').classList.toggle('open');
    });
    el('clearList').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('Очистить список? Количества и отметки будут сброшены.').then(function (ok) {
        if (!ok) return;
        L.clearList(state.catalog);
        save(); render();
      });
    });
    el('clearAll').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('Очистить ВСЕ кнопки? Названия категорий и товаров будут удалены.').then(function (ok) {
        if (!ok) return;
        L.clearAll(state.catalog);
        selectedCat = null;
        save(); render();
      });
    });
    el('saveSettings').addEventListener('click', function () {
      state.settings.repo = el('repoInput').value.trim() || 'russkin/purchases';
      state.settings.token = el('tokenInput').value.trim();
      save(); render();
    });
    el('clearCache').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('Очистить кэш приложения? Списки и названия сохранятся, страница перезагрузится.').then(function (ok) {
        if (!ok) return;
        clearCacheNow();
      });
    });
    el('syncBtn').addEventListener('click', doSync);
    el('gearBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      el('gearMenu').classList.toggle('open');
    });
    el('diagBtn').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      showInfo('Диагностика', diagText());
    });
    document.addEventListener('click', function (e) {
      var m = el('gearMenu');
      if (m.classList.contains('open') && !m.contains(e.target)) m.classList.remove('open');
    });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state) {
        L.purgeChecked(state.catalog, Date.now());
        render();
        if (state.settings.token && navigator.onLine) doSync();
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
      el('appVer').textContent = 'Версия ' + APP_VERSION;
      el('appVerHead').textContent = APP_VERSION;
      render();
      return window.QLStore.save(state);
    }).then(function () {
      setupAutoUpdate();
      /* Автоподтягивание общего списка при открытии (кнопка ⇅ больше не обязательна). */
      if (state.settings.token && navigator.onLine) doSync();
    });
  }

  /* Автообновление: если при открытии найден новый service worker,
   * он активируется сам (skipWaiting) — перезагружаем страницу один раз,
   * чтобы новая версия применилась без кнопки «Очистить кэш». */
  var updateReloaded = false;
  function setupAutoUpdate() {
    try {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        try { if (reg && reg.update) reg.update(); } catch (e) {}
      }).catch(function () {});
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (updateReloaded) return;
        updateReloaded = true;
        window.location.reload();
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', init);
})();
