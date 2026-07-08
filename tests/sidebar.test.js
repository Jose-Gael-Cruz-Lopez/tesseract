// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { mountSidebar } from '../src/ui/sidebar.js';
import { openTrash } from '../src/ui/trash.js';

const TOP_LEVEL = [
  'Getting Started',
  'Quick Note',
  'Personal Home',
  'Task List',
  'Journal',
  'Reading List',
];

// Node v25 ships a native experimental `localStorage` global that throws on
// every call under the happy-dom test env unless `--localstorage-file` is set.
// Swap in a spec-compliant in-memory Storage so store/prefs writes succeed.
// (Pattern copied verbatim from tests/theme.test.js.)
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
    openPage: vi.fn(),
    openSearch: vi.fn(),
    openUpdates: vi.fn(),
    openSettings: vi.fn(),
    openTeamspace: vi.fn(),
    openTemplates: vi.fn(),
    openImport: vi.fn(),
    openTrash: vi.fn(),
    logOut: vi.fn(),
    toast: vi.fn(),
    ...overrides,
  };
}

let ctx;

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const api = mountSidebar(container, ctx);
  return { container, api };
}

const topRows = (container) =>
  [...container.querySelectorAll('.sb-tree > .sb-tree-node > .sb-tree-row')];
const titleText = (container, sel = '.sb-page-title') =>
  [...container.querySelectorAll(sel)].map((e) => e.textContent);
const rowByTitle = (container, title) =>
  topRows(container).find((r) => r.querySelector('.sb-page-title').textContent === title);

beforeEach(() => {
  installMemoryLocalStorage();
  document.body.innerHTML = '';
  store.resetStore();
  store.seedWorkspace({ name: 'Ada', email: 'ada@example.com' });
  ctx = makeCtx();
});

test('imports sidebar', async () => {
  await import('../src/ui/sidebar.js');
});

test('imports trash', async () => {
  await import('../src/ui/trash.js');
});

describe('sidebar tree', () => {
  test('renders the six seed page titles in sidebar order', () => {
    const { container } = mount();
    expect(topRows(container).map((r) => r.querySelector('.sb-page-title').textContent)).toEqual(TOP_LEVEL);
  });

  test('the Search nav row calls ctx.openSearch', () => {
    const { container } = mount();
    container.querySelector('[data-sb-nav="search"]').click();
    expect(ctx.openSearch).toHaveBeenCalledTimes(1);
  });

  test('a twisty expands the row and reveals its children', () => {
    const { container } = mount();
    expect(titleText(container)).not.toContain('Basics');
    rowByTitle(container, 'Getting Started').querySelector('.sb-twisty').click();
    expect(titleText(container)).toContain('Basics');
  });

  test('the + on a row creates a child page and opens it', () => {
    const { container } = mount();
    const gs = store.topLevelPages().find((p) => p.title === 'Getting Started');
    const before = store.childrenOf(gs.id).length;
    rowByTitle(container, 'Getting Started').querySelector('.sb-add-child').click();
    expect(store.childrenOf(gs.id).length).toBe(before + 1);
    expect(ctx.openPage).toHaveBeenCalledTimes(1);
    const openedId = ctx.openPage.mock.calls[0][0];
    expect(store.getPage(openedId).parentId).toBe(gs.id);
  });

  test('starring a page then refreshing shows the Favorites section with that page', () => {
    const { container, api } = mount();
    expect(container.querySelector('.sb-favorites')).toBeNull();
    const gs = store.topLevelPages().find((p) => p.title === 'Getting Started');
    store.toggleFavorite(gs.id);
    api.refresh();
    const fav = container.querySelector('.sb-favorites');
    expect(fav).not.toBeNull();
    expect(fav.textContent).toContain('Favorites');
    expect([...fav.querySelectorAll('.sb-page-title')].map((e) => e.textContent)).toContain('Getting Started');
  });

  test('setActivePage marks the matching row active', () => {
    const { container, api } = mount();
    const gs = store.topLevelPages().find((p) => p.title === 'Getting Started');
    api.setActivePage(gs.id);
    const active = container.querySelector('.sb-tree-row.is-active');
    expect(active).not.toBeNull();
    expect(active.querySelector('.sb-page-title').textContent).toBe('Getting Started');
  });

  test('the + Add a page row creates a top-level page and opens it', () => {
    const { container } = mount();
    const before = store.topLevelPages().length;
    container.querySelector('[data-sb-add-page]').click();
    expect(store.topLevelPages().length).toBe(before + 1);
    expect(ctx.openPage).toHaveBeenCalledTimes(1);
  });
});

describe('sidebar chrome', () => {
  test('the collapse button persists the sidebarCollapsed pref', () => {
    const { container } = mount();
    expect(store.getPrefs().sidebarCollapsed).toBeFalsy();
    container.querySelector('.sb-collapse').click();
    expect(store.getPrefs().sidebarCollapsed).toBe(true);
  });

  test('teamspaces render above the second group when the workspace has any', () => {
    const { container, api } = mount();
    expect(container.querySelector('.sb-teamspaces')).toBeNull();
    store.addTeamspace({ name: 'Engineering' });
    api.refresh();
    const ts = container.querySelector('.sb-teamspaces');
    expect(ts).not.toBeNull();
    expect(ts.textContent).toContain('Teamspaces');
    expect(ts.textContent).toContain('Engineering');
  });

  test('the second-group rows route through ctx', () => {
    const { container } = mount();
    container.querySelector('[data-sb-action="templates"]').click();
    container.querySelector('[data-sb-action="import"]').click();
    container.querySelector('[data-sb-action="teamspace"]').click();
    expect(ctx.openTemplates).toHaveBeenCalledTimes(1);
    expect(ctx.openImport).toHaveBeenCalledTimes(1);
    expect(ctx.openTeamspace).toHaveBeenCalledTimes(1);
  });

  test('the first-run tip renders exactly the brief copy and dismisses on OK', () => {
    const { container } = mount();
    const tip = document.querySelector('.sb-tip');
    expect(tip).not.toBeNull();
    expect(tip.querySelector('.sb-tip-title').textContent).toBe(
      'Here are some templates to help you get started',
    );
    expect(tip.querySelector('.sb-tip-body').textContent).toBe(
      'Use them out of the box, or customize them to your own workflows.',
    );
    tip.querySelector('.sb-tip-ok').click();
    expect(document.querySelector('.sb-tip')).toBeNull();
    expect(store.getPrefs().tipDismissed).toBe(true);
    // A fresh mount no longer shows it.
    mount();
    expect(document.querySelector('.sb-tip')).toBeNull();
  });

  test('Clear templates empties Getting Started and removes the other seed pages', () => {
    mount();
    document.querySelector('.sb-tip-clear').click();
    const tops = store.topLevelPages();
    expect(tops.map((p) => p.title)).toEqual(['Getting Started']);
    expect(store.getPage(tops[0].id).blocks).toBe('');
    expect(store.getPrefs().tipDismissed).toBe(true);
  });
});

describe('trash popover', () => {
  function openTrashPop() {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openTrash(anchor, ctx);
    return document.querySelector('.tr-pop');
  }

  test('lists a deleted page and restore returns it to the tree', () => {
    const { container } = mount();
    const gs = store.topLevelPages().find((p) => p.title === 'Getting Started');
    store.deletePage(gs.id);
    expect(titleText(container)).not.toContain('Getting Started');

    const pop = openTrashPop();
    expect(pop).not.toBeNull();
    const row = [...pop.querySelectorAll('.tr-row')].find((r) => r.textContent.includes('Getting Started'));
    expect(row).toBeTruthy();

    row.querySelector('.tr-restore').click();
    expect(titleText(container)).toContain('Getting Started');
  });

  test('delete-forever asks for confirmation, then destroys the page', () => {
    mount();
    const gs = store.topLevelPages().find((p) => p.title === 'Getting Started');
    store.deletePage(gs.id);

    const pop = openTrashPop();
    const row = [...pop.querySelectorAll('.tr-row')].find((r) => r.textContent.includes('Getting Started'));
    row.querySelector('.tr-delete').click();
    const confirm = pop.querySelector('.tr-confirm');
    expect(confirm.textContent).toContain('Are you sure?');
    confirm.querySelector('.tr-confirm-yes').click();
    expect(store.getPage(gs.id)).toBeUndefined();
  });

  test('shows the empty state when the trash is empty', () => {
    mount();
    const pop = openTrashPop();
    expect(pop.querySelector('.tr-empty')).not.toBeNull();
    expect(pop.querySelector('.tr-empty').textContent).toContain('No pages in Trash');
  });
});
