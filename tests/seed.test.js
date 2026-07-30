// @vitest-environment happy-dom
import { beforeEach, test, expect } from 'vitest';
import * as store from '../src/data/store.js';
import { buildSeed, TEMPLATE_TODOS, TEMPLATE_READING } from '../src/data/seed.js';

const TOP_LEVEL = [
  'Getting Started',
  'Quick Note',
  'Task List',
];

beforeEach(() => store.resetStore());

test('buildSeed returns the top-level pages in sidebar order', () => {
  expect(buildSeed().map((e) => e.title)).toEqual(TOP_LEVEL);
});

test('seedWorkspace creates exactly the top-level pages in order', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  expect(store.topLevelPages().map((p) => p.title)).toEqual(TOP_LEVEL);
});

test('every top-level page has exactly three sub-pages', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const counts = store.topLevelPages().map((p) => store.childrenOf(p.id).length);
  // Derived from TOP_LEVEL so adding or removing a seed page doesn't need this
  // literal edited too (it did when Personal Home was removed).
  expect(counts).toEqual(TOP_LEVEL.map(() => 3));
});

test('sub-page titles match the brief exactly', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const kids = (title) =>
    store.childrenOf(store.topLevelPages().find((p) => p.title === title).id).map((p) => p.title);
  expect(kids('Getting Started')).toEqual(['Basics', 'Shortcuts', 'FAQ']);
  expect(kids('Quick Note')).toEqual(['Groceries', 'Ideas', 'Scratchpad']);
  expect(kids('Task List')).toEqual(['Work', 'Home', 'Errands']);
});

test('Task List blocks are a database', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(byTitle('Task List').blocks.type).toBe('database');
});

test('doc-only top-level pages carry HTML string blocks or empty docs', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(typeof byTitle('Getting Started').blocks).toBe('string');
  expect(byTitle('Getting Started').blocks).toContain('Welcome to Mnemosphere!');
  expect(byTitle('Quick Note').blocks).toContain('Mnemosphere Tip:');
});

test('seeded page icons match the brief', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(byTitle('Getting Started').icon).toEqual({ type: 'emoji', value: '👋' });
  expect(byTitle('Quick Note').icon).toEqual({ type: 'emoji', value: '📌' });
  expect(byTitle('Task List').icon).toEqual({ type: 'emoji', value: '✔️' });
});

// No seeded page carries a cover any more (Personal Home and Reading List, the
// only two that did, were removed from the seed). Covers remain a page feature —
// see the cover tests in editor.test.js, which now build their own page.
test('no seeded page ships with a cover', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  expect(store.topLevelPages().every((p) => !p.cover)).toBe(true);
});

test('TEMPLATE_TODOS matches the To-dos database in the brief', () => {
  expect(TEMPLATE_TODOS.type).toBe('database');
  expect(TEMPLATE_TODOS.columns.find((c) => c.kind === 'title').name).toBe('Task name');
  expect(TEMPLATE_TODOS.columns.some((c) => c.kind === 'person')).toBe(true);
  expect(TEMPLATE_TODOS.rows.length).toBe(6);
  const first = TEMPLATE_TODOS.rows[0];
  const titleCol = TEMPLATE_TODOS.columns.find((c) => c.kind === 'title').id;
  const personCol = TEMPLATE_TODOS.columns.find((c) => c.kind === 'person').id;
  expect(first.cells[titleCol]).toBe('Write project brief');
  expect(first.cells[personCol]).toBe('Sohrab Amin');
  expect(TEMPLATE_TODOS.views[0].name).toBe('Tasks');
});

test('TEMPLATE_READING matches the Reading List database in the brief', () => {
  expect(TEMPLATE_READING.type).toBe('database');
  expect(TEMPLATE_READING.rows.length).toBe(5);
  expect(TEMPLATE_READING.views.map((v) => v.name)).toEqual([
    'All',
    'Grouped by status',
    'Books',
    'Articles',
    'Film + TV',
    'Podcasts',
  ]);
  const typeCol = TEMPLATE_READING.columns.find((c) => c.name === 'Type');
  expect(typeCol.kind).toBe('select');
  expect(typeCol.options.map((o) => o.label)).toEqual(['Article', 'TV Series', 'Book']);
  const booksView = TEMPLATE_READING.views.find((v) => v.name === 'Books');
  expect(booksView.filters).toEqual([{ colId: typeCol.id, value: 'Book' }]);
  const statusView = TEMPLATE_READING.views.find((v) => v.name === 'Grouped by status');
  expect(statusView.groupBy).toBe(TEMPLATE_READING.columns.find((c) => c.name === 'Status').id);
});

// Was written against the seeded Reading List; re-expressed against Task List,
// the remaining seeded database page. The property is the point: the seed must
// deep-clone the shared template, or editing a page would corrupt the template
// every later page is built from.
test('a seeded database page keeps its own config (not the shared template)', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const tasks = store.topLevelPages().find((p) => p.title === 'Task List');
  const titleCol = TEMPLATE_TODOS.columns.find((c) => c.kind === 'title').id;
  tasks.blocks.rows[0].cells[titleCol] = 'mutated';
  expect(TEMPLATE_TODOS.rows[0].cells[titleCol]).toBe('Write project brief');
});
