// Read-only client for a canopy instance (the developer sphere's data source).
// Every call is a GET carrying the canopy read token as a bearer header; the
// URL + token come from the store's dev config. Results are normalized to
// { ok, status, data } / { ok:false, status, error } — the client never throws
// on an HTTP status, so the UI can render "unauthorized" / "offline" states.
//
// Data reads are hub-scoped (Phase 3): each targets /r/:owner/:repo/… for the
// store's active hub (getDevHub). The flat single-tenant routes (/docs, /feed,
// …) are no longer read — without a hub, reads resolve to 'no-hub' so the UI
// shows the hub picker instead. Only /auth/me and /me/repos stay unscoped.

import { getDevConfig, getDevHub, isDevAvailable } from '../data/store.js';

export function isConfigured() {
  // Developer reads work when EITHER a token is set (split-dev / remote canopy) OR a
  // same-origin GitHub session is available (the fused deploy — reads use the cookie).
  // isDevAvailable() is the synchronous runtime flag set at boot, never a fetch.
  const { token } = getDevConfig();
  return !!token || isDevAvailable();
}

// fetchImpl is injectable for tests; defaults to the global fetch.
export function makeCanopyApi(fetchImpl = globalThis.fetch) {
  async function get(path) {
    const { url, token } = getDevConfig();
    if (!token && !isDevAvailable()) return { ok: false, status: 0, error: 'not-configured' };
    // Blank url → relative path → same-origin (fused deploy). Otherwise the
    // configured origin (split-dev / remote canopy).
    const base = (url || '').replace(/\/$/, '');
    // A token authorizes via bearer (split-dev / remote); otherwise the same-origin
    // GitHub session cookie authorizes (fused deploy) — credentials:'include'.
    const init = { method: 'GET', headers: {} };
    if (token) init.headers.Authorization = 'Bearer ' + token;
    else init.credentials = 'include';
    try {
      const res = await fetchImpl(base + path, init);
      if (!res.ok) return { ok: false, status: res.status, error: 'http ' + res.status };
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, error: (e && e.message) || 'network' };
    }
  }

  // Hub-scoped read: prefixes /r/<owner/name> for the active hub. No hub selected
  // → resolve 'no-hub' without fetching (never fall back to the flat routes).
  function scoped(path) {
    const hub = getDevHub();
    if (!hub) return Promise.resolve({ ok: false, status: 0, error: 'no-hub' });
    return get('/r/' + hub + path);
  }

  return {
    getMe: () => get('/auth/me'),
    // The signed-in user's connected hubs ({ repos:[{repo, can_push}], appSlug }).
    getMyRepos: () => get('/me/repos'),
    getDocs: () => scoped('/docs'),
    getDoc: (slug) => scoped('/doc/' + encodeURIComponent(slug)),
    getFeed: () => scoped('/feed'),
    getRoadmap: () => scoped('/roadmap'),
    getDashboard: () => scoped('/me/dashboard'),
    getTriage: () => scoped('/needs-triage'),
    search: (q) => scoped('/search?q=' + encodeURIComponent(q)),
  };
}

// A default instance bound to the global fetch, for app code.
export const canopyApi = makeCanopyApi();
