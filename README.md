# Быстрый список

Семейное PWA для списков покупок: планшет на кухне (режим добавления) + телефоны в магазине (режим списка). Работает офлайн, устанавливается без Play Market, хостинг — GitHub Pages.

Открыть: https://russkin.github.io/purchases/

## Структура

- `index.html` — оболочка: шапка, меню, экраны добавления/списка
- `app.js` — интерфейс (сетки кнопок, список, долгое нажатие 3 сек)
- `store.js` — хранилище: IndexedDB с fallback на localStorage (`quicklist-v1`)
- `sync.js` — необязательный синк через GitHub Contents API (`data/state.json`, last-write-wins)
- `src/logic.js` — чистая логика без DOM (общая для браузера и тестов)
- `sw.js` — service worker (cache-first shell → открытие ≤ 2 сек офлайн)
- `manifest.webmanifest`, `icon.svg` — установка как приложение
- `tests/logic.test.js` — 11 unit-тестов (`node --test`)
- `docs/USER_GUIDE.md` — инструкция пользователя

## Разработка

```sh
# тесты (обязательно перед публикацией)
node --test tests/logic.test.js

# локальный предпросмотр
python3 -m http.server 8000
# → http://localhost:8000 (Service Worker требует http://localhost или https)
```

## Деплой

Push в `main` → workflow «Deploy PWA to GitHub Pages» (с job `test`: `node --test tests/logic.test.js`) → https://russkin.github.io/purchases/

Синхронизация между устройствами включается в меню приложения (repo + GitHub token, хранится только на устройстве).
