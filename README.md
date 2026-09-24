# Быстрый список

Семейное PWA для списков покупок: планшет на кухне (режим добавления) + телефоны в магазине (режим списка). Работает офлайн, устанавливается без Play Market, хостинг — GitHub Pages.

Открыть: https://russkin.github.io/purchases/

## Структура

- `index.html` — оболочка: шапка, меню, экраны добавления/списка
- `app.js` — интерфейс (сетки кнопок, список, долгое нажатие 3 сек)
- `store.js` — хранилище: IndexedDB с fallback на localStorage (`quicklist-v1`)
- `sync.js` — необязательный синк через GitHub Contents API (`data/state.json`): скачать → попродуктово объединить → опубликовать
- `src/logic.js` — чистая логика без DOM (общая для браузера и тестов)
- `sw.js` — service worker (cache-first shell → открытие ≤ 2 сек офлайн)
- `manifest.webmanifest`, `icon.svg` — установка как приложение
- `tests/` — unit-тесты (`node --test tests/logic.test.js tests/ios.test.js tests/sync.test.js tests/sync-devices.test.js tests/journal.test.js`), покрытие logic.js/sync.js ~99% строк
- `docs/USER_GUIDE.md` — инструкция пользователя

## Разработка

```sh
# тесты (обязательно перед публикацией)
node --test tests/logic.test.js tests/ios.test.js

# локальный предпросмотр
python3 -m http.server 8000
# → http://localhost:8000 (Service Worker требует http://localhost или https)
```

## Деплой

Push в `main` → workflow «Deploy PWA to GitHub Pages» (с job `test`: `node --test tests/logic.test.js`) → https://russkin.github.io/purchases/

Синхронизация между устройствами включается в меню приложения (repo + GitHub token, хранится только на устройстве).
Синк идёт после каждого изменения (debounce 2 сек) и при открытии. Объединение — попродуктовое:
у каждого товара и названия категории своя метка времени, для каждой ячейки побеждает более свежая правка,
поэтому параллельные добавления с разных устройств не теряются. Одновременная правка одного товара —
побеждает более поздняя.
