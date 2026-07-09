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
  expect(fetchImpl.mock.calls[0][0]).toBe('/docs');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer canopy_mcp_z');
});

test('getDocs GETs /docs with the bearer header and returns {ok, data}', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [{ slug: 'x' }] }), { status: 200 }));
  const api = makeCanopyApi(fetchImpl);
  const res = await api.getDocs();
  expect(res).toEqual({ ok: true, status: 200, data: { docs: [{ slug: 'x' }] } });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('http://localhost:8787/docs');
  expect(init.headers.Authorization).toBe('Bearer canopy_mcp_abc');
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
