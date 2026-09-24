'use strict';
/* Тесты синхронизации: fetch мокается, логика настоящая (src/logic.js). */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const factory = require('../sync.js');

function stateWith(catalog, t) {
  return { catalog, settings: { mode: 'add', repo: 'r/x', token: 'TOK' }, updatedAt: t };
}

function fileResp(sha, state) {
  return {
    status: 200, ok: true,
    json: async () => ({ sha, content: Buffer.from(JSON.stringify(state)).toString('base64') })
  };
}

function errResp(status, message) {
  return { status, ok: false, json: async () => ({ message: message || ('err ' + status) }) };
}

/* Мок fetch: handler(url, opts, n) возвращает response. */
function stubFetch(handler) {
  const calls = [];
  const fn = (url, opts) => { calls.push({ url, opts: opts || {} }); return handler(url, opts || {}, calls.length); };
  fn.calls = calls;
  return fn;
}

function decodePut(call) {
  const body = JSON.parse(call.opts.body);
  return { payload: body, state: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) };
}

function seedAt(t) {
  const c = L.seedCatalog();
  return { catalog: c, updatedAt: t };
}

describe('syncNow: базовые исходы', () => {
  it('без токена — no-token, сеть не трогаем', async () => {
    const fetch = stubFetch(() => { throw new Error('must not fetch'); });
    const api = factory(L, fetch);
    const s = stateWith(L.seedCatalog(), 100);
    s.settings.token = '';
    const res = await api.syncNow(s);
    assert.equal(res.status, 'no-token');
    assert.equal(fetch.calls.length, 0);
  });

  it('файла нет + локально пусто — in-sync без PUT', async () => {
    const fetch = stubFetch(async () => ({ status: 404, ok: false, json: async () => ({}) }));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.blankCatalog(), 100));
    assert.equal(res.status, 'in-sync');
    assert.equal(fetch.calls.length, 1);
  });

  it('файла нет + локально есть данные — pushed без sha', async () => {
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return { status: 201, ok: true, json: async () => ({}) };
      return { status: 404, ok: false, json: async () => ({}) };
    });
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'pushed');
    assert.equal(fetch.calls.length, 2);
    assert.ok(!JSON.parse(fetch.calls[1].opts.body).sha);
  });

  it('удалённый новее целиком — pulled', async () => {
    const remote = seedAt(200);
    L.incProduct(remote.catalog, 0, 0, 200);
    const fetch = stubFetch(async () => fileResp('AAA', remote));
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pulled');
    assert.equal(res.state.catalog.categories[0].products[0].qty, 1);
    assert.equal(fetch.calls.length, 1);
  });

  it('локальный новее — pushed с sha', async () => {
    const remote = seedAt(100);
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return { status: 201, ok: true, json: async () => ({}) };
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
    assert.equal(JSON.parse(fetch.calls[1].opts.body).sha, 'AAA');
    const sent = decodePut(fetch.calls[1]).state;
    assert.equal(sent.catalog.categories[0].products[0].qty, 1);
  });

  it('одинаковые — in-sync без PUT', async () => {
    const snap = seedAt(100);
    const fetch = stubFetch(async () => fileResp('AAA', JSON.parse(JSON.stringify(snap))));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'in-sync');
    assert.equal(fetch.calls.length, 1);
  });
});

describe('syncNow: попродуктовое слияние', () => {
  it('параллельные правки объединяются и публикуются', async () => {
    const remote = seedAt(100);
    L.incProduct(remote.catalog, 1, 0, 100);
    const puts = [];
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        puts.push(decodePut({ opts }).state);
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 100);
    L.incProduct(local.catalog, 0, 0, 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'merged');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].catalog.categories[0].products[0].qty, 1);
    assert.equal(puts[0].catalog.categories[1].products[0].qty, 1);
    assert.equal(res.state.catalog.categories[0].products[0].qty, 1);
  });
});

describe('syncNow: конфликты и ошибки', () => {
  it('409 один раз — ретрай и pushed', async () => {
    const remote = seedAt(100);
    let puts = 0;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        puts += 1;
        if (puts === 1) return errResp(409, 'conflict');
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
    assert.equal(puts, 2);
  });

  it('409 всегда — error', async () => {
    const remote = seedAt(100);
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return errResp(409, 'conflict');
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch, { baseMs: 1, capMs: 5, jitterMs: 0 });
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'error');
    assert.match(res.error, /409/);
  });

  it('GET 500 — error с кодом', async () => {
    const fetch = stubFetch(async () => errResp(500, 'boom'));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'error');
    assert.match(res.error, /github-get 500/);
  });

  it('тело без content — error с текстом API', async () => {
    const fetch = stubFetch(async () => ({ status: 403, ok: true, json: async () => ({ message: 'rate limited' }) }));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'error');
    assert.match(res.error, /rate limited/);
  });

  it('fmtErr форматирует', async () => {
    const api = factory(L, stubFetch(() => { throw new Error('x'); }));
    assert.equal(api.fmtErr(new TypeError('bad')), 'TypeError: bad');
    assert.equal(api.fmtErr(null), 'unknown');
  });
});

describe('syncNow: сеть и битые данные', () => {
  it('PUT 403 — error с кодом', async () => {
    const remote = seedAt(100);
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return errResp(403, 'forbidden');
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'error');
    assert.match(res.error, /github-put 403/);
  });

  it('обрыв сети — error, исключение не вылетает', async () => {
    const fetch = stubFetch(async () => { throw new TypeError('Load failed'); });
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'error');
    assert.match(res.error, /Load failed/);
  });

  it('не-JSON в файле — error без падения', async () => {
    const fetch = stubFetch(async () => ({
      status: 200, ok: true,
      json: async () => ({ sha: 'AAA', content: Buffer.from('not json{{{').toString('base64') })
    }));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'error');
  });

  it('каталог битой формы — нормализуется, данные подтягиваются', async () => {
    const partial = { categories: [{ name: 'X', products: [{ name: 'Y', qty: 2, checked: false, checkedAt: 0, ts: 200 }] }] };
    const fetch = stubFetch(async () => fileResp('AAA', { updatedAt: 200, catalog: partial }));
    const api = factory(L, fetch);
    const local = stateWith(L.blankCatalog(), 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pulled');
    assert.equal(res.state.catalog.categories.length, 12);
    assert.equal(res.state.catalog.categories[0].name, 'X');
    assert.equal(res.state.catalog.categories[0].products[0].qty, 2);
  });

  it('файл null — не падает, локальное публикуется', async () => {
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return { status: 201, ok: true, json: async () => ({}) };
      return {
        status: 200, ok: true,
        json: async () => ({ sha: 'AAA', content: Buffer.from('null').toString('base64') })
      };
    });
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'pushed');
  });

  it('без updatedAt в конверте — считается нулём', async () => {
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return { status: 201, ok: true, json: async () => ({}) };
      return fileResp('AAA', { catalog: L.seedCatalog() });
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 100);
    L.incProduct(local.catalog, 0, 0, 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
  });

  it('оба пустые — in-sync без PUT', async () => {
    const fetch = stubFetch(async () => fileResp('AAA', { updatedAt: 100, catalog: L.blankCatalog() }));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.blankCatalog(), 100));
    assert.equal(res.status, 'in-sync');
    assert.equal(fetch.calls.length, 1);
  });

  it('токен уходит в заголовке Authorization', async () => {
    const fetch = stubFetch(async () => fileResp('AAA', seedAt(100)));
    const api = factory(L, fetch);
    await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(fetch.calls[0].opts.headers.Authorization, 'Bearer TOK');
  });

  it('кириллица и эмодзи переживают base64 туда-обратно', async () => {
    let sent = null;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        sent = decodePut({ opts }).state;
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return fileResp('AAA', seedAt(50));
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 100);
    L.setProductName(local.catalog, 0, 0, 'Чёрный хлеб 🍞', 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
    assert.equal(sent.catalog.categories[0].products[0].name, 'Чёрный хлеб 🍞');
  });
});

describe('syncNow: backoff ретраев', () => {
  it('паузы растут экспоненциально и упираются в cap', async () => {
    const remote = seedAt(100);
    const sleeps = [];
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return errResp(409, 'conflict');
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch, {
      baseMs: 100, capMs: 1000, jitterMs: 0,
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
    });
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'error');
    assert.deepEqual(sleeps, [100, 200, 400, 800, 1000]);
    assert.equal(fetch.calls.filter((c) => c.opts.method === 'PUT').length, 6);
  });

  it('maxRetries ограничивает число попыток', async () => {
    const remote = seedAt(100);
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return errResp(409, 'conflict');
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch, { baseMs: 1, capMs: 2, jitterMs: 0, maxRetries: 1 });
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'error');
    assert.equal(fetch.calls.filter((c) => c.opts.method === 'PUT').length, 2);
  });
});
describe('publishFile: журнал в репозиторий', () => {
  it('создаёт файл, если его нет (без sha)', async () => {
    let sent = null;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        sent = JSON.parse(opts.body);
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return { status: 404, ok: false, json: async () => ({}) };
    });
    const api = factory(L, fetch);
    assert.equal(await api.publishFile('r/x', 'TOK', 'logs/a.json', { a: 1 }), 'logged');
    assert.ok(!sent.sha);
    assert.equal(sent.message, 'Sync journal');
  });

  it('перезаписывает с sha', async () => {
    let sent = null;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        sent = JSON.parse(opts.body);
        return { status: 200, ok: true, json: async () => ({}) };
      }
      return { status: 200, ok: true, json: async () => ({ sha: 'OLD', content: 'e30=' }) };
    });
    const api = factory(L, fetch);
    assert.equal(await api.publishFile('r/x', 'TOK', 'logs/a.json', { a: 2 }), 'logged');
    assert.equal(sent.sha, 'OLD');
  });

  it('ошибка чтения — log-error без исключения', async () => {
    const fetch = stubFetch(async () => errResp(500, 'boom'));
    const api = factory(L, fetch);
    const st = await api.publishFile('r/x', 'TOK', 'logs/a.json', {});
    assert.match(st, /^log-error: /);
  });

  it('ошибка записи — log-error без исключения', async () => {
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return errResp(403, 'denied');
      return { status: 200, ok: true, json: async () => ({ sha: 'OLD', content: 'e30=' }) };
    });
    const api = factory(L, fetch);
    const st = await api.publishFile('r/x', 'TOK', 'logs/a.json', {});
    assert.match(st, /github-log-put 403/);
  });
});
describe('syncNow: флаги, очистки, идемпотентность', () => {
  it('переименование категории: свежее побеждает', async () => {
    const remote = seedAt(200);
    L.setCategoryName(remote.catalog, 0, 'Новое', 200);
    const fetch = stubFetch(async () => fileResp('AAA', remote));
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 100);
    L.setCategoryName(local.catalog, 0, 'Старое', 100);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pulled');
    assert.equal(res.state.catalog.categories[0].name, 'Новое');
  });

  it('галочка «куплен» синкается с флагом', async () => {
    const remote = seedAt(200);
    L.incProduct(remote.catalog, 0, 0, 200);
    L.setChecked(remote.catalog, 0, 0, true, 200);
    const fetch = stubFetch(async () => fileResp('AAA', remote));
    const api = factory(L, fetch);
    const res = await api.syncNow(stateWith(L.seedCatalog(), 100));
    assert.equal(res.status, 'pulled');
    assert.equal(res.state.catalog.categories[0].products[0].checked, true);
  });

  it('очистка побеждает старые количества', async () => {
    const remote = seedAt(100);
    L.incProduct(remote.catalog, 0, 0, 100);
    let sent = null;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        sent = decodePut({ opts }).state;
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 150);
    L.clearList(local.catalog, 200);
    local.updatedAt = 200;
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
    assert.equal(sent.catalog.categories[0].products[0].qty, 0);
  });

  it('новое добавление побеждает старую очистку', async () => {
    const remote = seedAt(300);
    L.incProduct(remote.catalog, 0, 0, 300);
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') return { status: 201, ok: true, json: async () => ({}) };
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 150);
    L.clearList(local.catalog, 200);
    local.updatedAt = 200;
    const res = await api.syncNow(local);
    // количество подтянуто (статус merged: заодно опубликованы свежие метки)
    assert.equal(res.state.catalog.categories[0].products[0].qty, 1);
  });

  it('422 на первом PUT — ретрай', async () => {
    const remote = seedAt(100);
    let puts = 0;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        puts += 1;
        if (puts === 1) return errResp(422, 'stale');
        return { status: 201, ok: true, json: async () => ({}) };
      }
      return fileResp('AAA', remote);
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    const res = await api.syncNow(local);
    assert.equal(res.status, 'pushed');
    assert.equal(puts, 2);
  });

  it('повторный синк идемпотентен: второй раз in-sync', async () => {
    let stored = seedAt(100);
    let sha = 'AAA';
    let puts = 0;
    const fetch = stubFetch(async (url, opts) => {
      if (opts.method === 'PUT') {
        puts += 1;
        sha = 'sha' + puts;
        stored = decodePut({ opts }).state;
        return { status: 200, ok: true, json: async () => ({ sha }) };
      }
      return fileResp(sha, JSON.parse(JSON.stringify(stored)));
    });
    const api = factory(L, fetch);
    const local = stateWith(L.seedCatalog(), 200);
    L.incProduct(local.catalog, 0, 0, 200);
    assert.equal((await api.syncNow(local)).status, 'pushed');
    assert.equal((await api.syncNow(local)).status, 'in-sync');
    assert.equal(puts, 1);
  });
});
