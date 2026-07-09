// @vitest-environment happy-dom
import { test, expect, vi, beforeEach } from 'vitest';
import { openTemplates } from '../src/ui/templates-modal.js';
import * as store from '../src/data/store.js';
import { TEMPLATES } from '../src/data/templates.js';

// Recent Node versions ship a native (experimental) `localStorage` global that
// happy-dom's vitest environment does not override, so private/public store
// writes throw without this — same polyfill as tests/theme.test.js /
// tests/store.test.js.
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

const byId = (id) => document.querySelector(`.tpl-row[data-id="${id}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  installMemoryLocalStorage();
  store.resetStore();
});

test('imports', async () => {
  await import('../src/ui/templates-modal.js');
});

test('renders a 1150-wide .mod-box.tpl-modal', () => {
  openTemplates(makeCtx());
  expect(document.querySelector('.mod-box.tpl-modal')).not.toBeNull();
});

test('renders the search input with exact placeholder', () => {
  openTemplates(makeCtx());
  const input = document.querySelector('.tpl-search-input');
  expect(input).not.toBeNull();
  expect(input.getAttribute('placeholder')).toBe('Search templates');
});

test('renders the static "All templates" dropdown chip verbatim and it toasts Coming soon', () => {
  const ctx = makeCtx();
  openTemplates(ctx);
  const chip = document.querySelector('.tpl-all-chip');
  expect(chip.textContent).toBe('👤 All templates ⌄');
  chip.click();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

test('rail lists all 19 templates under the 4 exact category labels, in rail order', () => {
  openTemplates(makeCtx());

  const labels = [...document.querySelectorAll('.tpl-cat-label')].map((n) => n.textContent);
  expect(labels).toEqual(['Suggested', 'Design', 'Life', 'Product management']);

  const rows = document.querySelectorAll('.tpl-row');
  expect(rows.length).toBe(19);
  expect(TEMPLATES.length).toBe(19);

  // Walk the rail in DOM order and regroup by the label that precedes each
  // row — this must match src/data/templates.js's category grouping exactly.
  const groups = {};
  let current = null;
  for (const node of document.querySelectorAll('.tpl-rail-list > *')) {
    if (node.classList.contains('tpl-cat-label')) {
      current = node.textContent;
      groups[current] = [];
    } else {
      groups[current].push(node.querySelector('.tpl-row-name').textContent);
    }
  }

  expect(groups['Suggested']).toEqual([
    'To-do list', 'Projects & tasks', 'Projects, tasks & sprints', 'Meetings', 'Docs',
  ]);
  expect(groups['Design']).toEqual([
    'Design Sprint', 'Design System', 'Design Portfolio', 'User Research Database', 'Remote Brainstorming',
  ]);
  expect(groups['Life']).toEqual([
    'Reading List', 'Habit Tracker', 'Simple Budget', 'Weekly To-do List', 'Travel Planner',
  ]);
  expect(groups['Product management']).toEqual([
    '1:1 Notes', 'Product Wiki', 'Product Spec', 'Vision and strategy',
  ]);
});

test('every row renders its catalog icon + name', () => {
  openTemplates(makeCtx());
  const row = byId('design-system');
  expect(row.querySelector('.tpl-row-icon').textContent).toBe('🖌');
  expect(row.querySelector('.tpl-row-name').textContent).toBe('Design System');
});

test('the first template (To-do list) is selected by default with the active row highlighted', () => {
  openTemplates(makeCtx());
  const active = document.querySelectorAll('.tpl-row.is-active');
  expect(active.length).toBe(1);
  expect(active[0].dataset.id).toBe('todo-list');
});

test('clicking a row moves the active highlight and swaps the preview title', () => {
  openTemplates(makeCtx());
  expect(document.querySelector('.tpl-preview-title').textContent).toBe('To-dos');

  byId('design-system').click();

  expect(document.querySelector('.tpl-preview-title').textContent).toBe('Design System');
  const active = document.querySelectorAll('.tpl-row.is-active');
  expect(active.length).toBe(1);
  expect(active[0].dataset.id).toBe('design-system');
});

test('search filters the rail to matching templates and hides empty categories', () => {
  openTemplates(makeCtx());
  const input = document.querySelector('.tpl-search-input');
  input.value = 'design system';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const names = [...document.querySelectorAll('.tpl-row-name')].map((n) => n.textContent);
  expect(names).toEqual(['Design System']);
  const labels = [...document.querySelectorAll('.tpl-cat-label')].map((n) => n.textContent);
  expect(labels).toEqual(['Design']);
});

test('clearing the search restores the full 19-row rail', () => {
  openTemplates(makeCtx());
  const input = document.querySelector('.tpl-search-input');
  input.value = 'design system';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  expect(document.querySelectorAll('.tpl-row').length).toBe(19);
});

test('default preview renders the To-do list mini table exactly (headers, first row)', () => {
  openTemplates(makeCtx());

  expect(document.querySelector('.tpl-preview-title').textContent).toBe('To-dos');

  const headers = [...document.querySelectorAll('.tpl-preview-table th')].map((th) => th.textContent);
  expect(headers).toEqual(['Aa Task name', '👤 Assign', '🗓 Due']);

  const firstRow = document.querySelectorAll('.tpl-preview-table tbody tr')[0];
  const cells = [...firstRow.children].map((td) => td.textContent);
  expect(cells[0]).toContain('Write project brief');
  expect(cells[1]).toBe('Sohrab Amin');
  expect(cells[2]).toBe('November 30, 2022');
});

test('selecting Design System renders a gallery preview with a colored status tag', () => {
  openTemplates(makeCtx());
  byId('design-system').click();

  expect(document.querySelectorAll('.tpl-gallery-card').length).toBe(4);
  const greenTag = document.querySelector('.tpl-tag-green');
  expect(greenTag).not.toBeNull();
  expect(greenTag.textContent).toBe('Current');
});

test('selecting a plain doc template renders its intro paragraph', () => {
  openTemplates(makeCtx());
  byId('meetings').click();

  const doc = document.querySelector('.tpl-preview-doc');
  expect(doc).not.toBeNull();
  expect(doc.textContent).toContain('Capture the agenda before the meeting');
});

test('the bottom-docked card shows the catalog name/description/madeBy for the selected template (not the built page title)', () => {
  openTemplates(makeCtx());
  // default selection is To-do list; built page title is "To-dos" but the
  // footer card must show the catalog name "To-do list" per 19.png.
  expect(document.querySelector('.tpl-footer-name').textContent).toBe('To-do list');
  expect(document.querySelector('.tpl-footer-desc').textContent).toBe(
    'Simple task management — create, organize, and track your tasks.',
  );
  expect(document.querySelector('.tpl-get-btn').textContent).toBe('Get template');
  expect(document.querySelector('.tpl-made-by').textContent).toBe('Made by Mnemosphere');
});

test('Get template on a plain doc template creates a top-level page, opens it, and closes the modal', () => {
  const ctx = makeCtx();
  openTemplates(ctx);
  byId('meetings').click();

  const before = store.getPages().length;
  document.querySelector('.tpl-get-btn').click();

  const pages = store.getPages();
  expect(pages.length).toBe(before + 1);
  const created = pages[pages.length - 1];
  expect(created.title).toBe('Meetings');
  expect(created.icon).toEqual({ type: 'emoji', value: '🗓️' });
  expect(created.parentId).toBeNull();
  expect(typeof created.blocks).toBe('string');
  expect(created.blocks).toContain('Capture the agenda before the meeting');

  expect(ctx.openPage).toHaveBeenCalledWith(created.id);
  expect(document.querySelector('.mod-scrim')).toBeNull();
});

test('Get template on the To-do list template creates a real database page with fresh (non-shared) rows', () => {
  const ctx = makeCtx();
  openTemplates(ctx);
  // default selection is already To-do list
  document.querySelector('.tpl-get-btn').click();

  const pages = store.getPages();
  const created = pages[pages.length - 1];
  expect(created.title).toBe('To-dos');
  expect(created.blocks.type).toBe('database');
  expect(created.blocks.rows).toHaveLength(6);
  expect(created.parentId).toBeNull();
  expect(ctx.openPage).toHaveBeenCalledWith(created.id);
});

test('Get template creates independent data across two separate opens (no shared mutable rows)', () => {
  const ctx = makeCtx();
  openTemplates(ctx);
  document.querySelector('.tpl-get-btn').click(); // closes the modal
  const first = store.getPages()[store.getPages().length - 1];

  openTemplates(ctx);
  document.querySelector('.tpl-get-btn').click();
  const second = store.getPages()[store.getPages().length - 1];

  expect(second.id).not.toBe(first.id);
  expect(second.blocks.rows).not.toBe(first.blocks.rows);
});
