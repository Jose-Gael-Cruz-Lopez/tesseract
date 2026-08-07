// @vitest-environment happy-dom
// An importWorkspace / clearWorkspaceContent with a page open must close it:
// the editor renders from the store only at open(), so a page left open across
// an import is a stale DOM that the next keystroke/checkbox saves BACK over the
// freshly imported blocks (and sync then pushes the corruption to the cloud).
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from '../src/data/store.js';
import { mountApp } from '../src/app.js';

vi.mock('../src/graph/graph.js', () => ({
  initGraph: vi.fn(() => ({
    focusPage: vi.fn(), clearFocus: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(), refresh: vi.fn(),
  })),
}));

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
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

let handle;
let pageId;

beforeEach(() => {
  installMemoryLocalStorage();
  document.body.innerHTML = '<div id="root"></div>';
  store.resetStore();
  store.seedWorkspace({ name: 'Ada', email: 'ada@example.com' });
  pageId = store.topLevelPages()[0].id;
  handle = mountApp(document.getElementById('root'), {});
});

afterEach(() => { document.body.innerHTML = ''; });

describe('workspace replacement closes the open page', () => {
  test('importWorkspace with the page open → page closed, editor hidden', () => {
    store.seedWorkspace({ name: 'Backup' });
    const snapshot = store.exportWorkspace();
    store.seedWorkspace({ name: 'Ada' });
    pageId = store.topLevelPages()[0].id;

    handle.ctx.openPage(pageId);
    expect(handle.ctx.currentPageId()).toBe(pageId);

    store.importWorkspace(snapshot);
    expect(handle.ctx.currentPageId()).toBeNull();
    expect(document.getElementById('shell-page').classList.contains('show')).toBe(false);
  });

  test('clearWorkspaceContent with the page open → page closed', () => {
    handle.ctx.openPage(pageId);
    store.clearWorkspaceContent();
    expect(handle.ctx.currentPageId()).toBeNull();
  });
});
