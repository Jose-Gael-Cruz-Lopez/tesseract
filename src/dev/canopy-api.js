// Read-only client for a canopy instance (the developer sphere's data source).
// Every call is a GET carrying the canopy read token as a bearer header; the
// URL + token come from the store's dev config. Results are normalized to
// { ok, status, data } / { ok:false, status, error } — the client never throws
// on an HTTP status, so the UI can render "unauthorized" / "offline" states.

import { getDevConfig } from '../data/store.js';

export function isConfigured() {
  // A token is required; the URL is optional. Blank URL = read same-origin
  // (the fused single-Worker deploy). A set URL targets a remote/local canopy
  // (split-dev). See getDevConfig.
  const { token } = getDevConfig();
  return !!token;
}

// fetchImpl is injectable for tests; defaults to the global fetch.
export function makeCanopyApi(fetchImpl = globalThis.fetch) {
  async function get(path) {
    const { url, token } = getDevConfig();
    if (!token) return { ok: false, status: 0, error: 'not-configured' };
    // Blank url → relative path → same-origin (fused deploy). Otherwise the
    // configured origin (split-dev / remote canopy).
    const base = (url || '').replace(/\/$/, '');
    try {
      const res = await fetchImpl(base + path, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
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
