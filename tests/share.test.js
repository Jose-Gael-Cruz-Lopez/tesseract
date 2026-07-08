// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import * as store from '../src/data/store.js';
import { openShare, mountComments } from '../src/ui/share.js';

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

function makeAnchor() {
  const a = document.createElement('button');
  document.body.appendChild(a);
  a.getBoundingClientRect = () => ({ left: 100, right: 150, top: 40, bottom: 60, width: 50, height: 20, x: 100, y: 40, toJSON() {} });
  return a;
}

function makeCtx(overrides = {}) {
  return {
    store,
    auth: { getSession: () => ({ name: 'Ada Lovelace', email: 'ada@x.io' }) },
    toast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
  document.body.innerHTML = '';
});
afterEach(() => vi.useRealTimers());

test('imports', async () => {
  await import('../src/ui/share.js');
});

describe('openShare — collapsed state', () => {
  test('renders the page chip, invite row, and web toggle', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());

    const pop = document.querySelector('.shr-pop');
    expect(pop).not.toBeNull();
    expect(pop.textContent).toContain('Share');
    expect(pop.textContent).toContain('Design Thinking');
    expect(pop.querySelector('.shr-input').placeholder).toBe('Add people, groups, or emails...');
    expect(pop.querySelector('.shr-invite-btn').textContent).toBe('Invite');
    expect(pop.textContent).toContain('Share to web');
    expect(pop.textContent).toContain('Publish and share link with anyone');
    expect(pop.textContent).toContain('Learn about sharing');
    expect(pop.textContent).toContain('Copy link');
  });

  test('the web switch is off and the expanded section is hidden by default', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());

    const sw = document.querySelector('.shr-web-toggle .shr-switch');
    expect(sw.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.shr-web-expanded')).toBeNull();
  });

  test('Invite adds a chip and persists to prefs invites:<pageId>', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());

    const input = document.querySelector('.shr-input');
    input.value = 'sam@team.io';
    document.querySelector('.shr-invite-btn').click();

    const chips = document.querySelectorAll('.shr-invite-chip');
    expect([...chips].some((c) => c.textContent.includes('sam@team.io'))).toBe(true);
    expect(store.getPrefs()['invites:' + page.id]).toContain('sam@team.io');
  });
});

describe('openShare — expanded state', () => {
  test('turning Share to web on reveals the link + option switches and persists shareWeb:<pageId>', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());

    document.querySelector('.shr-web-toggle').click();

    const exp = document.querySelector('.shr-web-expanded');
    expect(exp).not.toBeNull();
    expect(document.querySelector('.shr-url').value).toContain('mnemosphere.site');
    expect(exp.textContent).toContain('Copy web link');
    expect(exp.textContent).toContain('Link expires');
    expect(exp.textContent).toContain('Never');
    expect(exp.textContent).toContain('PLUS');
    expect(exp.textContent).toContain('Allow editing');
    expect(exp.textContent).toContain('Allow comments');
    expect(exp.textContent).toContain('Allow duplicate as template');
    expect(exp.textContent).toContain('Search engine indexing');
    expect(exp.textContent).toContain('Set a domain for your public links in Settings');

    expect(store.getPrefs()['shareWeb:' + page.id].on).toBe(true);
  });

  test('a saved shareWeb pref opens the popover already expanded', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    store.setPref('shareWeb:' + page.id, { on: true, editing: true, comments: true, duplicate: true, indexing: false });

    openShare(makeAnchor(), page.id, makeCtx());
    expect(document.querySelector('.shr-web-expanded')).not.toBeNull();
    expect(document.querySelector('.shr-web-toggle .shr-switch').classList.contains('is-on')).toBe(true);
  });

  test('default option switches match the reference (editing/comments/duplicate on, indexing off)', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());
    document.querySelector('.shr-web-toggle').click();

    const byLabel = (label) =>
      [...document.querySelectorAll('.shr-opt')].find((r) => r.textContent.includes(label));
    expect(byLabel('Allow editing').querySelector('.shr-switch').classList.contains('is-on')).toBe(true);
    expect(byLabel('Allow comments').querySelector('.shr-switch').classList.contains('is-on')).toBe(true);
    expect(byLabel('Allow duplicate as template').querySelector('.shr-switch').classList.contains('is-on')).toBe(true);
    expect(byLabel('Search engine indexing').querySelector('.shr-switch').classList.contains('is-on')).toBe(false);
  });

  test('toggling an option switch persists to prefs', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'Design Thinking' });
    openShare(makeAnchor(), page.id, makeCtx());
    document.querySelector('.shr-web-toggle').click();

    const editingRow = [...document.querySelectorAll('.shr-opt')].find((r) => r.textContent.includes('Allow editing'));
    editingRow.click();
    expect(store.getPrefs()['shareWeb:' + page.id].editing).toBe(false);
  });
});

describe('mountComments', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  test('toggle(pageId) opens the panel with the empty state', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const panel = mountComments(container, makeCtx());
    panel.toggle(page.id);

    expect(container.textContent).toContain('No open comments yet');
    expect(container.textContent).toContain('Open comments on this page will appear here');
    expect(container.querySelector('.shr-c-input').placeholder).toBe('Add a comment...');
  });

  test('submitting a comment renders a row and persists to comments:<pageId>', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const panel = mountComments(container, makeCtx());
    panel.toggle(page.id);

    const input = container.querySelector('.shr-c-input');
    input.value = 'First!';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const rows = container.querySelectorAll('.shr-comment');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('First!');
    expect(rows[0].textContent).toContain('Ada Lovelace');
    expect(container.textContent).not.toContain('No open comments yet');

    const saved = store.getPrefs()['comments:' + page.id];
    expect(saved.length).toBe(1);
    expect(saved[0].text).toBe('First!');
  });

  test('toggling the same page again closes the panel', () => {
    store.seedWorkspace({ name: 'Ada' });
    const page = store.createPage({ title: 'P' });
    const panel = mountComments(container, makeCtx());
    panel.toggle(page.id);
    expect(container.style.display).not.toBe('none');
    panel.toggle(page.id);
    expect(container.style.display).toBe('none');
  });
});
