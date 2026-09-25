/* app.js — интерфейс «Быстрого списка»: режимы добавления и списка. */
'use strict';

(function () {
  var LONGPRESS_MS = 3000;
  var APP_VERSION = 'v60';
  var L = window.QLLogic;
  var state = null;
  var selectedCat = null;
  var sortMode = false;
  var syncStatus = '';
  var lastAction = '';
  var bootError = '';
  var bootStack = '';

  function el(id) { return document.getElementById(id); }

  /* Подписка, стойкая к рассинхрону кэшей: если index.html старый, а app.js новый,
   * элемента может не быть — пропускаем подписку, а не роняем всё приложение. */
  function on(id, ev, fn) {
    var n = el(id);
    if (n) n.addEventListener(ev, fn);
    return n;
  }

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
  var modalShareText = null;
  function closeModal(value) {
    el('modalBack').classList.remove('open');
    el('modalCancel').style.display = '';
    el('modalClear').style.display = 'none';
    el('modalClear').textContent = 'Очистить';
    modalShareText = null;
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
  function showInfo(title, body, shareText) {
    el('modalText').textContent = title + '\n\n' + body;
    el('modalInput').style.display = 'none';
    el('modalOk').textContent = 'OK';
    if (shareText) {
      el('modalClear').textContent = 'Поделиться';
      el('modalClear').style.display = '';
      modalShareText = shareText;
    } else {
      el('modalClear').style.display = 'none';
    }
    el('modalCancel').style.display = 'none';
    el('modalBack').classList.add('open');
    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  /* Поделиться списком: системное меню (телефоны), иначе — копирование
   * в буфер, на совсем старых — текст в окне для ручного копирования. */
  function copyText(text, done) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }
  function shareList() {
    var text = L.shareText(state.catalog);
    if (!text) {
      showInfo('Поделиться списком', 'Список пуст — нечего отправлять.');
      return;
    }
    shareExternal(text);
  }
  /* Отправка текста наружу: системное меню, иначе буфер, иначе окно для ручного копирования. */
  function shareExternal(text) {
    if (navigator.share) {
      try {
        var p = navigator.share({ title: 'Быстрый список', text: text });
        if (p && p.catch) p.catch(function () {});
        return;
      } catch (e) {}
    }
    copyText(text, function (ok) {
      if (ok) showInfo('Готово', 'Скопировано — вставь в мессенджер.\n\n' + text);
      else showInfo('Скопируй вручную', text);
    });
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
    on('modalOk', 'click', function () {
      var input = el('modalInput');
      if (input.style.display === 'none') closeModal(true);
      else closeModal(input.value);
    });
    on('modalCancel', 'click', function () {
      var input = el('modalInput');
      closeModal(input.style.display === 'none' ? false : null);
    });
    on('modalClear', 'click', function () {
      if (modalShareText) {
        var t = modalShareText;
        closeModal(true);
        shareExternal(t);
      } else closeModal('');
    });
  }

  /* Установка PWA из шестерёнки: Chrome отдаёт beforeinstallprompt — тогда
   * показываем системный диалог; иначе (iPhone, старый WebView) — подсказку,
   * как добавить вручную. В уже установленном приложении пункт прячем. */
  var deferredInstall = null;
  function renderInstallBtn() {
    var b = el('installBtn');
    if (!b) return;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        b.style.display = 'none';
        return;
      }
    } catch (e) {}
    b.style.display = '';
  }
  function wireInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      renderInstallBtn();
    });
    window.addEventListener('appinstalled', function () {
      deferredInstall = null;
      renderInstallBtn();
    });
    on('installBtn', 'click', function () {
      setGear(false);
      if (deferredInstall) {
        deferredInstall.prompt();
        deferredInstall.userChoice.then(function () {
          deferredInstall = null;
        }).catch(function () {});
        return;
      }
      showInfo('Установка приложения',
        'Android Chrome: ⋮ → «Установить приложение».\n' +
        'iPhone (Safari): Поделиться → «На экран „Домой“».\n' +
        'После установки открывать с иконки «Список».');
    });
  }

  /* Поле токена живёт в DOM только пока открыты настройки: Chrome видит пару
   * «текст + type=password» как форму входа и предлагает сохранить токен при
   * любом вводе (autocomplete он игнорирует). Без поля в разметке бабла нет.
   * Источник правды — state.settings.token, поле лишь показывает его. */
  function ensureTokenInput() {
    var input = el('tokenInput');
    if (input) return input;
    input = document.createElement('input');
    input.id = 'tokenInput';
    input.type = 'password';
    input.placeholder = 'GitHub token (только на этом устройстве)';
    input.setAttribute('autocomplete', 'new-password');
    input.setAttribute('readonly', 'readonly');
    input.value = (state && state.settings.token) || '';
    input.addEventListener('focus', function () {
      input.removeAttribute('readonly');
    });
    var w = el('tokenWrap');
    if (w) w.appendChild(input);
    return input;
  }
  function setGear(open) {
    var m = el('gearMenu');
    if (open) {
      m.classList.add('open');
      ensureTokenInput();
    } else {
      m.classList.remove('open');
      var t = el('tokenInput');
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }
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

  /* Фоновый опрос общего файла: открытый планшет сам подтягивает чужие
   * правки раз в 60 сек — только если вкладка видима, есть сеть и задан токен.
   * Параллельный синк невозможен: в doSync single-flight (syncInFlight). */
  var POLL_MS = 60000;
  var pollTimer = null;
  function setupPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (!state || !state.settings.token || !navigator.onLine) return;
      doSync();
    }, POLL_MS);
  }

  /* Проверка новой версии: app.js?nocache=… идёт мимо кэша SW (см. sw.js),
   * поэтому видим свежий APP_VERSION. Нашли новее — спрашиваем один раз
   * и обновляемся через полную очистку кэша (как кнопка в ⚙, только сами). */
  var CUR_VER = parseInt(String(APP_VERSION).replace(/[^0-9]/g, ''), 10) || 0;
  var updateOfferedFor = 0;
  var lastUpdateCheck = 0;
  var UPDATE_CHECK_MS = 5 * 60 * 1000;
  function checkUpdate() {
    try {
      if (!navigator.onLine || modalResolve) return;
      var now = Date.now();
      if (now - lastUpdateCheck < UPDATE_CHECK_MS) return;
      lastUpdateCheck = now;
      fetch('./app.js?nocache=' + now, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) return null;
        return r.text();
      }).then(function (t) {
        if (!t || modalResolve) return;
        var m = /APP_VERSION = 'v(\d+)'/.exec(t);
        if (!m) return;
        var v = parseInt(m[1], 10);
        if (v > CUR_VER && v !== updateOfferedFor) {
          updateOfferedFor = v;
          askConfirm('Вышла новая версия приложения (v' + v + ') — обновить?').then(function (ok) {
            if (ok) clearCacheNow();
          });
        }
      }).catch(function () {});
    } catch (e) {}
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

  /* Стрелки режима порядка (⏮ в начало, ⏭ в конец, пара направлений).
   * Каждая перестановка идёт через save() — со свежими ts и синком. */
  function arrowBtn(b, cls, sym, label, enabled, go) {
    var m = document.createElement('button');
    m.className = cls;
    m.textContent = sym;
    m.setAttribute('aria-label', label);
    if (!enabled) m.disabled = true;
    else m.addEventListener('click', function (e) {
      e.stopPropagation();
      go();
      save(); render();
    });
    b.appendChild(m);
  }
  function catSortArrows(b, ci, n) {
    arrowBtn(b, 'mfirst', '⏮', 'В начало', ci > 0, function () {
      L.moveCategory(state.catalog, ci, 0);
    });
    arrowBtn(b, 'mlast', '⏭', 'В конец', ci < n - 1, function () {
      L.moveCategory(state.catalog, ci, n - 1);
    });
    arrowBtn(b, 'minus', '‹', 'Влево', ci > 0, function () {
      L.moveCategory(state.catalog, ci, ci - 1);
    });
    arrowBtn(b, 'plus', '›', 'Вправо', ci < n - 1, function () {
      L.moveCategory(state.catalog, ci, ci + 1);
    });
  }
  function prodSortArrows(b, ci, pi, n) {
    arrowBtn(b, 'mfirst', '⏮', 'В начало', pi > 0, function () {
      L.moveProduct(state.catalog, ci, pi, 0);
    });
    arrowBtn(b, 'mlast', '⏭', 'В конец', pi < n - 1, function () {
      L.moveProduct(state.catalog, ci, pi, n - 1);
    });
    arrowBtn(b, 'minus', '‹', 'Вверх', pi > 0, function () {
      L.moveProduct(state.catalog, ci, pi, pi - 1);
    });
    arrowBtn(b, 'plus', '›', 'Вниз', pi < n - 1, function () {
      L.moveProduct(state.catalog, ci, pi, pi + 1);
    });
  }

  function catButton(c, ci) {
    var b = document.createElement('div');
    var hasActive = c.products.some(function (p) { return p.qty > 0; });
    b.className = 'btn' + (c.name ? '' : ' empty') + (hasActive ? ' has-active' : '') + (sortMode ? ' sorting' : '');
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = c.name || '+';
    b.appendChild(label);
    if (sortMode) {
      catSortArrows(b, ci, state.catalog.categories.length);
      return b;
    }
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
    b.className = 'btn' + (p.name ? '' : ' empty') + (p.checked ? ' bought' : (p.qty > 0 ? ' has-active' : '')) + (sortMode ? ' sorting' : '');
    var label = document.createElement('div');
    label.className = 'btn-label';
    label.textContent = p.name || '+';
    b.appendChild(label);
    if (sortMode) {
      prodSortArrows(b, ci, pi, c.products.length);
      return b;
    }
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
    if (sortMode) parts.push('режим порядка');
    if (lastAction) parts.push(lastAction);
    if (saveError) parts.push(saveError);
    if (syncStatus) parts.push(syncStatus);
    if (bootError) parts.push(bootError);
    el('status').textContent = parts.join(' · ');
    var net = el('netStatus');
    net.textContent = '⇅';
    net.style.color = navigator.onLine ? '#2e9e44' : '#bbb';
    net.title = navigator.onLine ? 'Есть сеть' : 'Нет сети';
    /* Замеренная скорость в мегабайтах: браузер отдаёт мегабиты (downlink),
     * делим на 8. Отдаёт не каждый браузер (на iPhone — нет), тогда пусто. */
    var netSpeed = '';
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.downlink > 0) {
        netSpeed = String(Math.round(conn.downlink / 8 * 100) / 100).replace('.', ',') + ' МБ/с';
      }
    } catch (e) { netSpeed = ''; }
    el('netType').textContent = (navigator.onLine && netSpeed) ? netSpeed : '';
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
    renderInstallBtn();
    renderStatus();
  }

  function wire() {
    wireModal();
    wireInstall();
    /* Кнопка-переключатель режимов: показывает текущий (Д/С), нажатие меняет. */
    on('menuBtn', 'click', function () {
      state.settings.mode = state.settings.mode === 'add' ? 'list' : 'add';
      selectedCat = null;
      sortMode = false;
      save(); render();
    });
    on('clearList', 'click', function () {
      setGear(false);
      askConfirm('Очистить список? Количества и галочки сбросятся, названия сохранятся.').then(function (ok) {
        if (!ok) return;
        L.clearList(state.catalog);
        save(); render();
      });
    });
    on('clearAll', 'click', function () {
      setGear(false);
      askConfirm('УДАЛИТЬ названия всех категорий и товаров НА ВСЕХ УСТРОЙСТВАХ? Это затронет всю семью.').then(function (ok) {
        if (!ok) return;
        L.clearAll(state.catalog);
        selectedCat = null;
        save(); render();
      });
    });
    on('saveSettings', 'click', function () {
      state.settings.repo = el('repoInput').value.trim() || 'russkin/purchases';
      state.settings.token = ensureTokenInput().value.trim();
      setGear(false);
      save(); render();
    });
    on('clearCache', 'click', function () {
      setGear(false);
      askConfirm('Очистить кэш приложения? Списки и названия сохранятся, страница перезагрузится.').then(function (ok) {
        if (!ok) return;
        clearCacheNow();
      });
    });
    on('syncNowBtn', 'click', function () {
      setGear(false);
      doSync();
    });
    on('shareBtn', 'click', function () {
      setGear(false);
      shareList();
    });
    on('sortBtn', 'click', function () {
      sortMode = !sortMode;
      setGear(false);
      render();
    });
    /* Выход из режима порядка тапом по названию/версии в шапке. */
    function exitSort() {
      if (sortMode) { sortMode = false; render(); }
    }
    on('appTitle', 'click', exitSort);
    on('appVerHead', 'click', exitSort);
    on('syncLight', 'click', function () {
      doSync();
    });
    on('gearBtn', 'click', function (e) {
      e.stopPropagation();
      setGear(!el('gearMenu').classList.contains('open'));
    });
    on('diagBtn', 'click', function () {
      setGear(false);
      showInfo('Диагностика', diagText(), diagText());
    });
    document.addEventListener('click', function (e) {
      var m = el('gearMenu');
      if (m.classList.contains('open') && !m.contains(e.target)) setGear(false);
    });
    window.addEventListener('online', function () {
      render();
      if (state && state.settings.token) doSync();
    });
    try {
      var connEv = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connEv && connEv.addEventListener) connEv.addEventListener('change', render);
    } catch (e) {}
    window.addEventListener('offline', render);
    /* Возврат на вкладку: одного visibilitychange мало — при восстановлении
     * из кэша назад/вперёд он может не сработать, поэтому слушаем ещё
     * focus и pageshow. Троттлинг 15 сек, чтобы фокус не долбил API. */
    var lastTabSync = 0;
    window.QLApp = window.QLApp || {};
    window.QLApp.onTabActive = function () {
      if (!state || document.hidden) return;
      L.purgeChecked(state.catalog, Date.now());
      render();
      checkUpdate();
      var now = Date.now();
      if (state.settings.token && navigator.onLine && now - lastTabSync > 15000) {
        lastTabSync = now;
        doSync();
      }
    };
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) window.QLApp.onTabActive();
    });
    window.addEventListener('focus', window.QLApp.onTabActive);
    window.addEventListener('pageshow', window.QLApp.onTabActive);
  }

  function init() {
    wire();
    window.QLStore.load().then(function (s) {
      state = s;
      L.purgeChecked(state.catalog, Date.now());
      el('repoInput').value = state.settings.repo || '';
      el('appVer').textContent = 'Версия ' + APP_VERSION;
      el('appVerHead').textContent = APP_VERSION;
      render();
      return window.QLStore.save(state);
    }).then(function () {
      setupAutoUpdate();
      setupPolling();
      checkUpdate();
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
