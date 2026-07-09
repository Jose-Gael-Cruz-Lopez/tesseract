// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openUpdates } from '../src/ui/updates.js';

function makeAnchor() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({
    left: 20, right: 240, top: 40, bottom: 60, width: 220, height: 20, x: 20, y: 40, toJSON() {},
  });
  return anchor;
}

function makeCtx() {
  return {
    openSettings: vi.fn(),
    toast: vi.fn(),
  };
}

test('imports', async () => {
  await import('../src/ui/updates.js');
});

describe('openUpdates', () => {
  let anchor;
  let ctx;

  beforeEach(() => {
    document.body.innerHTML = '';
    anchor = makeAnchor();
    ctx = makeCtx();
  });

  test('renders a popover anchored to the given element', () => {
    openUpdates(anchor, ctx);
    expect(document.querySelector('.pop-root.upd-pop')).not.toBeNull();
  });

  test('renders the three tabs with exact copy, Inbox active by default', () => {
    openUpdates(anchor, ctx);
    const tabs = [...document.querySelectorAll('.upd-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Inbox', 'Archived', 'All']);
    expect(tabs[0].classList.contains('upd-tab-active')).toBe(true);
    expect(tabs[1].classList.contains('upd-tab-active')).toBe(false);
    expect(tabs[2].classList.contains('upd-tab-active')).toBe(false);
  });

  test('renders the empty state with exact copy strings', () => {
    openUpdates(anchor, ctx);
    const title = document.querySelector('.upd-empty-title');
    const desc = document.querySelector('.upd-empty-desc');
    expect(title.textContent).toBe("You're all caught up");
    expect(desc.textContent).toBe(
      "When someone @mentions you, replies to your comments, or invites you to a page, you'll be notified here"
    );
  });

  test('renders the inboxEmpty illustration in the body', () => {
    openUpdates(anchor, ctx);
    const art = document.querySelector('.upd-empty-art svg');
    expect(art).not.toBeNull();
  });

  test('clicking a tab makes it active and deactivates the others', () => {
    openUpdates(anchor, ctx);
    const tabs = [...document.querySelectorAll('.upd-tab')];
    tabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(tabs[0].classList.contains('upd-tab-active')).toBe(false);
    expect(tabs[1].classList.contains('upd-tab-active')).toBe(true);
    expect(tabs[2].classList.contains('upd-tab-active')).toBe(false);
  });

  test('switching tabs keeps the same empty-state copy (all tabs empty for now)', () => {
    openUpdates(anchor, ctx);
    const tabs = [...document.querySelectorAll('.upd-tab')];
    tabs[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.upd-empty-title').textContent).toBe("You're all caught up");
  });

  test('clicking the gear icon calls ctx.openSettings with "notifications"', () => {
    openUpdates(anchor, ctx);
    document.querySelector('.upd-gear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.openSettings).toHaveBeenCalledWith('notifications');
  });

  test('clicking the info icon (no behavior yet) toasts "Coming soon"', () => {
    openUpdates(anchor, ctx);
    document.querySelector('.upd-info').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.toast).toHaveBeenCalledWith('Coming soon');
  });

  test('returns a close() that removes the popover', () => {
    const close = openUpdates(anchor, ctx);
    expect(document.querySelector('.upd-pop')).not.toBeNull();
    close();
    expect(document.querySelector('.upd-pop')).toBeNull();
  });
});
