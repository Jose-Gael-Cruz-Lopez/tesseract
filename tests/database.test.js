// @vitest-environment happy-dom
// Databases-lite surface (src/ui/database.js): table / grouped / gallery /
// board / stub layouts, view tabs, filter chips, cell editors, view options.
import { test, expect, vi, beforeEach } from 'vitest';
import { renderDatabase } from '../src/ui/database.js';
import { TEMPLATE_TODOS, TEMPLATE_READING } from '../src/data/seed.js';
import { TEMPLATES } from '../src/data/templates.js';

// Node v25 ships a native (experimental) localStorage global that happy-dom
// does not override; without `--localstorage-file` every call throws. Install
// a real in-memory Storage so store persistence works in tests (same pattern
// as tests/theme.test.js).
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

let container;
let ctx;

function makeCtx() {
  return { store: { updatePage: vi.fn() }, toast: vi.fn() };
}

function makePage(blocks) {
  return { id: 'page-1', title: 'Test page', blocks };
}

function render(config) {
  const page = makePage(config);
  renderDatabase(container, page, ctx);
  return page;
}

const reading = () => structuredClone(TEMPLATE_READING);
const todos = () => structuredClone(TEMPLATE_TODOS);

function tab(name) {
  return [...container.querySelectorAll('.db-tab')].find(
    (t) => t.querySelector('.db-tab-name')?.textContent === name,
  );
}

function voRow(label) {
  return [...document.querySelectorAll('.db-vo-row')].find((r) =>
    r.textContent.includes(label),
  );
}

beforeEach(() => {
  installMemoryLocalStorage();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  ctx = makeCtx();
});

test('imports', async () => {
  await import('../src/ui/database.js');
});

// ---------- table view ----------

test('Reading List config renders all 5 row titles in a table', () => {
  render(reading());
  expect(container.querySelector('.db-table')).toBeTruthy();
  const rows = [...container.querySelectorAll('.db-row')];
  expect(rows).toHaveLength(5);
  const text = container.textContent;
  for (const title of [
    'Who Will Teach Silicon Valley to Be Ethical?',
    'Netflix: explained',
    'Brave New World',
    'Crime and Punishment',
    'Sapiens: A Brief History of Humankind',
  ]) {
    expect(text).toContain(title);
  }
});

test('header row shows per-kind glyphs and column names', () => {
  render(reading());
  const header = container.querySelector('.db-hrow');
  expect(header).toBeTruthy();
  for (const name of ['Name', 'Type', 'Status', 'Score', 'Author', 'Completed', 'Link']) {
    expect(header.textContent).toContain(name);
  }
  expect(header.textContent).toContain('Aa'); // title kind glyph
});

test('view tabs render all six Reading List views with the active one marked', () => {
  render(reading());
  const names = [...container.querySelectorAll('.db-tab .db-tab-name')].map((n) => n.textContent);
  expect(names).toEqual(['All', 'Grouped by status', 'Books', 'Articles', 'Film + TV', 'Podcasts']);
  expect(tab('All').classList.contains('db-tab-active')).toBe(true);
});

test('"Books" tab filters to the 3 books and persists the active view', () => {
  const page = render(reading());
  tab('Books').click();
  const rows = [...container.querySelectorAll('.db-row')];
  expect(rows).toHaveLength(3);
  const text = container.textContent;
  expect(text).toContain('Brave New World');
  expect(text).toContain('Crime and Punishment');
  expect(text).toContain('Sapiens: A Brief History of Humankind');
  expect(text).not.toContain('Netflix: explained');
  expect(page.blocks.activeView).toBe('read-view-books');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('grouped view renders a section per status with count headers', () => {
  const config = reading();
  config.activeView = 'read-view-status';
  render(config);
  const groups = [...container.querySelectorAll('.db-group')];
  expect(groups).toHaveLength(3);
  const summary = groups.map(
    (g) => [
      g.querySelector('.db-group-head').textContent.replace(/\s+/g, ' ').trim(),
      g.querySelectorAll('.db-row').length,
    ],
  );
  expect(summary).toEqual([
    ['Not started 1', 1],
    ['In progress 1', 1],
    ['Done 3', 3],
  ]);
});

// ---------- chip bar ----------

test('chip bar shows a chip for the active view filter plus "+ Add filter"', () => {
  const config = reading();
  config.activeView = 'read-view-books';
  render(config);
  const chip = container.querySelector('.db-chip-filter');
  expect(chip.textContent).toBe('Type: Book ▾');
  expect(container.querySelector('.db-addfilter').textContent).toBe('+ Add filter');
});

test('filter chip click opens the option popover; picking re-filters and persists', () => {
  const config = reading();
  config.activeView = 'read-view-books';
  const page = render(config);
  container.querySelector('.db-chip-filter').click();
  const options = [...document.querySelectorAll('.db-opt')];
  expect(options.map((o) => o.textContent.trim())).toEqual(['Article', 'TV Series', 'Book']);
  options[0].click(); // Article
  expect(page.blocks.views.find((v) => v.id === 'read-view-books').filters[0].value).toBe('Article');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
  expect([...container.querySelectorAll('.db-row')]).toHaveLength(1);
  expect(container.textContent).toContain('Who Will Teach Silicon Valley to Be Ethical?');
});

// ---------- cell editors ----------

test('checkbox toggle writes the cell and persists via updatePage', () => {
  const page = render(todos());
  const box = container.querySelector('.db-row .db-check');
  expect(box.checked).toBe(false);
  box.click();
  expect(page.blocks.rows[0].cells.done).toBe(true);
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('stars click sets the score value and persists', () => {
  const page = render(reading());
  // first row (score 0): click the 4th star
  const stars = [...container.querySelectorAll('.db-row')[0].querySelectorAll('.db-star')];
  expect(stars).toHaveLength(5);
  stars[3].click();
  expect(page.blocks.rows[0].cells.score).toBe(4);
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
  // re-render marks 4 stars as filled
  const filled = [...container.querySelectorAll('.db-row')[0].querySelectorAll('.db-star-on')];
  expect(filled).toHaveLength(4);
});

test('title cell is inline-editable with a hover OPEN affordance; blur persists', () => {
  const page = render(reading());
  const cell = container.querySelector('.db-row .db-cell-title');
  expect(cell.querySelector('.db-open').textContent).toBe('OPEN ↗');
  const text = cell.querySelector('.db-title-text');
  expect(text.getAttribute('contenteditable')).toBe('true');
  text.textContent = 'Renamed row';
  text.dispatchEvent(new Event('blur'));
  expect(page.blocks.rows[0].cells.name).toBe('Renamed row');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('select cell shows a colored chip; picking an option persists', () => {
  const page = render(reading());
  const firstRow = container.querySelectorAll('.db-row')[0];
  const selectCell = firstRow.querySelector('.db-cell-select');
  expect(selectCell.querySelector('.db-chip').textContent).toBe('Article');
  expect(selectCell.querySelector('.db-chip').classList.contains('db-chip-gray')).toBe(true);
  selectCell.click();
  const options = [...document.querySelectorAll('.db-opt')];
  options.find((o) => o.textContent.trim() === 'Book').click();
  expect(page.blocks.rows[0].cells.type).toBe('Book');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

// ---------- footer / chrome ----------

test('"+ New" footer row adds a row and focuses its title cell', () => {
  const page = render(reading());
  container.querySelector('.db-newrow').click();
  expect(page.blocks.rows).toHaveLength(6);
  expect([...container.querySelectorAll('.db-row')]).toHaveLength(6);
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
  expect(document.activeElement?.classList.contains('db-title-text')).toBe(true);
});

test('the blue "New ▾" button adds a row', () => {
  const page = render(reading());
  const btn = container.querySelector('.db-new');
  expect(btn.textContent.replace(/\s+/g, ' ').trim()).toBe('New ▾');
  btn.click();
  expect(page.blocks.rows).toHaveLength(6);
});

test('Filter, Sort, search and "Calculate ⌄" toast Coming soon', () => {
  render(reading());
  const labels = [...container.querySelectorAll('.db-txtbtn')].map((b) => b.textContent);
  expect(labels).toEqual(['Filter', 'Sort']);
  container.querySelectorAll('.db-txtbtn')[0].click();
  container.querySelectorAll('.db-txtbtn')[1].click();
  container.querySelector('.db-search').click();
  expect(container.querySelector('.db-calc').textContent).toBe('Calculate ⌄');
  container.querySelector('.db-calc').click();
  expect(ctx.toast).toHaveBeenCalledTimes(4);
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

test('the seeded Reading List intro paragraphs render above the chrome', () => {
  const config = reading();
  config.intro = '<p>The modern day reading list includes more than just books.</p>';
  render(config);
  const intro = container.querySelector('.db-intro');
  expect(intro.textContent).toContain('The modern day reading list includes more than just books.');
  // intro sits before the chrome
  expect(intro.nextElementSibling.classList.contains('db-chrome')).toBe(true);
});

// ---------- gallery / board / stubs ----------

test('gallery layout renders cards with cover strip, title, and select chips + a "+ New" ghost card', () => {
  const config = TEMPLATES.find((t) => t.name === 'Design System').build().blocks;
  render(config);
  const cards = [...container.querySelectorAll('.db-card')];
  expect(cards).toHaveLength(4);
  expect(cards[0].querySelector('.db-card-cover')).toBeTruthy();
  expect(cards[0].querySelector('.db-card-title').textContent).toBe('Accessibility');
  const chips = [...cards[0].querySelectorAll('.db-chip')].map((c) => c.textContent);
  expect(chips).toEqual(['Current', '#a11y']);
  expect(container.querySelector('.db-card-new').textContent.trim()).toBe('+ New');
  // gallery view carries an unset Status quick-filter chip (20.png)
  expect(container.querySelector('.db-chip-filter').textContent).toBe('Status ▾');
});

test('board layout renders a column per select option with cards', () => {
  const config = reading();
  config.views = [{ id: 'v-board', name: 'Board', layout: 'board', filters: [], groupBy: 'status' }];
  config.activeView = 'v-board';
  render(config);
  const cols = [...container.querySelectorAll('.db-bcol')];
  expect(cols).toHaveLength(3);
  const done = cols.find((c) => c.textContent.includes('Done'));
  expect([...done.querySelectorAll('.db-bcard')]).toHaveLength(3);
});

test('timeline/calendar are styled stubs and tabs still switch back', () => {
  const config = reading();
  config.views = [
    { id: 'v-tl', name: 'Timeline', layout: 'timeline', filters: [], groupBy: null },
    { id: 'v-table', name: 'All', layout: 'table', filters: [], groupBy: null },
  ];
  config.activeView = 'v-tl';
  render(config);
  expect(container.querySelector('.db-stub').textContent).toContain('This view is coming soon');
  tab('All').click();
  expect(container.querySelector('.db-table')).toBeTruthy();
});

// ---------- view options panel ----------

test('⋯ opens the View options panel with layout/properties/filter/sort/group rows', () => {
  render(reading());
  container.querySelector('.db-more').click();
  const panel = document.querySelector('.pop-root.db-vopts');
  expect(panel).toBeTruthy();
  expect(panel.querySelector('.db-vo-title').textContent).toBe('View options');
  expect(panel.querySelector('.db-vo-input').value).toBe('All');
  expect(voRow('Layout').textContent).toContain('Table');
  expect(voRow('Properties').textContent).toContain('7 shown');
  expect(voRow('Filter').textContent).toContain('0 filters');
  expect(voRow('Sort').textContent).toContain('None');
  expect(voRow('Group').textContent).toContain('None');
  for (const label of ['Lock database', 'Copy link to view', 'Duplicate view', 'Delete view']) {
    expect(voRow(label)).toBeTruthy();
  }
  expect(voRow('Delete view').classList.contains('db-vo-danger')).toBe(true);
});

test('Layout row cycles the layout and persists', () => {
  const page = render(reading());
  container.querySelector('.db-more').click();
  voRow('Layout').click();
  expect(page.blocks.views[0].layout).toBe('gallery');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
  expect(container.querySelector('.db-gallery')).toBeTruthy();
  expect(voRow('Layout').textContent).toContain('Gallery');
});

test('Duplicate view appends a copy and makes it active', () => {
  const page = render(reading());
  container.querySelector('.db-more').click();
  voRow('Duplicate view').click();
  expect(page.blocks.views).toHaveLength(7);
  const copy = page.blocks.views[6];
  expect(copy.name).toBe('All (1)');
  expect(page.blocks.activeView).toBe(copy.id);
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('Delete view removes the active view and falls back to the first', () => {
  const page = render(reading());
  container.querySelector('.db-more').click();
  voRow('Delete view').click();
  expect(page.blocks.views).toHaveLength(5);
  expect(page.blocks.views.some((v) => v.id === 'read-view-all')).toBe(false);
  expect(page.blocks.activeView).toBe('read-view-status');
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('renaming the view via the name input persists and relabels the tab', () => {
  const page = render(reading());
  container.querySelector('.db-more').click();
  const input = document.querySelector('.db-vo-input');
  input.value = 'Everything';
  input.dispatchEvent(new Event('blur'));
  expect(page.blocks.views[0].name).toBe('Everything');
  expect(tab('Everything')).toBeTruthy();
  expect(ctx.store.updatePage).toHaveBeenCalledWith('page-1', { blocks: page.blocks });
});

test('Lock database / Copy link to view / Properties / Sort / Group toast Coming soon', () => {
  render(reading());
  container.querySelector('.db-more').click();
  for (const label of ['Lock database', 'Copy link to view', 'Properties', 'Sort', 'Group']) {
    voRow(label).click();
  }
  expect(ctx.toast).toHaveBeenCalledTimes(5);
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

// ---------- seeded store integration ----------

test('seeded Task List + Reading List pages render through renderDatabase and persist to the store', async () => {
  const store = await import('../src/data/store.js');
  store.resetStore();
  store.seedWorkspace({ name: 'Test', email: 'test@example.com' });
  const realCtx = { store, toast: vi.fn() };

  const taskList = store.getPages().find((p) => p.title === 'Task List');
  renderDatabase(container, taskList, realCtx);
  expect(container.textContent).toContain('Write project brief');
  container.querySelector('.db-row .db-check').click();
  expect(store.getPage(taskList.id).blocks.rows[0].cells.done).toBe(true);

  const readingList = store.getPages().find((p) => p.title === 'Reading List');
  renderDatabase(container, readingList, realCtx);
  expect(container.textContent).toContain('Brave New World');
  expect(container.querySelector('.db-intro').textContent).toContain(
    'The modern day reading list includes more than just books.',
  );
});
