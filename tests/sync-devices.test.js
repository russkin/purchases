'use strict';
/* Сценарий двух устройств через общий файл:
 * 1. А меняет список, публикует.
 * 2. Б забирает изменения, правит, публикует.
 * 3. А (без промежуточного синка) правит своё, перед публикацией
 *    скачивает сервер, объединяет с локальным, публикует.
 * 4. Б забирает — все правки корректно объединены.
 *
 * Время подменяется (Date.now), GitHub эмулируется с sha-семантикой:
 * PUT со stale sha → 409.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const factory = require('../sync.js');

let fakeNow = 0;
let realNow = null;

function deviceState(catalog, t) {
  return { catalog, settings: { mode: 'add', repo: 'r/x', token: 'TOK' }, updatedAt: t };
}

/* Фейковый GitHub Contents API: один файл, sha на каждую запись. */
function fakeGitHub() {
  const srv = {
    file: null, // { sha, state }
    n: 0,
    async fetch(url, opts) {
      opts = opts || {};
      if (opts.method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (srv.file && body.sha !== srv.file.sha) {
          return { status: 409, ok: false, json: async () => ({ message: 'conflict' }) };
        }
        if (!srv.file && body.sha) {
          return { status: 422, ok: false, json: async () => ({ message: 'no file' }) };
        }
        srv.n += 1;
        const state = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        srv.file = { sha: 'sha' + srv.n, state };
        return { status: 200, ok: true, json: async () => ({ sha: srv.file.sha }) };
      }
      if (!srv.file) {
        return { status: 404, ok: false, json: async () => ({ message: 'not found' }) };
      }
      return {
        status: 200, ok: true,
        json: async () => ({
          sha: srv.file.sha,
          content: Buffer.from(JSON.stringify(srv.file.state)).toString('base64')
        })
      };
    }
  };
  return srv;
}

function qty(catalog, ci, pi) {
  return catalog.categories[ci].products[pi].qty;
}

describe('два устройства: правки объединяются через сервер', () => {
  beforeEach(() => {
    realNow = Date.now;
    fakeNow = 1000;
    Date.now = () => fakeNow;
  });
  afterEach(() => { Date.now = realNow; });

  it('А→Б→А→Б без потерь', async () => {
    const srv = fakeGitHub();
    const devA = factory(L, srv.fetch);
    const devB = factory(L, srv.fetch);

    // 1. А: молоко ×1 в t=1000, публикует (файла ещё нет).
    const a = deviceState(L.seedCatalog(), 1000);
    L.incProduct(a.catalog, 0, 0, 1000);
    let res = await devA.syncNow(a);
    assert.equal(res.status, 'pushed');
    assert.equal(qty(srv.file.state.catalog, 0, 0), 1);

    // 2. Б: свежий seed в t=1500, забирает изменения…
    fakeNow = 1500;
    const b = deviceState(L.seedCatalog(), 1500);
    res = await devB.syncNow(b);
    assert.equal(res.status, 'pulled');
    assert.equal(qty(b.catalog, 0, 0), 1);
    // …вносит свои (хлеб ×1 в t=2000), публикует.
    fakeNow = 2000;
    L.incProduct(b.catalog, 1, 0, 2000);
    b.updatedAt = 2000;
    res = await devB.syncNow(b);
    assert.equal(res.status, 'pushed');
    assert.equal(qty(srv.file.state.catalog, 0, 0), 1);
    assert.equal(qty(srv.file.state.catalog, 1, 0), 1);

    // 3. А без промежуточного синка правит кефир ×1 в t=2500.
    // Перед публикацией скачивает сервер и объединяет.
    fakeNow = 2500;
    L.incProduct(a.catalog, 0, 1, 2500);
    a.updatedAt = 2500;
    res = await devA.syncNow(a);
    assert.equal(res.status, 'merged');
    assert.equal(qty(srv.file.state.catalog, 0, 0), 1); // молоко цело
    assert.equal(qty(srv.file.state.catalog, 1, 0), 1); // хлеб подтянут
    assert.equal(qty(srv.file.state.catalog, 0, 1), 1); // кефир опубликован

    // 4. Б забирает — всё объединено корректно.
    res = await devB.syncNow(b);
    assert.equal(res.status, 'pulled');
    assert.equal(qty(b.catalog, 0, 0), 1);
    assert.equal(qty(b.catalog, 1, 0), 1);
    assert.equal(qty(b.catalog, 0, 1), 1);
    assert.equal(b.catalog.categories[0].name, 'Молочка');
    assert.equal(L.activeCount(b.catalog), 3);
  });

  it('протухший sha приводит к ретраю, а не потере', async () => {
    const srv = fakeGitHub();
    const devA = factory(L, srv.fetch);
    const devB = factory(L, srv.fetch);
    const a = deviceState(L.seedCatalog(), 1000);
    L.incProduct(a.catalog, 0, 0, 1000);
    assert.equal((await devA.syncNow(a)).status, 'pushed');

    // Б читает, затем А успевает запушить раньше PUT Б.
    const b = deviceState(L.seedCatalog(), 1500);
    assert.equal((await devB.syncNow(b)).status, 'pulled');
    fakeNow = 2000;
    L.incProduct(b.catalog, 1, 0, 2000);
    b.updatedAt = 2000;
    const c = deviceState(L.seedCatalog(), 1500);
    L.incProduct(c.catalog, 0, 1, 1900);
    c.updatedAt = 1900;
    // С одновременно подтягивает молоко/хлеб и публикует кефир.
    assert.equal((await factory(L, srv.fetch).syncNow(c)).status, 'merged');
    // PUT Б по старому sha → 409 → ретрай → merged.
    const res = await devB.syncNow(b);
    assert.equal(res.status, 'merged');
    assert.equal(qty(srv.file.state.catalog, 1, 0), 1);
    assert.equal(qty(srv.file.state.catalog, 0, 1), 1);
  });
});
