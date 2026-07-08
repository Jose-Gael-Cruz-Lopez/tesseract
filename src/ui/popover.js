// Shared anchored popover, centered modal, and toast primitives.
// No top-level DOM access — every DOM touch happens inside an exported
// function call so this module can be import-smoke-tested safely.

const VIEWPORT_MARGIN = 8;
const TOAST_DURATION = 2400;

/** Element helper (the old `elh`). */
export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

// Clamped anchor-relative position, ported from the pg-pop logic in
// src/main.js (openPgPop, ~lines 665-678 of the pre-refactor checkout):
// clamp horizontally within the viewport, flip vertically if the popover
// would run past the bottom (or top) edge.
function positionFromAnchor(rect, width, height, placement, offset) {
  const [vSide, hSide] = placement.split('-');
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = hSide === 'end' ? rect.right - width : rect.left;
  let top = vSide === 'top' ? rect.top - height - offset : rect.bottom + offset;

  if (vSide === 'bottom' && top + height > vh - VIEWPORT_MARGIN) {
    top = rect.top - height - offset;
  } else if (vSide === 'top' && top < VIEWPORT_MARGIN) {
    top = rect.bottom + offset;
  }

  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, top);

  return { left, top };
}

/**
 * Open an anchored popover. `build(root, close)` fills `root` (a `.pop-root`
 * element already appended to the page) with content. Absolutely positioned
 * against `anchor`'s rect, clamped to the viewport. Closes on outside
 * mousedown or Escape. Returns `close()`.
 */
export function openPopover(anchor, { className, build, placement = 'bottom-start', offset = 6 } = {}) {
  const root = el('div', className ? `pop-root ${className}` : 'pop-root');
  document.body.appendChild(root);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    root.remove();
  }
  function onMouseDown(e) {
    if (!root.contains(e.target)) close();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }

  if (typeof build === 'function') build(root, close);

  const rect = anchor.getBoundingClientRect();
  const { left, top } = positionFromAnchor(rect, root.offsetWidth, root.offsetHeight, placement, offset);
  root.style.position = 'absolute';
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;

  // Deferred so the mousedown that opened this popover doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }, 0);

  return close;
}

/**
 * Open a centered modal: a `.mod-scrim` containing a `.mod-box`.
 * `build(box, close)` fills the box. Escape or a scrim click closes it.
 * Returns `close()`.
 */
export function openModal({ className, build, dim = true } = {}) {
  const scrim = el('div', dim === false ? 'mod-scrim mod-scrim-clear' : 'mod-scrim');
  const box = el('div', className ? `mod-box ${className}` : 'mod-box');
  scrim.appendChild(box);
  document.body.appendChild(scrim);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    scrim.remove();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });

  if (typeof build === 'function') build(box, close);

  document.addEventListener('keydown', onKeyDown, true);

  return close;
}

/** Bottom-center toast chip; auto-dismisses after 2.4s. */
export function toast(message) {
  const chip = el('div', 'toast-chip');
  chip.textContent = message;
  document.body.appendChild(chip);
  setTimeout(() => chip.remove(), TOAST_DURATION);
}
