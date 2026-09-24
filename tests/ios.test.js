'use strict';
/* Регресс-тест iOS-бага: системные prompt/confirm блокируются в Chrome на iPhone
 * вне user-activation (таймер лонгпресса), поэтому используются только встроенные диалоги. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');

describe('ios: без системных диалогов', () => {
  it('нет вызовов prompt(', () => {
    /* Точку исключаем: BeforeInstallPromptEvent.prompt() — не системный диалог,
     * на iOS событие просто не приходит, там показывается своя подсказка. */
    assert.ok(!/(^|[^A-Za-z_$.])prompt\s*\(/.test(appSrc), 'найден prompt(');
  });
  it('нет вызовов confirm(', () => {
    assert.ok(!/(^|[^A-Za-z_$])confirm\s*\(/.test(appSrc), 'найден confirm(');
  });
  it('есть встроенный диалог и подавление клика после лонгпресса', () => {
    assert.ok(appSrc.includes('modalBack'), 'нет modalBack');
    assert.ok(appSrc.includes('askText'), 'нет askText');
    assert.ok(appSrc.includes('afterLongPress'), 'нет afterLongPress');
  });
  it('есть диагностика нажатий: onerror и lastAction', () => {
    assert.ok(appSrc.includes("addEventListener('error'"), 'нет onerror');
    assert.ok(appSrc.includes('lastAction'), 'нет lastAction');
  });
  it('есть стек и кнопка диагностики', () => {
    assert.ok(appSrc.includes('bootStack'), 'нет bootStack');
    assert.ok(appSrc.includes('diagBtn'), 'нет diagBtn');
    assert.ok(syncSrc.includes('normalizeCatalog'), 'нет normalizeCatalog в sync');
  });
  it('мутации логики получают state.catalog, а не state', () => {
    const fns = ['setCategoryName', 'setProductName', 'incProduct', 'decProduct', 'setChecked', 'removeFromList'];
    for (const fn of fns) {
      assert.ok(!new RegExp('L\\.' + fn + '\\(state[^.]').test(appSrc), 'найден вызов ' + fn + '(state, …)');
      assert.ok(appSrc.includes('L.' + fn + '(state.catalog,'), 'нет вызова ' + fn + '(state.catalog, …)');
    }
  });
  it('версия видна на экране (шапка)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="appVerHead"'), 'нет appVerHead в шапке');
    assert.ok(appSrc.includes("el('appVerHead')"), 'версия не подставляется');
  });
  it('кнопки очистки не путаются: нет «Очистить все кнопки»', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(!html.includes('>Очистить все кнопки<'), 'ловушка на месте');
    assert.ok(html.includes('>Сбросить все названия<'), 'нет понятного названия');
    assert.ok(appSrc.includes('НА ВСЕХ УСТРОЙСТВАХ'), 'нет предупреждения в confirm');
  });
  it('журнал подключён: QLJournal, публикация, скрипт', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('journal.js'), 'нет journal.js в index.html');
    assert.ok(appSrc.includes('QLJournal'), 'нет QLJournal в app');
    assert.ok(syncSrc.includes('publishFile'), 'нет publishFile в sync');
  });
  it('сетевые ошибки не публикуются, 409 тихо ретраится позже', () => {
    assert.ok(appSrc.includes('scheduleConflictRetry'), 'нет scheduleConflictRetry');
    assert.ok(appSrc.includes('/github-/'), 'журнал публикуется и при сетевых ошибках');
  });
  it('очистка кэша с гарантированной перезагрузкой и автообновлением', () => {
    assert.ok(appSrc.includes('clearCacheNow'), 'нет clearCacheNow');
    assert.ok(appSrc.includes('setTimeout(done, 4000)'), 'нет страховки перезагрузки');
    assert.ok(appSrc.includes('controllerchange'), 'нет автообновления');
  });
  it('конфликт записи повторяется с паузой (409/422 + backoff)', () => {
    assert.ok(/github-put \(409\|422\)/.test(syncSrc), 'нет ретрая 409/422');
    assert.ok(syncSrc.includes('backoffDelay'), 'нет backoff перед ретраем');
  });
  it('синки не идут параллельно (иначе вечные 409 на медленной сети)', () => {
    assert.ok(appSrc.includes('syncInFlight'), 'нет флага syncInFlight');
    assert.ok(appSrc.includes('syncAgain'), 'нет очереди syncAgain');
  });
  it('ошибка синка — ещё 5 повторов через 2 сек', () => {
    assert.ok(appSrc.includes('scheduleErrorRetry'), 'нет scheduleErrorRetry');
    assert.ok(appSrc.includes('errRetryCount'), 'нет счётчика повторов');
    assert.ok(/2000/.test(appSrc), 'нет паузы 2 сек');
  });
  it('возврат на вкладку синкает: visibilitychange + focus + pageshow', () => {
    assert.ok(appSrc.includes('onTabActive'), 'нет onTabActive');
    assert.ok(appSrc.includes("'pageshow'"), 'нет pageshow');
    assert.ok(appSrc.includes("'focus'"), 'нет focus');
  });
  it('светофор синка и цвет точки сети', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="syncLight"'), 'нет syncLight в шапке');
    assert.ok(appSrc.includes("el('syncLight')"), 'светофор не обновляется');
    assert.ok(appSrc.includes('#2e9e44'), 'нет зелёного цвета');
    assert.ok(appSrc.includes('#d32f2f'), 'нет красного цвета');
    assert.ok(appSrc.includes('⇅'), 'нет значка сети ⇅');
    assert.ok(html.includes('id="netType"'), 'нет подписи типа сети');
    assert.ok(appSrc.includes('downlink'), 'скорость сети не читается');
    assert.ok(appSrc.includes('МБ/с'), 'скорость не в мегабайтах');
    assert.ok(html.includes('syncLight::after'), 'посылка без скотча');
    assert.ok(appSrc.includes("el('syncLight').addEventListener('click'"), 'тап по светофору не запускает синк');
    assert.ok(appSrc.includes("classList.toggle('alert'"), 'нет тревоги ! при 409');
    assert.ok(html.includes('flex-wrap: wrap'), 'кнопки модалки не переносятся');
  });
  it('синк объединяет попродуктово', () => {
    assert.ok(syncSrc.includes('mergeCatalogs'), 'нет mergeCatalogs в sync');
    assert.ok(syncSrc.includes('bad response'), 'нет проверки тела ответа API');
    assert.ok(syncSrc.includes('fmtErr'), 'нет форматирования ошибок');
  });
  it('версии app.js и sw.js меняются вместе', () => {
    const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const m1 = appSrc.match(/APP_VERSION = 'v(\d+)'/);
    const m2 = swSrc.match(/quicklist-v(\d+)/);
    assert.ok(m1 && m2, 'метка версии не найдена');
    assert.equal(m1[1], m2[1], 'версии app.js и sw.js разъехались');
  });
  it('открытый планшет подтягивает чужие правки: фоновый опрос раз в 60 сек', () => {
    assert.ok(appSrc.includes('setupPolling'), 'нет setupPolling');
    assert.ok(appSrc.includes('setInterval'), 'нет setInterval');
    assert.ok(/POLL_MS = 60000/.test(appSrc), 'нет интервала 60 сек');
    assert.ok(/document\.hidden/.test(appSrc), 'опрос без проверки видимости вкладки');
  });
  it('PWA ставится на старом Android: PNG-иконки в манифесте, кэше SW и сборке', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8');
    assert.ok(manifest.includes('icon-192.png'), 'нет 192 в манифесте');
    assert.ok(manifest.includes('icon-512.png'), 'нет 512 в манифесте');
    const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.ok(swSrc.includes('icon-192.png') && swSrc.includes('icon-512.png'), 'иконок нет в кэше SW');
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/pages.yml'), 'utf8');
    assert.ok(yml.includes('icon-192.png') && yml.includes('icon-512.png'), 'иконок нет в сборке Pages');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'icon-192.png')), 'нет файла icon-192.png');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'icon-512.png')), 'нет файла icon-512.png');
  });
  it('установка PWA из шестерёнки: кнопка + beforeinstallprompt с подсказкой', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="installBtn"'), 'нет installBtn в меню');
    assert.ok(appSrc.includes('beforeinstallprompt'), 'нет перехвата beforeinstallprompt');
    assert.ok(appSrc.includes('deferredInstall'), 'нет отложенного промпта');
    assert.ok(appSrc.includes('.prompt()'), 'промпт не вызывается');
    assert.ok(appSrc.includes('На экран'), 'нет подсказки ручной установки для iPhone');
    assert.ok(appSrc.includes('display-mode: standalone'), 'кнопка не прячется в установленном приложении');
  });
  it('токен не принимают за пароль: new-password, Chrome молчит', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="tokenInput"'), 'нет tokenInput');
    assert.ok(/id="tokenInput"[^>]*autocomplete="new-password"/.test(html), 'у токена нет new-password');
  });
});
