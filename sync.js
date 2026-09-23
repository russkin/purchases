/* sync.js — необязательная синхронизация через GitHub Contents API.
 * Файл состояния: data/state.json в ветке main: { updatedAt, catalog }.
 * Алгоритм: скачать общий файл, попродуктово объединить с локальным
 * (QLLogic.mergeCatalogs: для каждой ячейки побеждает свежая метка ts),
 * опубликовать объединённый результат. Токен хранится только
 * в настройках на устройстве, в репозиторий не попадает.
 */
'use strict';

(function () {
  function apiBase(repo) {
    return 'https://api.github.com/repos/' + repo + '/contents/data/state.json';
  }

  function headers(token) {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token
    };
  }

  function getRemote(repo, token) {
    return fetch(apiBase(repo) + '?ref=main', { headers: headers(token) }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('github-get ' + r.status);
      return r.json();
    }).then(function (body) {
      if (!body) return null;
      var json = JSON.parse(decodeURIComponent(escape(atob(body.content.replace(/\n/g, '')))));
      return { sha: body.sha, state: json };
    });
  }

  function putRemote(repo, token, state, sha) {
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    var payload = { message: 'Sync quicklist', content: content, branch: 'main' };
    if (sha) payload.sha = sha;
    return fetch(apiBase(repo), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers(token)),
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('github-put ' + r.status);
      return r.json();
    });
  }

  function syncNow(state) {
    var repo = state.settings.repo;
    var token = state.settings.token;
    if (!token) return Promise.resolve({ status: 'no-token', state: state });
    return attempt(state, repo, token, 3).catch(function (e) {
      return { status: 'error', state: state, error: String(e && e.message || e) };
    });
  }

  /* Одна попытка: скачать → объединить → опубликовать.
   * При 409/422 (кто-то запушил между GET и PUT) перечитать и объединить заново. */
  function attempt(state, repo, token, triesLeft) {
    var L = window.QLLogic;
    return getRemote(repo, token).then(function (remote) {
      if (!remote) {
        if (L.isCatalogEmpty(state.catalog)) {
          return { status: 'in-sync', state: state };
        }
        return putRemote(repo, token, { updatedAt: state.updatedAt, catalog: state.catalog }, null)
          .then(function () { return { status: 'pushed', state: state }; });
      }
      var remoteCat = L.normalizeCatalog(remote.state.catalog);
      var mergedCat = L.mergeCatalogs(state.catalog, remoteCat);
      var localChanged = !L.catalogsEqual(mergedCat, state.catalog);
      var remoteChanged = !L.catalogsEqual(mergedCat, remoteCat);
      if (localChanged) {
        state.catalog = mergedCat;
        state.updatedAt = Date.now();
      }
      if (!remoteChanged) {
        return { status: localChanged ? 'pulled' : 'in-sync', state: state, sha: remote.sha };
      }
      var payload = {
        updatedAt: Math.max(state.updatedAt, remote.state.updatedAt || 0, Date.now()),
        catalog: mergedCat
      };
      return putRemote(repo, token, payload, remote.sha)
        .then(function () {
          state.updatedAt = payload.updatedAt;
          return { status: localChanged ? 'merged' : 'pushed', state: state };
        })
        .catch(function (e) {
          var msg = String(e && e.message || e);
          if (triesLeft > 0 && /github-put (409|422)/.test(msg)) {
            return attempt(state, repo, token, triesLeft - 1);
          }
          throw e;
        });
    });
  }

  window.QLSync = { syncNow: syncNow };
})();
