# AGENTS.md — Быстрый список (purchases)

Семейное PWA «Быстрый список»: списки покупок (планшет на кухне + телефоны в магазине).
Репозиторий: `git@github.com:russkin/purchases.git`, ветка `main`.
Прод: https://russkin.github.io/purchases/ (GitHub Pages, source = GitHub Actions).
Тестовая платформа: планшет HUAWEI MediaPad T3 10 (Android 7), телефоны Android 10+, iPhone 7 (Chrome).

## Регламент публикации (обязательный после КАЖДОГО коммита)

1. `node --test tests/logic.test.js tests/ios.test.js tests/sync.test.js tests/sync-devices.test.js` — всё зелёное.
2. `git commit`, затем push. Прямой push без токена не взлетит (origin — SSH):
   `git push "https://x-access-token:${GITHUB_TOKEN}@github.com/russkin/purchases.git" main:main`
   Токен брать из локального `.env` (`GITHUB_TOKEN`), в выводе затирать через
   `sed -E 's/x-access-token:[^@]+@/x-access-token:REDACTED@/g'`.
   При `rejected` (семья синкается часто) — `fetch + rebase origin/main + push`, повторы до успеха.
3. Дождаться workflow «Deploy PWA to GitHub Pages» (`completed/success`) через Actions API.
4. Проверить прод curl'ом (200 + маркеры новой версии в `app.js`/`sw.js`).
5. Сообщить пользователю: опубликованную версию (`APP_VERSION`) и адрес https://russkin.github.io/purchases/

## Версии

`APP_VERSION` в `app.js` и `CACHE = 'quicklist-vN'` в `sw.js` — менять ВМЕСТЕ при любом
изменении кода приложения (иначе устройства не поймут, что обновились).
Версия видна в шапке (`#appVerHead`) и в ⓘ-диагностике. Service worker: skipWaiting +
clients.claim, приложение само перезагружается при смене контроллера.

## Карта файлов

- `index.html` — оболочка: шапка (☰, ⇅, ⓘ, версия), меню, экраны добавления/списка, модалка.
- `app.js` — UI: сетки 12 кнопок, список, долгое нажатие 3 сек, модальные диалоги.
- `store.js` — IndexedDB + fallback localStorage (`quicklist-v1`), `sanitize` нормализует.
- `sync.js` — синк через GitHub Contents API, UMD (браузер + `require` в тестах).
- `src/logic.js` — чистая логика без DOM (UMD), вся мутабельность каталога здесь.
- `sw.js`, `manifest.webmanifest`, `icon.svg` — PWA.
- `data/state.json` — ОБЩИЙ файл синка в репозитории: `{ updatedAt, catalog }`. Создаётся
  устройствами, в git локально НЕ хранится (игнорируй при коммитах кода).
- `.github/workflows/pages.yml` — job `test` (все 4 файла), сборка `_site/`, deploy.
  `paths-ignore: data/**` — синк-коммиты деплой не триггерят.
- `tests/` — `logic.test.js`, `ios.test.js` (строковые регрессы app.js), `sync.test.js`,
  `sync-devices.test.js` (фейковый GitHub с sha-семантикой).
- `docs/USER_GUIDE.md` (+ `.html` для офлайна), `README.md`.

## Протокол синка (важно, тут были все баги)

- У каждого товара и названия категории своя метка `ts`, ставится при любом изменении.
- `mergeCatalogs`: для каждой ячейки побеждает свежая `ts`, при равных — локальная.
  Пустые (`ts=0`) реальные данные не затирают. Seed идёт с `ts=0` специально.
- `syncNow`: GET → merge → PUT merged если отличается (`pushed`/`merged`/`pulled`/`in-sync`).
  409/422 → до 3 ретраев с перечитыванием. Токен — только из настроек устройства.
- Триггеры: debounce 2 сек после каждого изменения, при открытии, при возврате на вкладку, кнопка ⇅.
- Одновременная правка одного товара с двух устройств — побеждает поздняя (файловый sync, не CRDT).

## Секреты

- `.env` (gitignored): `GITHUB_TOKEN`, `GITLAB_TOKEN` (legacy). НИКОГДА не коммитить,
  не печатать в вывод, не класть в код/артефакты Pages. Сборка `_site/` — только файлы
  из явного списка в workflow (без `.env`, без `.git`).
- Токен для синка на устройствах вводит семья в меню (хранится локально).

## Грабли (проверено болью)

1. `prompt/confirm` на iOS Chrome вне user-activation блокируются → только своя модалка
   (`askText`/`askConfirm`), есть регресс-тест.
2. В функции логики передавать `state.catalog`, НЕ `state` (был краш `incProduct`) — регресс-тест.
3. Клик после сработавшего лонгпресса подавлять (`afterLongPress`, 800 мс).
4. Старые версии пишут ячейки без `ts` и проигрывают слияние → держать всех на свежей версии.
5. Часы на устройстве в будущем ломают LWW — защита «пустое не затирает» + попродуктовый merge.
6. `node --test tests/` (папкой) падает в этом окружении — запускать перечислением файлов.
7. `data/state.json` правится устройствами и скриптами напрямую по API; `git pull` в
   локальной копии его не видит — смотреть через Contents API.
