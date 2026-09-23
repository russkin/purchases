/* sync.js — необязательная синхронизация через GitHub Contents API.
 * Файл состояния: data/state.json в ветке main: { updatedAt, catalog }.
 * Стратегия: last-write-wins по updatedAt. Токен хранится только
 * в настройках на устройстве (localStorage/IndexedDB), в репозиторий не попадает.
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
    return getRemote(repo, token).then(function (remote) {
      if (!remote) {
        return putRemote(repo, token, { updatedAt: state.updatedAt, catalog: state.catalog }, null)
          .then(function () { return { status: 'pushed', state: state }; });
      }
      var rTime = remote.state.updatedAt || 0;
      if (rTime > state.updatedAt) {
        state.catalog = remote.state.catalog;
        state.updatedAt = rTime;
        return { status: 'pulled', state: state, sha: remote.sha };
      }
      if (state.updatedAt > rTime) {
        return putRemote(repo, token, { updatedAt: state.updatedAt, catalog: state.catalog }, remote.sha)
          .then(function () { return { status: 'pushed', state: state }; });
      }
      return { status: 'in-sync', state: state, sha: remote.sha };
    }).catch(function (e) {
      return { status: 'error', state: state, error: String(e && e.message || e) };
    });
  }

  window.QLSync = { syncNow: syncNow };
})();
