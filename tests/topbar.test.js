// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { mountTopbar } from '../src/ui/topbar.js';

// Node's experimental global localStorage throws unless configured; give the
// store a real, spec-compliant in-memory Storage so persistence works.
function installMemoryLocalStorage() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

function makeCtx(overrides = {}) {
  return {
    store,
    auth: { getSession: () => null },
    toast: vi.fn(),
    goHome: vi.fn(),
    openPage: vi.fn(),
    openShare: vi.fn(),
    toggleComments: vi.fn(),
    openImport: vi.fn(),
    openTrash: vi.fn(),
    ...overrides,
  };
}

let container;
beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => vi.useRealTimers());

// Open the ••• menu and return its root element.
function openMoreMenu() {
  container.querySelector('.tb-more').click();
  return document.querySelector('.tb-menu');
}

test('imports', async () => {
  await import('../src/ui/topbar.js');
});

describe('breadcrumb', () => {
  test('setPage(null) shows only the workspace name and no page controls', () => {
    store.seedWorkspace({ name: 'Ada', email: 'ada@x.io' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(null);

    expect(container.textContent).toContain("Ada's Mnemosphere");
    expect(container.querySelector('.tb-share')).toBeNull();
    expect(container.querySelector('.tb-more')).toBeNull();
    expect(container.querySelector('.tb-edited')).toBeNull();
  });

  test('the workspace-name button calls ctx.goHome()', () => {
    store.seedWorkspace({ name: 'Ada' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(null);
    container.querySelector('.tb-workspace').click();
    expect(ctx.goHome).toHaveBeenCalled();
  });

  test('setPage(page) shows the title and "Edited just now"', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);

    expect(container.querySelector('.tb-page-title').textContent).toBe('Design Thinking');
    expect(container.querySelector('.tb-edited').textContent).toBe('Edited just now');
  });

  test('a blank title renders as "Untitled"', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: '' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);
    expect(container.querySelector('.tb-page-title').textContent).toBe('Untitled');
  });

  test('a sub-page shows "Parent / Child" with a separator', () => {
    store.seedWorkspace({ name: 'Ada' });
    const parent = store.createPage({ title: 'Parent' });
    const child = store.createPage({ title: 'Child', parentId: parent.id });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(child);

    expect(container.querySelector('.tb-parent').textContent).toBe('Parent');
    expect(container.querySelector('.tb-sep')).not.toBeNull();
    expect(container.querySelector('.tb-page-title').textContent).toBe('Child');
  });

  test('the parent crumb opens the parent page', () => {
    store.seedWorkspace({ name: 'Ada' });
    const parent = store.createPage({ title: 'Parent' });
    const child = store.createPage({ title: 'Child', parentId: parent.id });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(child);
    container.querySelector('.tb-parent').click();
    expect(ctx.openPage).toHaveBeenCalledWith(parent.id);
  });
});

describe('right-side controls', () => {
  test('the Share button calls ctx.openShare(anchor, pageId)', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    container.querySelector('.tb-share').click();
    expect(ctx.openShare).toHaveBeenCalled();
    expect(ctx.openShare.mock.calls[0][1]).toBe(page.id);
  });

  test('the comment icon calls ctx.toggleComments(pageId)', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    container.querySelector('.tb-comment').click();
    expect(ctx.toggleComments).toHaveBeenCalledWith(page.id);
  });

  test('the clock icon toasts "Coming soon"', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    container.querySelector('.tb-clock').click();
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });

  test('the star toggles favorite in the store', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);
    expect(store.getPage(page.id).favorite).toBe(false);
    container.querySelector('.tb-fav').click();
    expect(store.getPage(page.id).favorite).toBe(true);
  });
});

describe('••• page menu', () => {
  const EXPECTED = [
    'Style', 'Default', 'Serif', 'Mono',
    'Small text', 'Full width',
    'Move to', '⌘⇧P', 'Customize page', 'Lock page',
    'Add to Favorites', 'Copy link', '⌘⌥L', 'Duplicate', '⌘D', 'Open in Mac app',
    'Undo', '⌘Z', 'Page history', 'Page analytics', 'Show deleted pages', 'Delete',
    'Import', 'Export', 'PDF, HTML, Markdown',
    'Connections', 'Add connections',
  ];

  test('lists every item string from the reference', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);
    const menu = openMoreMenu();
    expect(menu).not.toBeNull();
    for (const label of EXPECTED) {
      expect(menu.textContent).toContain(label);
    }
  });

  test('Lock page toggles the persisted `locked` flag the editor obeys', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);
    const menu = openMoreMenu();
    const lock = [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.includes('Lock page'));
    lock.click();
    expect(store.getPage(page.id).locked).toBe(true);
  });

  test('a font card persists the chosen font via updatePage', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const bar = mountTopbar(container, makeCtx());
    bar.setPage(page);
    const menu = openMoreMenu();
    menu.querySelector('.tb-font[data-font="serif"]').click();
    expect(store.getPage(page.id).font).toBe('serif');
  });

  test('Copy link toasts "Copied"', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    const menu = openMoreMenu();
    [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.includes('Copy link')).click();
    expect(ctx.toast).toHaveBeenCalledWith('Copied');
  });

  test('Duplicate copies the page and opens the copy', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    const menu = openMoreMenu();
    [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.trim().startsWith('Duplicate')).click();
    expect(ctx.openPage).toHaveBeenCalled();
    const openedId = ctx.openPage.mock.calls[0][0];
    expect(store.getPage(openedId).title).toBe('P (1)');
  });

  test('Delete soft-deletes the page and returns home', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    const menu = openMoreMenu();
    [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.trim() === 'Delete').click();
    expect(store.getPage(page.id).deleted).toBe(true);
    expect(ctx.goHome).toHaveBeenCalled();
  });

  test('Show deleted pages routes to ctx.openTrash', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    const menu = openMoreMenu();
    [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.includes('Show deleted pages')).click();
    expect(ctx.openTrash).toHaveBeenCalled();
  });

  test('Import routes to ctx.openImport', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const ctx = makeCtx();
    const bar = mountTopbar(container, ctx);
    bar.setPage(page);
    const menu = openMoreMenu();
    [...menu.querySelectorAll('.tb-mrow')].find((r) => r.textContent.trim() === 'Import').click();
    expect(ctx.openImport).toHaveBeenCalled();
  });
});
