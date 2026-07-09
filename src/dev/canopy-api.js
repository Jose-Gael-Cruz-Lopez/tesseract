// Read-only client for a canopy instance (the developer sphere's data source).
// Every call is a GET carrying the canopy read token as a bearer header; the
// URL + token come from the store's dev config. Results are normalized to
// { ok, status, data } / { ok:false, status, error } — the client never throws
// on an HTTP status, so the UI can render "unauthorized" / "offline" states.

import { getDevConfig, isDevAvailable } from '../data/store.js';

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

  return {
    getMe: () => get('/auth/me'),
    getDocs: () => get('/docs'),
    getDoc: (slug) => get('/doc/' + encodeURIComponent(slug)),
    getFeed: () => get('/feed'),
    getRoadmap: () => get('/roadmap'),
    getDashboard: () => get('/me/dashboard'),
    getTriage: () => get('/needs-triage'),
    search: (q) => get('/search?q=' + encodeURIComponent(q)),
  };
}

// A default instance bound to the global fetch, for app code.
export const canopyApi = makeCanopyApi();
