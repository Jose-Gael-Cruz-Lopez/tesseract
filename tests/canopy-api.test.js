// @vitest-environment happy-dom
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { makeCanopyApi, isConfigured } from '../src/dev/canopy-api.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
  store.resetStore();
  store.setDevConfig({ url: 'http://localhost:8787', token: 'canopy_mcp_abc' });
  store.setDevHub('acme/widgets');
});
afterEach(() => vi.useRealTimers());

test('isConfigured reflects url + token presence', () => {
  expect(isConfigured()).toBe(true);
  store.setDevConfig({ url: '', token: '' });
  expect(isConfigured()).toBe(false);
});

test('blank url + token reads same-origin (relative path) and is configured', async () => {
  store.setDevConfig({ url: '', token: 'canopy_mcp_z' });
  expect(isConfigured()).toBe(true);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 }));
  await makeCanopyApi(fetchImpl).getDocs();
  expect(fetchImpl.mock.calls[0][0]).toBe('/r/acme/widgets/docs');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer canopy_mcp_z');
});

test('no token but dev available → reads same-origin with credentials, no bearer', async () => {
  store.setDevConfig({ url: '', token: '' });
  store.setDevAvailable(true);
  expect(isConfigured()).toBe(true);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 }));
  await makeCanopyApi(fetchImpl).getDocs();
  const [u, init] = fetchImpl.mock.calls[0];
  expect(u).toBe('/r/acme/widgets/docs');
  expect(init.credentials).toBe('include');
  expect(init.headers.Authorization).toBeUndefined();
});

test('neither token nor dev available → not-configured, no fetch', async () => {
  store.setDevConfig({ url: '', token: '' });
  store.setDevAvailable(false);
  expect(isConfigured()).toBe(false);
  const fetchImpl = vi.fn();
  const res = await makeCanopyApi(fetchImpl).getDocs();
  expect(res).toEqual({ ok: false, status: 0, error: 'not-configured' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('getDocs GETs the hub-scoped /r/:owner/:repo/docs with the bearer header and returns {ok, data}', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [{ slug: 'x' }] }), { status: 200 }));
  const api = makeCanopyApi(fetchImpl);
  const res = await api.getDocs();
  expect(res).toEqual({ ok: true, status: 200, data: { docs: [{ slug: 'x' }] } });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('http://localhost:8787/r/acme/widgets/docs');
  expect(init.headers.Authorization).toBe('Bearer canopy_mcp_abc');
});

test('every data read is hub-scoped under /r/:owner/:repo (never the flat routes)', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  const api = makeCanopyApi(fetchImpl);
  await api.getDocs();
  await api.getDoc('a b');
  await api.getFeed();
  await api.getRoadmap();
  await api.getDashboard();
  await api.getTriage();
  await api.search('x y');
  expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
    'http://localhost:8787/r/acme/widgets/docs',
    'http://localhost:8787/r/acme/widgets/doc/a%20b',
    'http://localhost:8787/r/acme/widgets/feed',
    'http://localhost:8787/r/acme/widgets/roadmap',
    'http://localhost:8787/r/acme/widgets/me/dashboard',
    'http://localhost:8787/r/acme/widgets/needs-triage',
    'http://localhost:8787/r/acme/widgets/search?q=x%20y',
  ]);
});

test('no hub selected → data reads resolve no-hub without fetching', async () => {
  store.setDevHub('');
  const fetchImpl = vi.fn();
  const api = makeCanopyApi(fetchImpl);
  for (const call of [api.getDocs(), api.getDoc('x'), api.getFeed(), api.getRoadmap(), api.getDashboard(), api.getTriage(), api.search('q')]) {
    expect(await call).toEqual({ ok: false, status: 0, error: 'no-hub' });
  }
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('getMe and getMyRepos stay unscoped even with a hub selected', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  const api = makeCanopyApi(fetchImpl);
  await api.getMe();
  await api.getMyRepos();
  expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
    'http://localhost:8787/auth/me',
    'http://localhost:8787/me/repos',
  ]);
});

test('getMyRepos returns the hub list payload', async () => {
  const payload = { repos: [{ repo: 'acme/widgets', can_push: true }], appSlug: 'canopy-app' };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  const res = await makeCanopyApi(fetchImpl).getMyRepos();
  expect(res).toEqual({ ok: true, status: 200, data: payload });
});

test('a 401 returns {ok:false, status:401}', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
  const res = await makeCanopyApi(fetchImpl).getFeed();
  expect(res.ok).toBe(false);
  expect(res.status).toBe(401);
});

test('a network throw returns {ok:false, status:0, error}', async () => {
  const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
  const res = await makeCanopyApi(fetchImpl).getRoadmap();
  expect(res.ok).toBe(false);
  expect(res.status).toBe(0);
  expect(res.error).toBeTruthy();
});
