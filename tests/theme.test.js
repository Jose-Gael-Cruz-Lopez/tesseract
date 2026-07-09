// @vitest-environment happy-dom
import { test, expect, beforeEach, vi } from 'vitest';
import { initTheme, setTheme, getTheme } from '../src/ui/theme.js';

const PREFS_KEY = 'ms:prefs';

// Recent Node versions ship a native (experimental) `localStorage` global that
// happy-dom's vitest environment does not override (it only overrides keys on
// its fixed allowlist, and `localStorage` predates that global existing).
// Without `--localstorage-file` that native binding throws on every call, so
// tests get a real, spec-compliant in-memory Storage instead.
function installMemoryLocalStorage() {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  installMemoryLocalStorage();
  document.documentElement.removeAttribute('data-theme');
  mockMatchMedia(false); // system prefers light by default
});

test('imports', async () => {
  await import('../src/ui/theme.js');
});

test("setTheme('dark') sets <html data-theme='dark'>", () => {
  setTheme('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test("setTheme('light') sets <html data-theme='light'>", () => {
  setTheme('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('setTheme persists the pref so a fresh initTheme() re-applies it', () => {
  setTheme('dark');
  // simulate a fresh page load: DOM attribute reset, localStorage untouched
  document.documentElement.removeAttribute('data-theme');
  expect(document.documentElement.dataset.theme).toBeUndefined();

  initTheme();

  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('getTheme() returns the saved mode', () => {
  setTheme('dark');
  expect(getTheme()).toBe('dark');
});

test("setTheme('system') follows a mocked matchMedia — dark", () => {
  mockMatchMedia(true);
  setTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(getTheme()).toBe('system');
});

test("setTheme('system') follows a mocked matchMedia — light", () => {
  mockMatchMedia(false);
  setTheme('system');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(getTheme()).toBe('system');
});

test('initTheme() defaults to light when no preference is saved (matches the light reference design)', () => {
  mockMatchMedia(true); // even on a dark-preferring OS, the unset default is light
  initTheme();
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(getTheme()).toBe('light');
});

test('setTheme persists under the ms:prefs key without clobbering sibling prefs', () => {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ startPage: 'home', sidebarCollapsed: true }));

  setTheme('dark');

  const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
  expect(saved.theme).toBe('dark');
  expect(saved.startPage).toBe('home');
  expect(saved.sidebarCollapsed).toBe(true);
});

test('setTheme writes only under the ms: namespace (never mnemo:*)', () => {
  setTheme('dark');
  expect(localStorage.getItem('mnemo:prefs')).toBeNull();
  expect(localStorage.getItem(PREFS_KEY)).not.toBeNull();
});
