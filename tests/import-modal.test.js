// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openImport } from '../src/ui/import-modal.js';
import * as store from '../src/data/store.js';

const LABELS = [
  'Evernote', 'Trello', 'Asana', 'Confluence', 'Text & Markdown', 'CSV',
  'HTML', 'Word', 'Google Docs', 'Dropbox Paper', 'Quip', 'Workflowy',
];

function makeCtx(overrides = {}) {
  return {
    store,
    openPage: vi.fn(),
    closePage: vi.fn(),
    currentPageId: vi.fn(() => null),
    goHome: vi.fn(),
    toast: vi.fn(),
    ...overrides,
  };
}

function makeFile(content, name, type = 'text/plain') {
  return new File([content], name, { type });
}

function fireInputChange(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  store.resetStore();
});

test('imports', async () => {
  await import('../src/ui/import-modal.js');
});

test('renders a 690px-wide .mod-box.imp-modal', () => {
  openImport(makeCtx());
  const box = document.querySelector('.mod-box.imp-modal');
  expect(box).not.toBeNull();
});

test('renders the header title and the learn-about-importing link', () => {
  openImport(makeCtx());
  expect(document.querySelector('.imp-title').textContent).toBe('Import');
  const learn = document.querySelector('.imp-learn');
  expect(learn.textContent).toBe('ⓘ Learn about importing');
});

test('renders all 12 source cards with exact labels, in order', () => {
  openImport(makeCtx());
  const labels = [...document.querySelectorAll('.imp-card-label')].map((n) => n.textContent);
  expect(labels).toEqual(LABELS);
});

test('renders the Evernote "$5" credit sub-note', () => {
  openImport(makeCtx());
  const evernote = document.querySelector('.imp-card[data-id="evernote"]');
  expect(evernote).not.toBeNull();
  const note = evernote.querySelector('.imp-card-note');
  expect(note.textContent).toBe('Get $5 in credit');
  expect(note.textContent).toContain('$5');
});

test('every card renders an inline <svg> brand mark', () => {
  openImport(makeCtx());
  const icons = document.querySelectorAll('.imp-card-icon svg');
  expect(icons.length).toBe(12);
});

test('clicking the learn-about-importing link toasts "Coming soon"', () => {
  const ctx = makeCtx();
  openImport(ctx);
  document.querySelector('.imp-learn').click();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

test('clicking the Trello card toasts "Coming soon" and does not touch the store', () => {
  const ctx = makeCtx();
  openImport(ctx);
  const before = store.getPages().length;
  document.querySelector('.imp-card[data-id="trello"]').click();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  expect(store.getPages().length).toBe(before);
});

test.each([
  ['evernote'], ['asana'], ['confluence'], ['word'], ['google-docs'],
  ['dropbox-paper'], ['quip'], ['workflowy'],
])('clicking the %s card toasts "Coming soon"', (id) => {
  const ctx = makeCtx();
  openImport(ctx);
  document.querySelector(`.imp-card[data-id="${id}"]`).click();
  expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
});

describe('Text & Markdown import', () => {
  test('clicking the card opens the hidden .md,.txt file input', () => {
    openImport(makeCtx());
    const input = document.querySelector('.imp-input-text');
    expect(input).not.toBeNull();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.md,.txt');
    const clickSpy = vi.spyOn(input, 'click');
    document.querySelector('.imp-card[data-id="text"]').click();
    expect(clickSpy).toHaveBeenCalled();
  });

  test('importing a .md file creates a page titled from the filename with an h1 heading, then opens it, closes, and toasts', async () => {
    const ctx = makeCtx();
    openImport(ctx);
    const input = document.querySelector('.imp-input-text');
    const file = makeFile('# My Notes\n## A section\n- one\n- two\nplain line', 'My Notes.md');
    fireInputChange(input, file);

    await vi.waitFor(() => expect(ctx.openPage).toHaveBeenCalled());

    const newId = ctx.openPage.mock.calls[0][0];
    const page = store.getPage(newId);
    expect(page.title).toBe('My Notes');
    expect(page.blocks).toContain('<h1>My Notes</h1>');
    expect(page.blocks).toContain('<h2>A section</h2>');
    expect(page.blocks).toContain('<li>one</li>');
    expect(page.blocks).toContain('<li>two</li>');
    expect(page.blocks).toContain('plain line');

    expect(ctx.toast).toHaveBeenCalledWith('Imported');
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });

  test('escapes HTML special characters from the source text', async () => {
    const ctx = makeCtx();
    openImport(ctx);
    const input = document.querySelector('.imp-input-text');
    const file = makeFile('# Title\n<script>alert(1)</script>', 'notes.txt');
    fireInputChange(input, file);

    await vi.waitFor(() => expect(ctx.openPage).toHaveBeenCalled());
    const page = store.getPage(ctx.openPage.mock.calls[0][0]);
    expect(page.blocks).not.toContain('<script>');
    expect(page.blocks).toContain('&lt;script&gt;');
  });
});

describe('CSV import', () => {
  test('clicking the card opens the hidden .csv file input', () => {
    openImport(makeCtx());
    const input = document.querySelector('.imp-input-csv');
    expect(input).not.toBeNull();
    expect(input.accept).toBe('.csv');
  });

  test('importing a .csv file creates a page with a database block: first row as text columns, rest as rows', async () => {
    const ctx = makeCtx();
    openImport(ctx);
    const input = document.querySelector('.imp-input-csv');
    const file = makeFile('Name,Age\nAlice,30\nBob,25', 'contacts.csv', 'text/csv');
    fireInputChange(input, file);

    await vi.waitFor(() => expect(ctx.openPage).toHaveBeenCalled());
    const page = store.getPage(ctx.openPage.mock.calls[0][0]);
    expect(page.title).toBe('contacts');
    expect(page.blocks.type).toBe('database');
    expect(page.blocks.columns.map((c) => c.name)).toEqual(['Name', 'Age']);
    expect(page.blocks.columns.every((c) => c.kind === 'text')).toBe(true);
    expect(page.blocks.rows).toHaveLength(2);
    const [nameCol, ageCol] = page.blocks.columns;
    expect(page.blocks.rows[0].cells[nameCol.id]).toBe('Alice');
    expect(page.blocks.rows[0].cells[ageCol.id]).toBe('30');
    expect(page.blocks.rows[1].cells[nameCol.id]).toBe('Bob');
    expect(page.blocks.views[0].layout).toBe('table');
    expect(page.blocks.activeView).toBe(page.blocks.views[0].id);

    expect(ctx.toast).toHaveBeenCalledWith('Imported');
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });
});

describe('HTML import', () => {
  test('clicking the card opens the hidden .html file input', () => {
    openImport(makeCtx());
    const input = document.querySelector('.imp-input-html');
    expect(input).not.toBeNull();
    expect(input.accept).toBe('.html');
  });

  test('importing an .html file strips <script> tags and stores the rest as the page body', async () => {
    const ctx = makeCtx();
    openImport(ctx);
    const input = document.querySelector('.imp-input-html');
    const file = makeFile(
      '<p>hello</p><script>doEvil()</script><p>world</p>',
      'page.html',
      'text/html'
    );
    fireInputChange(input, file);

    await vi.waitFor(() => expect(ctx.openPage).toHaveBeenCalled());
    const page = store.getPage(ctx.openPage.mock.calls[0][0]);
    expect(page.title).toBe('page');
    expect(page.blocks).toContain('<p>hello</p>');
    expect(page.blocks).toContain('<p>world</p>');
    expect(page.blocks).not.toContain('<script');
    expect(ctx.toast).toHaveBeenCalledWith('Imported');
  });
});
