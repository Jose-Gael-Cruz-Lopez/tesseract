// @vitest-environment happy-dom
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';

beforeEach(() => store.resetStore());
afterEach(() => vi.useRealTimers());

// happy-dom does not ship a functional localStorage, and the store treats a
// missing/broken one as memory-only — so persistence tests install their own
// mock (a working one to prove reload, a throwing one to prove resilience).
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function withLocalStorage(mock, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

test('createPage fills defaults and getPage returns the live record', () => {
  const p = store.createPage({ title: 'A' });
  expect(p.id).toBeTruthy();
  expect(p.title).toBe('A');
  expect(p.parentId).toBe(null);
  expect(p.blocks).toBe('');
  expect(p.icon).toBe(null);
  expect(p.cover).toBe(null);
  expect(p.coverPos).toBe(50);
  expect(p.favorite).toBe(false);
  expect(p.deleted).toBe(false);
  expect(p.locked).toBe(false);
  expect(p.font).toBe('default');
  expect(p.smallText).toBe(false);
  expect(p.fullWidth).toBe(false);
  expect(p.teamspaceId).toBe(null);
  expect(store.getPage(p.id)).toBe(store.getPage(p.id));
  expect(store.getPage(p.id).title).toBe('A');
});

test('createPage / childrenOf / topLevelPages preserve insertion order', () => {
  const parent = store.createPage({ title: 'Parent' });
  const a = store.createPage({ title: 'A', parentId: parent.id });
  const b = store.createPage({ title: 'B', parentId: parent.id });
  const c = store.createPage({ title: 'C', parentId: parent.id });
  expect(store.childrenOf(parent.id).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  expect(store.topLevelPages().map((p) => p.id)).toEqual([parent.id]);
});

test('childrenOf and topLevelPages exclude deleted pages', () => {
  const parent = store.createPage({ title: 'Parent' });
  const a = store.createPage({ title: 'A', parentId: parent.id });
  store.createPage({ title: 'B', parentId: parent.id });
  store.deletePage(a.id);
  expect(store.childrenOf(parent.id).map((p) => p.title)).toEqual(['B']);
});

test('updatePage stamps edited and applies the patch', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const p = store.createPage({ title: 'X' });
  expect(p.created).toBe(1000);
  expect(p.edited).toBe(1000);
  vi.setSystemTime(5000);
  const updated = store.updatePage(p.id, { title: 'Y' });
  expect(updated.title).toBe('Y');
  expect(updated.edited).toBe(5000);
  expect(updated.created).toBe(1000);
});

// The canonical example from the task brief.
test('soft delete cascades and restores', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const parent = store.createPage({ title: 'P' });
  const child = store.createPage({ title: 'C', parentId: parent.id });
  store.deletePage(parent.id);
  expect(store.getPage(child.id).deleted).toBe(true);
  expect(store.trashedPages().map((p) => p.id)).toContain(parent.id);
  store.restorePage(parent.id);
  expect(store.getPage(child.id).deleted).toBe(false);
});

test('trashedPages lists deleted subtree roots, not cascaded children', () => {
  const parent = store.createPage({ title: 'P' });
  const child = store.createPage({ title: 'C', parentId: parent.id });
  store.deletePage(parent.id);
  const ids = store.trashedPages().map((p) => p.id);
  expect(ids).toContain(parent.id);
  expect(ids).not.toContain(child.id);
});

test('destroyPage hard-removes a page and its descendants', () => {
  const parent = store.createPage({ title: 'P' });
  const child = store.createPage({ title: 'C', parentId: parent.id });
  store.destroyPage(parent.id);
  expect(store.getPage(parent.id)).toBeUndefined();
  expect(store.getPage(child.id)).toBeUndefined();
  expect(store.getPages().length).toBe(0);
});

test('duplicatePage deep-copies the subtree with a " (1)" suffix', () => {
  const parent = store.createPage({ title: 'Doc', blocks: '<p>hi</p>' });
  const child = store.createPage({ title: 'Sub', parentId: parent.id });
  const copy = store.duplicatePage(parent.id);
  expect(copy.title).toBe('Doc (1)');
  expect(copy.id).not.toBe(parent.id);
  expect(copy.blocks).toBe('<p>hi</p>');
  const copyChildren = store.childrenOf(copy.id);
  expect(copyChildren.map((p) => p.title)).toEqual(['Sub']);
  expect(copyChildren[0].id).not.toBe(child.id);
  expect(store.getPage(parent.id).title).toBe('Doc');
});

test('duplicatePage clones database blocks so mutations do not alias the original', () => {
  const db = {
    type: 'database',
    columns: [{ id: 't', name: 'T', kind: 'title' }],
    rows: [{ id: 'r1', cells: { t: 'A' } }],
    views: [{ id: 'v', name: 'V', layout: 'table', filters: [], groupBy: null }],
    activeView: 'v',
  };
  const p = store.createPage({ title: 'DB', blocks: db });
  const copy = store.duplicatePage(p.id);
  copy.blocks.rows[0].cells.t = 'CHANGED';
  store.updatePage(copy.id, { blocks: copy.blocks });
  expect(store.getPage(p.id).blocks.rows[0].cells.t).toBe('A');
});

test('toggleFavorite adds and removes pages from favorites in order', () => {
  const a = store.createPage({ title: 'A' });
  const b = store.createPage({ title: 'B' });
  store.toggleFavorite(a.id);
  expect(store.favorites().map((p) => p.id)).toEqual([a.id]);
  store.toggleFavorite(b.id);
  expect(store.favorites().map((p) => p.id)).toEqual([a.id, b.id]);
  store.toggleFavorite(a.id);
  expect(store.favorites().map((p) => p.id)).toEqual([b.id]);
});

test('searchPages ranks title matches before body matches and returns a snippet', () => {
  const titleHit = store.createPage({ title: 'Alpha strategy', blocks: '<p>unrelated words</p>' });
  const bodyHit = store.createPage({
    title: 'Beta',
    blocks: '<p>this paragraph mentions alpha somewhere in the body text</p>',
  });
  const res = store.searchPages('alpha');
  const ids = res.map((r) => r.page.id);
  expect(ids).toContain(titleHit.id);
  expect(ids).toContain(bodyHit.id);
  expect(ids.indexOf(titleHit.id)).toBeLessThan(ids.indexOf(bodyHit.id));
  const bodyResult = res.find((r) => r.page.id === bodyHit.id);
  expect(bodyResult.snippet.toLowerCase()).toContain('alpha');
});

test('searchPages ignores deleted pages and empty queries', () => {
  const p = store.createPage({ title: 'Findme' });
  store.deletePage(p.id);
  expect(store.searchPages('findme')).toEqual([]);
  expect(store.searchPages('   ')).toEqual([]);
});

test('prefs round-trip through getPrefs / setPref', () => {
  store.setPref('sidebarCollapsed', true);
  store.setPref('startPage', 'home');
  expect(store.getPrefs().sidebarCollapsed).toBe(true);
  expect(store.getPrefs().startPage).toBe('home');
});

test('setPref emits a prefs event carrying { key, value }', () => {
  const seen = [];
  const cb = (d) => seen.push(d);
  store.onStore('prefs', cb);
  store.setPref('theme', 'dark');
  store.offStore('prefs', cb);
  expect(seen).toEqual([{ key: 'theme', value: 'dark' }]);
});

test("onStore('pages') fires with { type: 'create', page }", () => {
  const events = [];
  const cb = (d) => events.push(d);
  store.onStore('pages', cb);
  const p = store.createPage({ title: 'New' });
  store.offStore('pages', cb);
  expect(events.length).toBe(1);
  expect(events[0].type).toBe('create');
  expect(events[0].page.id).toBe(p.id);
});

test('addTeamspace appends to the workspace and returns the teamspace', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const ts = store.addTeamspace({ name: 'Acme', description: 'A team', icon: null });
  expect(ts.id).toBeTruthy();
  expect(store.getWorkspace().teamspaces.map((t) => t.name)).toContain('Acme');
});

test('persistence survives a module reload via initStore', async () => {
  const mock = memoryStorage();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
  try {
    store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
    const p = store.createPage({ title: 'Persisted Page' });
    // Simulate a page reload: a brand-new module instance with empty memory
    // that must reconstruct itself from storage alone.
    vi.resetModules();
    const store2 = await import('../src/data/store.js');
    const ws = store2.initStore();
    expect(ws).toBeTruthy();
    expect(ws.ownerEmail).toBe('a@b.c');
    const found = store2.getPages().find((x) => x.id === p.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Persisted Page');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('stays functional in memory when localStorage throws', () => {
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
    clear() { throw new Error('denied'); },
  };
  withLocalStorage(throwing, () => {
    store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
    expect(store.topLevelPages().length).toBe(6);
    const p = store.createPage({ title: 'Mem only' });
    expect(store.getPage(p.id).title).toBe('Mem only');
    expect(store.getPage(p.id).parentId).toBe(null);
  });
});
