/* app.js — интерфейс «Быстрого списка»: режимы добавления и списка. */
'use strict';

(function () {
  var LONGPRESS_MS = 3000;
  var APP_VERSION = 'v39';
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
    lines.push('Устройство: ' + window.QLJournal.deviceId());
    if (!state) return 'Состояние не загружено.';
    lines.push('Режим: ' + state.settings.mode);
    lines.push('Категорий: ' + state.catalog.categories.length);
    lines.push('Выбрана: ' + selectedCat);
    lines.push('Активных: ' + L.activeCount(state.catalog));
    lines.push('updatedAt: ' + state.updatedAt);
    lines.push('Синк: ' + (syncStatus || (state.settings.token ? '—' : 'выключен (нет ключа)')));
    lines.push('Действие: ' + (lastAction || '—'));
    lines.push('Ошибка: ' + (bootError || 'нет'));
    if (bootStack) lines.push('Стек:\n' + bootStack);
    var journal = window.QLJournal.list().slice(-12);
    if (journal.length) {
      lines.push('Журнал:');
      journal.forEach(function (e) {
        lines.push('  ' + new Date(e.t).toLocaleString() + ' [' + e.type + '] ' + e.text);
      });
    }
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

  /* Параллельные синки на медленной сети затирают друг другу sha
   * (каждый PUT прилетает с протухшим sha → вечные 409).
   * Поэтому летит только один, повторная просьба ждёт своей очереди. */
  var syncInFlight = false;
  var syncAgain = false;
  function finishSync() {
    syncInFlight = false;
    render();
    if (syncAgain) { syncAgain = false; doSync(); }
  }

  function doSync() {
    if (!state.settings.token) { syncStatus = ''; renderStatus(); return; }
    if (syncInFlight) { syncAgain = true; return; }
    syncInFlight = true;
    syncStatus = 'синхронизация…';
    renderStatus();
    window.QLSync.syncNow(state).then(function (res) {
      syncStatus = res.status === 'error' ? ('ошибка синка: ' + res.error) : ('синк: ' + res.status);
      window.QLJournal.push('sync', syncStatus);
      state = res.state;
      if (res.status === 'error') {
        // Сетевые обрывы публиковать бессмысленно — сети нет и для публикации.
        if (/github-/.test(res.error)) maybePublishJournal();
        // Исчерпанные конфликты — молча повторить через 30 сек, без спама статусов.
        if (/github-put (409|422)/.test(res.error)) scheduleConflictRetry();
        // Любая ошибка — ещё 5 быстрых повторов через 2 сек.
        scheduleErrorRetry();
      } else {
        errRetryCount = 0;
        if (errRetryTimer) { clearTimeout(errRetryTimer); errRetryTimer = null; }
      }
      return window.QLStore.save(state);
    }).then(finishSync, finishSync);
  }

  /* Быстрые повторы при любой ошибке синка: через 2 сек, до 5 раз подряд.
   * Счётчик сбрасывается при первом же успехе. */
  var errRetryCount = 0;
  var errRetryTimer = null;
  function scheduleErrorRetry() {
    if (!navigator.onLine) return;
    if (errRetryCount >= 5) { errRetryCount = 0; return; }
    errRetryCount += 1;
    if (errRetryTimer) clearTimeout(errRetryTimer);
    errRetryTimer = setTimeout(function () {
      errRetryTimer = null;
      if (state && state.settings.token && navigator.onLine) doSync();
    }, 2000);
  }

  var conflictRetryTimer = null;
  function scheduleConflictRetry() {
    if (conflictRetryTimer) return;
    conflictRetryTimer = setTimeout(function () {
      conflictRetryTimer = null;
      if (state && state.settings.token && navigator.onLine) doSync();
    }, 30000);
  }

  /* Публикация журнала в logs/ при ошибке синка, не чаще раза в 15 минут
   * (иначе заспамим репозиторий коммитами). Имя: logs/sync-ГГГГ-ММ-ДД-<device>.json. */
  var lastJournalPublish = 0;
  function logFileName() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return 'logs/sync-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '-' + window.QLJournal.deviceId() + '.json';
  }
  function maybePublishJournal() {
    try {
      var now = Date.now();
      if (now - lastJournalPublish < 15 * 60 * 1000) return;
      lastJournalPublish = now;
      var body = {
        device: window.QLJournal.deviceId(),
        version: APP_VERSION,
        at: new Date(now).toISOString(),
        journal: window.QLJournal.list().slice(-50)
      };
      window.QLSync.publishFile(state.settings.repo, state.settings.token, logFileName(), body)
        .then(function (st) { window.QLJournal.push('log', String(st)); renderStatus(); })
        .catch(function () {});
    } catch (e) {}
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
    var net = el('netStatus');
    net.textContent = '⇅';
    net.style.color = navigator.onLine ? '#2e9e44' : '#bbb';
    net.title = navigator.onLine ? 'Есть сеть' : 'Нет сети';
    /* Светофор синхронизации: зелёный — всё отправлено, жёлтый (мигает) —
     * идёт отправка, красный — ошибка, серый — синк выключен (нет ключа).
     * При конфликте записи (409/422) посылка превращается в красный «!»,
     * тап по нему — принудительный синк, как пункт в шестерёнке. */
    var light = el('syncLight');
    var color = '#bbb';
    var title = (state && state.settings.token) ? 'Синк ещё не запускался. Нажми — синхронизировать.' : 'Синк выключен (нет ключа)';
    var blink = false;
    var alert = false;
    if (syncStatus === 'синхронизация…') {
      color = '#e6a700'; title = 'Идёт синхронизация…'; blink = true;
    } else if (syncStatus.indexOf('ошибка') === 0) {
      color = '#d32f2f'; title = syncStatus + '. Нажми — попробовать снова.';
      if (/github-put (409|422)/.test(syncStatus)) alert = true;
    } else if (syncStatus.indexOf('синк:') === 0) {
      color = '#2e9e44'; title = syncStatus + '. Нажми — синхронизировать.';
    }
    light.style.background = color;
    light.title = title;
    light.textContent = alert ? '!' : '';
    light.classList.toggle('alert', alert);
    light.classList.toggle('blink', blink);
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
    /* Кнопка-переключатель режимов: показывает текущий (Д/С), нажатие меняет. */
    el('menuBtn').addEventListener('click', function () {
      state.settings.mode = state.settings.mode === 'add' ? 'list' : 'add';
      selectedCat = null;
      save(); render();
    });
    el('clearList').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('Очистить список? Количества и галочки сбросятся, названия сохранятся.').then(function (ok) {
        if (!ok) return;
        L.clearList(state.catalog);
        save(); render();
      });
    });
    el('clearAll').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('УДАЛИТЬ названия всех категорий и товаров НА ВСЕХ УСТРОЙСТВАХ? Это затронет всю семью.').then(function (ok) {
        if (!ok) return;
        L.clearAll(state.catalog);
        selectedCat = null;
        save(); render();
      });
    });
    el('saveSettings').addEventListener('click', function () {
      state.settings.repo = el('repoInput').value.trim() || 'russkin/purchases';
      state.settings.token = el('tokenInput').value.trim();
      el('gearMenu').classList.remove('open');
      save(); render();
    });
    el('clearCache').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      askConfirm('Очистить кэш приложения? Списки и названия сохранятся, страница перезагрузится.').then(function (ok) {
        if (!ok) return;
        clearCacheNow();
      });
    });
    el('syncNowBtn').addEventListener('click', function () {
      el('gearMenu').classList.remove('open');
      doSync();
    });
    el('syncLight').addEventListener('click', function () {
      doSync();
    });
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
    window.addEventListener('online', function () {
      render();
      if (state && state.settings.token) doSync();
    });
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
      /* Автоподтягивание общего списка при открытии (ручной пункт в ⚙ не обязателен). */
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
