// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { openPopover, openModal, toast, el } from '../src/ui/popover.js';

function makeAnchor(rect) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON() {},
  });
  return anchor;
}

test('imports', async () => {
  await import('../src/ui/popover.js');
});

describe('openPopover', () => {
  let anchor;

  beforeEach(() => {
    document.body.innerHTML = '';
    anchor = makeAnchor({ left: 100, right: 150, top: 200, bottom: 220 });
  });

  test('appends a .pop-root containing the content build() renders', () => {
    openPopover(anchor, {
      build: (root) => {
        root.appendChild(el('span', 'marker', 'hi there'));
      },
    });
    const pop = document.querySelector('.pop-root');
    expect(pop).not.toBeNull();
    expect(pop.querySelector('.marker').textContent).toBe('hi there');
  });

  test('applies an extra className alongside pop-root', () => {
    openPopover(anchor, { className: 'my-menu', build: () => {} });
    expect(document.querySelector('.pop-root.my-menu')).not.toBeNull();
  });

  test('positions itself from the anchor rect, offset below by default', () => {
    openPopover(anchor, { build: () => {} });
    const pop = document.querySelector('.pop-root');
    expect(pop.style.position).toBe('absolute');
    expect(parseFloat(pop.style.left)).toBe(100); // anchor.left
    expect(parseFloat(pop.style.top)).toBe(226); // anchor.bottom (220) + default offset (6)
  });

  test('clamps horizontally so it never overflows the right edge of the viewport', () => {
    const rightAnchor = makeAnchor({ left: window.innerWidth - 5, right: window.innerWidth, top: 200, bottom: 220 });
    openPopover(rightAnchor, { build: () => {} });
    const pop = document.querySelector('.pop-root');
    expect(parseFloat(pop.style.left)).toBeLessThanOrEqual(window.innerWidth - 8);
  });

  test('flips above the anchor when it would overflow the bottom edge', () => {
    const bottomAnchor = makeAnchor({ left: 10, right: 60, top: window.innerHeight - 10, bottom: window.innerHeight - 4 });
    openPopover(bottomAnchor, { build: () => {} });
    const pop = document.querySelector('.pop-root');
    expect(parseFloat(pop.style.top)).toBeLessThan(window.innerHeight - 10);
  });

  test('close() removes the popover from the DOM', () => {
    const close = openPopover(anchor, { build: () => {} });
    expect(document.querySelector('.pop-root')).not.toBeNull();
    close();
    expect(document.querySelector('.pop-root')).toBeNull();
  });

  test('an outside mousedown closes the popover', async () => {
    openPopover(anchor, { build: () => {} });
    expect(document.querySelector('.pop-root')).not.toBeNull();
    // The outside-close listener attaches a tick after opening (deferred, so
    // the gesture that opened the popover can't immediately close it too).
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.pop-root')).toBeNull();
  });

  test('a mousedown inside the popover does not close it', async () => {
    openPopover(anchor, {
      build: (root) => root.appendChild(el('button', 'inner', 'click')),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('.inner').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.pop-root')).not.toBeNull();
  });

  test('Escape closes the popover', async () => {
    openPopover(anchor, { build: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.pop-root')).toBeNull();
  });
});

describe('openModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('renders a .mod-scrim containing a .mod-box with the built content', () => {
    openModal({ build: (box) => box.appendChild(el('h2', null, 'Title')) });
    const scrim = document.querySelector('.mod-scrim');
    const box = document.querySelector('.mod-box');
    expect(scrim).not.toBeNull();
    expect(box).not.toBeNull();
    expect(scrim.contains(box)).toBe(true);
    expect(box.querySelector('h2').textContent).toBe('Title');
  });

  test('Escape closes the modal', () => {
    openModal({ build: () => {} });
    expect(document.querySelector('.mod-scrim')).not.toBeNull();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });

  test('clicking the scrim (outside the box) closes the modal', () => {
    openModal({ build: () => {} });
    document.querySelector('.mod-scrim').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });

  test('clicking inside the box does not close the modal', () => {
    openModal({ build: (box) => box.appendChild(el('button', 'inner', 'click')) });
    document.querySelector('.inner').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.mod-scrim')).not.toBeNull();
  });

  test('close() removes the modal from the DOM', () => {
    const close = openModal({ build: () => {} });
    close();
    expect(document.querySelector('.mod-scrim')).toBeNull();
  });
});

describe('toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('appends a .toast-chip with the message text', () => {
    toast('hi');
    const chip = document.querySelector('.toast-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('hi');
  });

  test('auto-removes after 2.4s', () => {
    toast('hi');
    expect(document.querySelector('.toast-chip')).not.toBeNull();
    vi.advanceTimersByTime(2400);
    expect(document.querySelector('.toast-chip')).toBeNull();
  });

  test('does not remove before 2.4s has elapsed', () => {
    toast('hi');
    vi.advanceTimersByTime(2000);
    expect(document.querySelector('.toast-chip')).not.toBeNull();
  });
});
