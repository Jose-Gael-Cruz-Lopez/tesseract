// @vitest-environment happy-dom
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { mountEditor } from '../src/ui/editor.js';

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

function makeCtx() {
  return {
    store,
    openPage: vi.fn(),
    openImport: vi.fn(),
    openTemplates: vi.fn(),
    toggleComments: vi.fn(),
    toast: vi.fn(),
  };
}

let container;
let ctx;
let editor;

function seededPage(title) {
  return store.getPages().find((p) => p.title === title);
}

function openTitled(title) {
  const page = seededPage(title);
  editor.open(page.id);
  return page;
}

function newMenuRow(label) {
  return [...container.querySelectorAll('.ed-new-row')].find(
    (row) => row.textContent.trim() === label,
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
  store.seedWorkspace({ name: 'Test', email: 'test@example.com' });
  document.body.innerHTML = '<section class="shell-page" id="shell-page" aria-hidden="true"></section>';
  container = document.getElementById('shell-page');
  ctx = makeCtx();
  editor = mountEditor(container, ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

test('imports', async () => {
  await import('../src/ui/editor.js');
});

// ---------- open / close ----------

test('open(Getting Started) renders the title and the first checkbox line', () => {
  openTitled('Getting Started');
  expect(container.classList.contains('show')).toBe(true);
  expect(container.querySelector('.ed-title').textContent).toBe('Getting Started');
  const firstTodo = container.querySelector('.ed-todo');
  expect(firstTodo).not.toBeNull();
  expect(firstTodo.textContent).toContain('Click anywhere and just start typing');
});

test('open/close toggle .show and isOpen()', () => {
  expect(editor.isOpen()).toBe(false);
  openTitled('Getting Started');
  expect(editor.isOpen()).toBe(true);
  editor.close();
  expect(editor.isOpen()).toBe(false);
  expect(container.classList.contains('show')).toBe(false);
});

// ---------- body: checkboxes ----------

test('clicking a todo checkbox persists the checked state into the saved HTML', () => {
  const page = openTitled('Getting Started');
  const box = container.querySelector('.ed-todo input[type="checkbox"]');
  expect(box.hasAttribute('checked')).toBe(false);

  box.click();

  const parsed = document.createElement('div');
  parsed.innerHTML = store.getPage(page.id).blocks;
  const saved = parsed.querySelector('.ed-todo input[type="checkbox"]');
  expect(saved.hasAttribute('checked')).toBe(true);

  // clicking again unchecks and persists that too
  container.querySelector('.ed-todo input[type="checkbox"]').click();
  parsed.innerHTML = store.getPage(page.id).blocks;
  expect(parsed.querySelector('.ed-todo input[type="checkbox"]').hasAttribute('checked')).toBe(false);
});

// ---------- body: markdown-ish input rules ----------

function pressSpaceOnLine(body, text) {
  body.innerHTML = '';
  body.appendChild(document.createTextNode(text));
  const sel = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(body.firstChild);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
}

test("space after '-' / '[]' / '#' / '##' / '>' converts the line", () => {
  const page = store.createPage({ title: 'Doc', blocks: '<p>x</p>' });
  editor.open(page.id);
  const body = container.querySelector('.ed-body');

  pressSpaceOnLine(body, '-');
  expect(body.querySelector('ul li'), 'bullet list').not.toBeNull();

  pressSpaceOnLine(body, '[]');
  expect(body.querySelector('.ed-todo input[type="checkbox"]'), 'todo').not.toBeNull();

  pressSpaceOnLine(body, '#');
  expect(body.querySelector('h1'), 'h1').not.toBeNull();

  pressSpaceOnLine(body, '##');
  expect(body.querySelector('h2'), 'h2').not.toBeNull();

  pressSpaceOnLine(body, '>');
  expect(body.querySelector('details summary'), 'toggle').not.toBeNull();
});

test('a converted line persists into the saved blocks after the debounce', () => {
  const page = store.createPage({ title: 'Doc', blocks: '<p>x</p>' });
  editor.open(page.id);
  const body = container.querySelector('.ed-body');
  vi.useFakeTimers();
  pressSpaceOnLine(body, '[]');
  vi.advanceTimersByTime(400);
  expect(store.getPage(page.id).blocks).toContain('ed-todo');
});

// ---------- title editing ----------

test('title edit persists via debounced updatePage after 400ms', () => {
  const page = openTitled('Getting Started');
  vi.useFakeTimers();
  const title = container.querySelector('.ed-title');
  title.textContent = 'My Notes';
  title.dispatchEvent(new Event('input', { bubbles: true }));

  expect(store.getPage(page.id).title).toBe('Getting Started'); // not yet
  vi.advanceTimersByTime(400);
  expect(store.getPage(page.id).title).toBe('My Notes');
});

test('external title updates sync live into the open editor', () => {
  const page = openTitled('Getting Started');
  store.updatePage(page.id, { title: 'Renamed elsewhere' });
  expect(container.querySelector('.ed-title').textContent).toBe('Renamed elsewhere');
});

// ---------- new-page state ----------

test('an empty page shows all 9 new-page menu strings plus the "Add new" label', () => {
  const page = store.createPage({});
  editor.open(page.id);
  const menu = container.querySelector('.ed-new');
  expect(menu).not.toBeNull();
  for (const label of [
    'Empty page',
    'Start writing with AI',
    'Import',
    'Templates',
    'Table',
    'Board',
    'Timeline',
    'Calendar',
    'More',
  ]) {
    expect(newMenuRow(label), `menu row "${label}"`).toBeTruthy();
  }
  expect(menu.querySelector('.ed-new-label').textContent).toBe('Add new');
  // "Empty page" is the first row and is highlighted
  const first = menu.querySelector('.ed-new-row');
  expect(first.textContent.trim()).toBe('Empty page');
  expect(first.classList.contains('ed-new-hl')).toBe(true);
});

test('choosing Table swaps blocks to a fresh database config', () => {
  const page = store.createPage({});
  editor.open(page.id);
  newMenuRow('Table').click();

  const blocks = store.getPage(page.id).blocks;
  expect(blocks.type).toBe('database');
  expect(blocks.columns.map((c) => c.name)).toEqual(['Name', 'Tags']);
  expect(blocks.columns.map((c) => c.kind)).toEqual(['title', 'select']);
  expect(blocks.rows).toHaveLength(2);
  expect(blocks.views).toHaveLength(1);
  expect(blocks.views[0].layout).toBe('table');
  expect(blocks.activeView).toBe(blocks.views[0].id);
  // the menu is gone after the swap
  expect(container.querySelector('.ed-new')).toBeNull();
});

test('Board / Timeline / Calendar create their matching view layout', () => {
  for (const label of ['Board', 'Timeline', 'Calendar']) {
    const page = store.createPage({});
    editor.open(page.id);
    newMenuRow(label).click();
    expect(store.getPage(page.id).blocks.views[0].layout).toBe(label.toLowerCase());
  }
});

test('Import and Templates rows route through ctx; More toasts Coming soon', () => {
  const page = store.createPage({});
  editor.open(page.id);
  newMenuRow('Import').click();
  expect(ctx.openImport).toHaveBeenCalled();
  newMenuRow('Templates').click();
  expect(ctx.openTemplates).toHaveBeenCalled();
  newMenuRow('More').click();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

test('picking Empty page dismisses the menu; typing in the title dismisses it too', () => {
  const page = store.createPage({});
  editor.open(page.id);
  newMenuRow('Empty page').click();
  expect(container.querySelector('.ed-new')).toBeNull();

  const other = store.createPage({});
  editor.open(other.id);
  expect(container.querySelector('.ed-new')).not.toBeNull();
  const title = container.querySelector('.ed-title');
  title.textContent = 'T';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  expect(container.querySelector('.ed-new')).toBeNull();
});

test('Start writing with AI falls back to a Coming soon toast when ai.js is missing', async () => {
  const page = store.createPage({});
  editor.open(page.id);
  newMenuRow('Start writing with AI').click();
  await tick();
  await tick();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

// ---------- database delegation ----------

test('a database page renders the "Database view" placeholder when database.js is missing', async () => {
  openTitled('Reading List');
  await tick();
  await tick();
  const fallback = container.querySelector('.ed-db-fallback');
  expect(fallback).not.toBeNull();
  expect(fallback.textContent).toBe('Database view');
  // no contenteditable doc body for database pages
  expect(container.querySelector('.ed-body')).toBeNull();
});

// ---------- icon + icon picker ----------

test('the page icon renders and clicking it opens the picker with tabs and Remove', () => {
  openTitled('Getting Started');
  const icon = container.querySelector('.ed-icon');
  expect(icon.textContent).toContain('👋');
  icon.click();
  const pop = document.querySelector('.pop-root.ed-icon-pop');
  expect(pop).not.toBeNull();
  const tabs = [...pop.querySelectorAll('.ed-pick-tab')].map((t) => t.textContent);
  expect(tabs).toEqual(['Emojis', 'Icons', 'Custom']);
  expect(pop.querySelector('.ed-pick-remove').textContent).toBe('Remove');
  expect(pop.querySelector('.ed-emoji-search').getAttribute('placeholder')).toBe('Filter…');
});

test('picking an emoji persists it as the page icon', () => {
  const page = openTitled('Getting Started');
  container.querySelector('.ed-icon').click();
  const pop = document.querySelector('.pop-root.ed-icon-pop');
  const cell = pop.querySelector('.ed-emoji-cell');
  const char = cell.textContent;
  cell.click();
  expect(store.getPage(page.id).icon).toEqual({ type: 'emoji', value: char });
  expect(container.querySelector('.ed-icon').textContent).toContain(char);
});

test('the Custom tab shows both size notes and the PLUS PLANS badge', () => {
  openTitled('Getting Started');
  container.querySelector('.ed-icon').click();
  const pop = document.querySelector('.pop-root.ed-icon-pop');
  [...pop.querySelectorAll('.ed-pick-tab')].find((t) => t.textContent === 'Custom').click();
  expect(pop.textContent).toContain('Recommended size is 280 × 280 pixels');
  expect(pop.textContent).toContain('The maximum size per file is 5 MB');
  expect(pop.querySelector('.ed-badge').textContent).toBe('PLUS PLANS');
  expect(pop.querySelector('.ed-custom-input').getAttribute('placeholder')).toBe('Paste link to an image...');
  expect(pop.querySelector('.ed-custom-submit').textContent).toBe('Submit');
  expect(pop.querySelector('.ed-upload').textContent).toBe('Upload file');
});

test('uploading a file over 5 MB is rejected with a toast', () => {
  openTitled('Getting Started');
  container.querySelector('.ed-icon').click();
  const pop = document.querySelector('.pop-root.ed-icon-pop');
  [...pop.querySelectorAll('.ed-pick-tab')].find((t) => t.textContent === 'Custom').click();
  const file = pop.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', {
    value: [{ name: 'big.png', size: 6 * 1024 * 1024 }],
    configurable: true,
  });
  file.dispatchEvent(new Event('change', { bubbles: true }));
  expect(ctx.toast).toHaveBeenCalledWith('Please pick a file under 5 MB');
});

test('Remove in the icon picker clears the icon and the ghost row offers "Add icon" again', () => {
  const page = openTitled('Getting Started');
  container.querySelector('.ed-icon').click();
  document.querySelector('.pop-root.ed-icon-pop .ed-pick-remove').click();
  expect(store.getPage(page.id).icon).toBeNull();
  expect(container.querySelector('.ed-icon')).toBeNull();
  const ghost = [...container.querySelectorAll('.ed-ghost-btn')].map((b) => b.textContent.trim());
  expect(ghost).toContain('Add icon');
});

// ---------- ghost row ----------

test('ghost row shows Add icon/Add cover/Add comment as applicable and routes comments through ctx', () => {
  // Getting Started has an icon but no cover → "Add icon" hidden, "Add cover" shown
  const page = openTitled('Getting Started');
  let labels = [...container.querySelectorAll('.ed-ghost-btn')].map((b) => b.textContent.trim());
  expect(labels).toEqual(['Add cover', 'Add comment']);

  [...container.querySelectorAll('.ed-ghost-btn')]
    .find((b) => b.textContent.trim() === 'Add comment')
    .click();
  expect(ctx.toggleComments).toHaveBeenCalledWith(page.id);
});

// ---------- cover + cover picker ----------

test('a page with a cover renders it with the three hover buttons; Remove clears it', () => {
  const page = openTitled('Personal Home');
  const cover = container.querySelector('.ed-cover');
  expect(cover).not.toBeNull();
  const buttons = [...cover.querySelectorAll('.ed-cover-btn')].map((b) => b.textContent);
  expect(buttons).toEqual(['Change cover', 'Reposition', 'Remove']);

  [...cover.querySelectorAll('.ed-cover-btn')].find((b) => b.textContent === 'Remove').click();
  expect(store.getPage(page.id).cover).toBeNull();
  expect(container.querySelector('.ed-cover')).toBeNull();
});

test('Add cover opens the cover picker; picking a gallery preset persists it', () => {
  const page = openTitled('Getting Started');
  [...container.querySelectorAll('.ed-ghost-btn')]
    .find((b) => b.textContent.trim() === 'Add cover')
    .click();
  const pop = document.querySelector('.pop-root.ed-cover-pop');
  expect(pop).not.toBeNull();
  const tabs = [...pop.querySelectorAll('.ed-pick-tab')].map((t) => t.textContent);
  expect(tabs).toEqual(['Gallery', 'Link']);
  expect(pop.querySelector('.ed-pick-remove').textContent).toBe('Remove');
  expect(pop.querySelector('.ed-gallery-label').textContent).toBe('Peach');

  pop.querySelector('.ed-gallery-swatch').click();
  expect(store.getPage(page.id).cover).toEqual({ type: 'preset', value: 'peach' });
  expect(container.querySelector('.ed-cover')).not.toBeNull();
});

test('the cover Link tab sets a link cover via Submit', () => {
  const page = openTitled('Getting Started');
  [...container.querySelectorAll('.ed-ghost-btn')]
    .find((b) => b.textContent.trim() === 'Add cover')
    .click();
  const pop = document.querySelector('.pop-root.ed-cover-pop');
  [...pop.querySelectorAll('.ed-pick-tab')].find((t) => t.textContent === 'Link').click();
  const input = pop.querySelector('.ed-custom-input');
  expect(input.getAttribute('placeholder')).toBe('Paste an image link…');
  input.value = 'https://example.com/cover.png';
  pop.querySelector('.ed-custom-submit').click();
  expect(store.getPage(page.id).cover).toEqual({ type: 'link', value: 'https://example.com/cover.png' });
});

// ---------- locked pages ----------

test('a locked page is not editable and shows the lock chip', () => {
  const page = store.createPage({ title: 'Sealed', blocks: '<p>frozen</p>', locked: true });
  editor.open(page.id);
  expect(container.querySelector('.ed-lock').textContent).toBe('🔒 Locked');
  expect(container.querySelector('.ed-title').getAttribute('contenteditable')).toBe('false');
  expect(container.querySelector('.ed-body').getAttribute('contenteditable')).toBe('false');
});

// ---------- layout prefs ----------

test('font, smallText and fullWidth map to doc modifier classes', () => {
  const page = store.createPage({
    title: 'Styled',
    blocks: '<p>x</p>',
    font: 'serif',
    smallText: true,
    fullWidth: true,
  });
  editor.open(page.id);
  const doc = container.querySelector('.ed-doc');
  expect(doc.classList.contains('ed-serif')).toBe(true);
  expect(doc.classList.contains('ed-small')).toBe(true);
  expect(doc.classList.contains('ed-full')).toBe(true);
});
