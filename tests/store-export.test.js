// Workspace export / import — the store half of "your pages can leave the
// browser". Export must NEVER include prefs: they are device-local settings
// and carry the canopy dev token (a credential).
import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as store from '../src/data/store.js';

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
    value: storage, configurable: true, writable: true,
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
});

describe('exportWorkspace', () => {
  test('captures workspace + all pages (including trashed) under a versioned format tag', () => {
    store.seedWorkspace({ name: 'Ada', email: 'ada@example.com' });
    const extra = store.createPage({ title: 'Keep me' });
    store.deletePage(extra.id); // trashed pages must survive a round trip

    const data = store.exportWorkspace();
    expect(data.format).toBe('mnemosphere-workspace');
    expect(data.version).toBe(1);
    expect(typeof data.exportedAt).toBe('string');
    expect(data.workspace.name).toBe("Ada's Mnemosphere");
    expect(data.pages.length).toBe(store.getPages().length);
    expect(data.pages.find((p) => p.id === extra.id)?.deleted).toBe(true);
  });

  test('never includes prefs — the canopy dev token lives there', () => {
    store.seedWorkspace({ name: 'Ada' });
    store.setDevConfig({ url: 'https://x', token: 'canopy_mcp_secret' });
    const data = store.exportWorkspace();
    expect(JSON.stringify(data)).not.toContain('canopy_mcp_secret');
    expect(data.prefs).toBeUndefined();
  });

  test('exported pages are copies — mutating the export never touches the store', () => {
    store.seedWorkspace({ name: 'Ada' });
    const data = store.exportWorkspace();
    data.pages[0].title = 'VANDALIZED';
    expect(store.getPages()[0].title).not.toBe('VANDALIZED');
  });
});

describe('importWorkspace', () => {
  test('round-trips an export: replaces the current workspace and pages, persists, and emits', () => {
    store.seedWorkspace({ name: 'Ada' });
    const snapshot = store.exportWorkspace();

    store.seedWorkspace({ name: 'Bob' }); // a different workspace in between
    const pagesEvents = vi.fn();
    const wsEvents = vi.fn();
    store.onStore('pages', pagesEvents);
    store.onStore('workspace', wsEvents);

    store.importWorkspace(snapshot);
    expect(store.getWorkspace().name).toBe("Ada's Mnemosphere");
    expect(store.getPages().map((p) => p.id).sort()).toEqual(snapshot.pages.map((p) => p.id).sort());
    expect(pagesEvents).toHaveBeenCalled();
    expect(wsEvents).toHaveBeenCalled();

    // persisted: a fresh init sees the imported tree
    expect(store.initStore().name).toBe("Ada's Mnemosphere");
  });

  test('prefs survive an import untouched (import restores content, not device settings)', () => {
    store.seedWorkspace({ name: 'Ada' });
    const snapshot = store.exportWorkspace();
    store.setDevConfig({ url: 'https://keep.me', token: 't' });
    store.importWorkspace(snapshot);
    expect(store.getDevConfig().url).toBe('https://keep.me');
  });

  test.each([
    ['null', null],
    ['a string', 'nope'],
    ['wrong format tag', { format: 'other', version: 1, workspace: {}, pages: [] }],
    ['unsupported version', { format: 'mnemosphere-workspace', version: 99, workspace: {}, pages: [] }],
    ['pages not an array', { format: 'mnemosphere-workspace', version: 1, workspace: {}, pages: 'x' }],
    ['workspace not an object', { format: 'mnemosphere-workspace', version: 1, workspace: null, pages: [] }],
    ['a page without an id', { format: 'mnemosphere-workspace', version: 1, workspace: { name: 'W' }, pages: [{ title: 'no id' }] }],
  ])('rejects %s without touching the current workspace', (_label, junk) => {
    store.seedWorkspace({ name: 'Ada' });
    const before = store.getPages().length;
    expect(() => store.importWorkspace(junk)).toThrow();
    expect(store.getWorkspace().name).toBe("Ada's Mnemosphere");
    expect(store.getPages().length).toBe(before);
  });
});
