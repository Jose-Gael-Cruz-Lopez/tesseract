// @vitest-environment happy-dom
import { beforeEach, test, expect } from 'vitest';
import * as store from '../src/data/store.js';
import { buildSeed, TEMPLATE_TODOS, TEMPLATE_READING } from '../src/data/seed.js';

const TOP_LEVEL = [
  'Getting Started',
  'Quick Note',
  'Personal Home',
  'Task List',
  'Journal',
  'Reading List',
];

beforeEach(() => store.resetStore());

test('buildSeed returns the six top-level pages in sidebar order', () => {
  expect(buildSeed().map((e) => e.title)).toEqual(TOP_LEVEL);
});

test('seedWorkspace creates exactly six top-level pages in order', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  expect(store.topLevelPages().map((p) => p.title)).toEqual(TOP_LEVEL);
});

test('every top-level page has exactly three sub-pages', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const counts = store.topLevelPages().map((p) => store.childrenOf(p.id).length);
  expect(counts).toEqual([3, 3, 3, 3, 3, 3]);
});

test('sub-page titles match the brief exactly', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const kids = (title) =>
    store.childrenOf(store.topLevelPages().find((p) => p.title === title).id).map((p) => p.title);
  expect(kids('Getting Started')).toEqual(['Basics', 'Shortcuts', 'FAQ']);
  expect(kids('Quick Note')).toEqual(['Groceries', 'Ideas', 'Scratchpad']);
  expect(kids('Personal Home')).toEqual(['Habit tracker', 'Recipes', 'Workout plan']);
  expect(kids('Task List')).toEqual(['Work', 'Home', 'Errands']);
  expect(kids('Journal')).toEqual(['Morning pages', 'Gratitude log', 'Dream log']);
  expect(kids('Reading List')).toEqual(['2026 books', 'Articles', 'Podcast queue']);
});

test('Task List and Reading List blocks are databases', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(byTitle('Task List').blocks.type).toBe('database');
  expect(byTitle('Reading List').blocks.type).toBe('database');
});

test('doc-only top-level pages carry HTML string blocks or empty docs', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(typeof byTitle('Getting Started').blocks).toBe('string');
  expect(byTitle('Getting Started').blocks).toContain('Welcome to Mnemosphere!');
  expect(byTitle('Quick Note').blocks).toContain('Mnemosphere Tip:');
  expect(byTitle('Personal Home').blocks).toBe('');
  expect(byTitle('Journal').blocks).toBe('');
});

test('seeded page icons and covers match the brief', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const byTitle = (t) => store.topLevelPages().find((p) => p.title === t);
  expect(byTitle('Getting Started').icon).toEqual({ type: 'emoji', value: '👋' });
  expect(byTitle('Quick Note').icon).toEqual({ type: 'emoji', value: '📌' });
  expect(byTitle('Personal Home').cover).toEqual({ type: 'preset', value: 'gradient-red' });
  expect(byTitle('Reading List').cover).toEqual({ type: 'preset', value: 'photo-books' });
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

test('seeded Reading List keeps its own database config (not the shared template)', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const reading = store.topLevelPages().find((p) => p.title === 'Reading List');
  reading.blocks.rows[0].cells[reading.blocks.columns[0].id] = 'mutated';
  expect(TEMPLATE_READING.rows[0].cells.name).toBe(
    'Who Will Teach Silicon Valley to Be Ethical?',
  );
});
