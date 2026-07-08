// @vitest-environment happy-dom
import { beforeEach, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { openSearch } from '../src/ui/search.js';

// Node's native (experimental) `localStorage` global breaks happy-dom's
// storage in these test workers — see tests/theme.test.js for the same
// polyfill. The store mirrors to localStorage in try/catch, so a fresh
// in-memory Storage keeps `resetStore()`/`seedWorkspace()` deterministic.
function installMemoryLocalStorage() {
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function makeCtx(overrides = {}) {
  return {
    store,
    openPage: vi.fn(),
    toast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
  document.body.innerHTML = '';
});

test('imports', async () => {
  await import('../src/ui/search.js');
});

test('opens a centered modal with an autofocused, workspace-named search input', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  expect(document.querySelector('.mod-scrim')).not.toBeNull();
  const input = document.querySelector('.srch-input');
  expect(input).toBeTruthy();
  expect(input.placeholder).toBe(`Search ${store.getWorkspace().name}…`);
  expect(document.activeElement).toBe(input);
});

test('empty query shows up to 8 seeded pages grouped under "Today"', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  const rows = document.querySelectorAll('.srch-row');
  expect(rows.length).toBe(8);

  const knownTitles = new Set(store.getPages().map((p) => p.title));
  for (const row of rows) {
    const title = row.querySelector('.srch-row-title').textContent;
    expect(knownTitles.has(title)).toBe(true);
  }

  const groupLabels = [...document.querySelectorAll('.srch-group-label')].map((n) => n.textContent);
  expect(groupLabels).toEqual(['Today']);
});

test('typing "Reading" filters the results to Reading List', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  const input = document.querySelector('.srch-input');
  input.value = 'Reading';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const titles = [...document.querySelectorAll('.srch-row-title')].map((n) => n.textContent);
  expect(titles).toEqual(['Reading List']);
});

test('an empty search shows an empty state instead of stale rows', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  const input = document.querySelector('.srch-input');
  input.value = 'zzzznomatch';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  expect(document.querySelectorAll('.srch-row').length).toBe(0);
  expect(document.querySelector('.srch-empty')).not.toBeNull();
});

test('ArrowDown then Enter opens the newly-selected page and closes the modal', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  // Pin two pages to the very top of the "recent" list so selection order
  // is deterministic regardless of how close the seed timestamps land.
  const a = store.createPage({ title: 'Alpha' });
  const b = store.createPage({ title: 'Beta' });
  a.edited = Date.now() + 20000;
  b.edited = Date.now() + 10000;

  const ctx = makeCtx();
  openSearch(ctx);

  const input = document.querySelector('.srch-input');
  expect(document.querySelector('.srch-row').querySelector('.srch-row-title').textContent).toBe('Alpha');

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  expect(ctx.openPage).toHaveBeenCalledWith(b.id);
  expect(ctx.openPage).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.mod-scrim')).toBeNull();
});

test('ArrowUp from the first row wraps to the last row', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const a = store.createPage({ title: 'Alpha' });
  const b = store.createPage({ title: 'Beta' });
  a.edited = Date.now() + 20000;
  b.edited = Date.now() + 10000;

  const ctx = makeCtx();
  openSearch(ctx);
  const input = document.querySelector('.srch-input');

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

  const rows = document.querySelectorAll('.srch-row');
  const lastRow = rows[rows.length - 1];
  expect(lastRow.classList.contains('is-selected')).toBe(true);
  const lastRowTitle = lastRow.querySelector('.srch-row-title').textContent;

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  expect(ctx.openPage).toHaveBeenCalledTimes(1);
  // whichever page is currently rendered last, wrap-around Enter must open it
  const lastPage = store.getPages().find((p) => (p.title || 'Untitled') === lastRowTitle);
  expect(ctx.openPage).toHaveBeenCalledWith(lastPage.id);
});

test('⌘Enter opens the selected page same as plain Enter', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const a = store.createPage({ title: 'Alpha' });
  a.edited = Date.now() + 20000;

  const ctx = makeCtx();
  openSearch(ctx);
  const input = document.querySelector('.srch-input');

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));

  expect(ctx.openPage).toHaveBeenCalledWith(a.id);
});

test('the selected row carries is-selected and an enter-glyph badge', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  const rows = document.querySelectorAll('.srch-row');
  expect(rows[0].classList.contains('is-selected')).toBe(true);
  expect(rows[0].querySelector('.srch-row-enter')).toBeTruthy();
  expect(rows[1].classList.contains('is-selected')).toBe(false);
});

test('footer hints match the brief exactly', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());

  const footer = document.querySelector('.srch-footer');
  expect(footer.textContent.replace(/\s+/g, ' ').trim()).toBe('↑↓ Select ↵ Open ⌘↵ Open in a new tab');
});

test('a sub-page row shows its parent page name', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const parent = store.createPage({ title: 'Parent Page' });
  const child = store.createPage({ title: 'Child Page', parentId: parent.id });
  child.edited = Date.now() + 20000; // force to the very top row

  openSearch(makeCtx());

  const firstRow = document.querySelector('.srch-row');
  expect(firstRow.querySelector('.srch-row-title').textContent).toBe('Child Page');
  expect(firstRow.querySelector('.srch-row-parent').textContent).toBe('Parent Page');
});

test('a page title containing markup renders as inert text, not HTML', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const dangerous = store.createPage({ title: '<img src=x onerror="window.__pwned=true">' });
  dangerous.edited = Date.now() + 20000;

  openSearch(makeCtx());

  const firstRow = document.querySelector('.srch-row');
  expect(firstRow.querySelector('img')).toBeNull();
  expect(firstRow.querySelector('.srch-row-title').textContent).toBe(
    '<img src=x onerror="window.__pwned=true">'
  );
  expect(window.__pwned).toBeUndefined();
});

test('Escape closes the modal (inherited from openModal)', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  openSearch(makeCtx());
  expect(document.querySelector('.mod-scrim')).not.toBeNull();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  expect(document.querySelector('.mod-scrim')).toBeNull();
});
