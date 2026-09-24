/* journal.js — локальный журнал синхронизации для диагностики.
 * Кольцевой буфер (последние MAX записей) в localStorage, ВНЕ синкаемого состояния,
 * чтобы журнал не раздувал общий файл и не гонялся между устройствами.
 * UMD: в Node принимает storage параметром для тестов.
 */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory;
  } else {
    var storage = null;
    try { storage = root.localStorage || null; } catch (e) { storage = null; }
    root.QLJournal = factory(storage);
  }
}(typeof window !== 'undefined' ? window : {}, function (storage) {
  var KEY = 'quicklist-journal-v1';
  var DEVKEY = 'quicklist-device-v1';
  var MAX = 100;

  function load() {
    try {
      var raw = storage ? storage.getItem(KEY) : null;
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try {
      if (storage) storage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    } catch (e) { /* приватный режим — журнал просто не сохранится */ }
  }

  function push(type, text) {
    var list = load();
    list.push({ t: Date.now(), type: String(type), text: String(text).slice(0, 300) });
    save(list);
    return list;
  }

  function list() {
    return load();
  }

  function deviceId() {
    if (!storage) return 'nodev';
    try {
      var id = storage.getItem(DEVKEY);
      if (!id) {
        id = Math.random().toString(16).slice(2, 10);
        storage.setItem(DEVKEY, id);
      }
      return id;
    } catch (e) {
      return 'nodev';
    }
  }

  return { push: push, list: list, deviceId: deviceId, MAX: MAX };
}));
