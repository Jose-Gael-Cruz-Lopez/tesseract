// Template catalog (src/data/templates.js). Pure data — no DOM needed.
import { test, expect } from 'vitest';
import { TEMPLATES } from '../src/data/templates.js';
import { TEMPLATE_TODOS, TEMPLATE_READING } from '../src/data/seed.js';

const byName = (name) => TEMPLATES.find((t) => t.name === name);
const namesIn = (category) => TEMPLATES.filter((t) => t.category === category).map((t) => t.name);

test('imports', async () => {
  await import('../src/data/templates.js');
});

test('TEMPLATES holds all 19 templates in the 4 rail categories, in rail order', () => {
  expect(TEMPLATES).toHaveLength(19);
  expect(namesIn('Suggested')).toEqual([
    'To-do list',
    'Projects & tasks',
    'Projects, tasks & sprints',
    'Meetings',
    'Docs',
  ]);
  expect(namesIn('Design')).toEqual([
    'Design Sprint',
    'Design System',
    'Design Portfolio',
    'User Research Database',
    'Remote Brainstorming',
  ]);
  expect(namesIn('Life')).toEqual([
    'Reading List',
    'Habit Tracker',
    'Simple Budget',
    'Weekly To-do List',
    'Travel Planner',
  ]);
  expect(namesIn('Product management')).toEqual([
    '1:1 Notes',
    'Product Wiki',
    'Product Spec',
    'Vision and strategy',
  ]);
});

test('every template carries the full catalog shape', () => {
  const ids = new Set();
  for (const t of TEMPLATES) {
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
    ids.add(t.id);
    expect(typeof t.name).toBe('string');
    expect(typeof t.icon).toBe('string');
    expect(t.icon.length).toBeGreaterThan(0);
    expect(['Suggested', 'Design', 'Life', 'Product management']).toContain(t.category);
    expect(typeof t.description).toBe('string');
    expect(t.description.length).toBeGreaterThan(0);
    expect(t.madeBy).toBe('Mnemosphere');
    expect(typeof t.build).toBe('function');
  }
  expect(ids.size).toBe(19); // ids are unique
});

test('rail icons from the reference: To-do list ✔️, Design System 🖌, Reading List 📚', () => {
  expect(byName('To-do list').icon).toBe('✔️');
  expect(byName('Design System').icon).toBe('🖌');
  expect(byName('Reading List').icon).toBe('📚');
});

test('To-do list build() returns the To-dos database blocks (fresh clone of the seed config)', () => {
  const page = byName('To-do list').build();
  expect(page.title).toBe('To-dos');
  expect(page.icon).toEqual({ type: 'emoji', value: '✔️' });
  expect(page.blocks.type).toBe('database');
  expect(page.blocks).toEqual(TEMPLATE_TODOS);
  // must be a clone, not the shared seed constant
  expect(page.blocks).not.toBe(TEMPLATE_TODOS);
  expect(page.blocks.rows).not.toBe(TEMPLATE_TODOS.rows);
  // two builds never share mutable state
  expect(byName('To-do list').build().blocks.rows).not.toBe(page.blocks.rows);
});

test('Reading List build() reuses the seed Reading List config (clone)', () => {
  const page = byName('Reading List').build();
  expect(page.title).toBe('Reading List');
  expect(page.blocks).toEqual(TEMPLATE_READING);
  expect(page.blocks).not.toBe(TEMPLATE_READING);
});

test('Design System build(): gallery/list/by-status views over Name/Status/Type', () => {
  const page = byName('Design System').build();
  expect(page.title).toBe('Design System');
  const db = page.blocks;
  expect(db.type).toBe('database');

  expect(db.views.map((v) => [v.name, v.layout])).toEqual([
    ['Design System', 'gallery'],
    ['List View', 'table'],
    ['By Status', 'table'],
  ]);
  expect(db.activeView).toBe(db.views[0].id);

  const cols = db.columns;
  expect(cols.map((c) => [c.name, c.kind])).toEqual([
    ['Name', 'title'],
    ['Status', 'select'],
    ['Type', 'select'],
  ]);
  const status = cols[1];
  expect(status.options).toEqual([
    { label: 'Current', color: 'green' },
    { label: 'Needs Update', color: 'yellow' },
  ]);
  expect(db.views[2].groupBy).toBe(status.id);

  const titles = db.rows.map((r) => r.cells[cols[0].id]);
  expect(titles).toEqual(['Accessibility', 'Typography', 'Colors', 'Icons']);
  const cellsOf = (name) => db.rows.find((r) => r.cells[cols[0].id] === name).cells;
  expect(cellsOf('Accessibility')[status.id]).toBe('Current');
  expect(cellsOf('Accessibility')[cols[2].id]).toBe('#a11y');
  expect(cellsOf('Typography')[status.id]).toBe('Needs Update');
  expect(cellsOf('Typography')[cols[2].id]).toBe('Roboto');
  expect(cellsOf('Icons')[status.id]).toBe('Current');
  expect(cellsOf('Icons')[cols[2].id]).toBe('🟡');
});

test('rich template descriptions are verbatim', () => {
  expect(byName('To-do list').description).toBe(
    'Simple task management — create, organize, and track your tasks.',
  );
  expect(byName('Design System').description).toBe(
    'A design system is a great way to keep everyone aligned. Use this template to document design patterns, assets, and brand, and make assets downloadable for everyone on your team.',
  );
  expect(byName('Reading List').description).toBe(
    'The modern day reading list includes books, articles, podcasts, and videos.',
  );
});

test('all other templates build a simple doc page: name as title, icon, one intro paragraph', () => {
  const rich = new Set(['To-do list', 'Design System', 'Reading List']);
  for (const t of TEMPLATES) {
    if (rich.has(t.name)) continue;
    const page = t.build();
    expect(page.title).toBe(t.name);
    expect(page.icon).toEqual({ type: 'emoji', value: t.icon });
    expect(typeof page.blocks).toBe('string');
    expect(page.blocks.startsWith('<p>')).toBe(true);
    expect(page.blocks.endsWith('</p>')).toBe(true);
  }
});
