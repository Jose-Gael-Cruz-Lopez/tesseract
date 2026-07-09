// The page top bar (Task 11): breadcrumb on the left, page controls on the
// right, and the ••• page menu popover. Transparent, 45px tall, sits over the
// content. No top-level DOM access — every DOM touch is inside mountTopbar so
// the module import-smokes cleanly.
//
// Cross-surface actions (share, comments, trash, import, routing) go through
// the `ctx` callbacks; page mutations go straight to the store. This module
// never imports another surface module.

import { ICONS } from './icons.js';
import { el, openPopover } from './popover.js';
import * as store from '../data/store.js';

// "just now" / "Nm ago" / "Nh ago" / "Nd ago" — the relative-time helper the
// brief specifies for the "Edited <rel>" stamp.
function relativeTime(ts) {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A page's title → URL slug for the public link.
function slug(title) {
  const s = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

function publicUrl(page) {
  return `https://mnemosphere.site/${slug(page.title)}-${String(page.id).slice(0, 8)}`;
}

// Icon markup for a page's icon record (emoji glyph, line icon, or image).
function iconHtml(icon) {
  if (!icon) return '';
  if (icon.type === 'emoji') return `<span class="tb-emoji">${icon.value}</span>`;
  if (icon.type === 'icon') return ICONS[icon.value] || '';
  if (icon.type === 'image') return `<img class="tb-img" src="${icon.value}" alt="">`;
  return '';
}

function copyText(text, ctx) {
  try {
    globalThis.navigator?.clipboard?.writeText?.(text);
  } catch {
    /* clipboard denied / unavailable — the toast still confirms intent */
  }
  ctx.toast('Copied');
}

// Download the page as Markdown: strip the doc HTML to plain text, wrap under a
// title heading, and trigger a Blob download of "<title>.md".
function exportMarkdown(page) {
  const title = page.title || 'Untitled';
  let body = '';
  if (typeof page.blocks === 'string') {
    body = page.blocks
      .replace(/<\/(p|h1|h2|h3|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const md = `# ${title}\n\n${body}`.trim() + '\n';
  try {
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = `${title}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    /* Blob/URL unavailable (non-browser) — export is best-effort */
  }
}

export function mountTopbar(container, ctx) {
  let currentPage = null;

  function render() {
    container.innerHTML = '';
    container.classList.add('tb-bar');
    if (currentPage) renderPage(currentPage);
    else renderHome();
  }

  function renderHome() {
    const left = el('div', 'tb-left');
    const name = store.getWorkspace()?.name || 'Mnemosphere';
    const btn = el('button', 'tb-crumb tb-workspace');
    btn.textContent = name;
    btn.addEventListener('click', () => ctx.goHome());
    left.appendChild(btn);
    container.appendChild(left);
  }

  function renderPage(page) {
    const left = el('div', 'tb-left');

    // Workspace crumb doubles as "back to the globe" (the Home view).
    const home = el('button', 'tb-crumb tb-workspace');
    home.textContent = store.getWorkspace()?.name || 'Mnemosphere';
    home.title = 'Back to the globe';
    home.addEventListener('click', () => ctx.goHome());
    left.appendChild(home);
    left.appendChild(el('span', 'tb-sep', '/'));

    const parent = page.parentId ? store.getPage(page.parentId) : null;
    if (parent) {
      const pb = el('button', 'tb-crumb tb-parent');
      pb.textContent = parent.title || 'Untitled';
      pb.addEventListener('click', () => ctx.openPage(parent.id));
      left.appendChild(pb);
      left.appendChild(el('span', 'tb-sep', '/'));
    }

    const crumb = el('button', 'tb-crumb tb-page');
    const iconMk = iconHtml(page.icon);
    if (iconMk) crumb.appendChild(el('span', 'tb-page-icon', iconMk));
    crumb.appendChild(el('span', 'tb-page-title', escapeText(page.title || 'Untitled')));
    left.appendChild(crumb);
    container.appendChild(left);

    const right = el('div', 'tb-right');

    const edited = el('span', 'tb-edited');
    edited.textContent = `Edited ${relativeTime(page.edited)}`;
    right.appendChild(edited);

    const share = el('button', 'tb-share', 'Share');
    share.addEventListener('click', () => ctx.openShare(share, page.id));
    right.appendChild(share);

    right.appendChild(iconButton('tb-comment', ICONS.comment, 'Comments', () => ctx.toggleComments(page.id)));
    right.appendChild(iconButton('tb-clock', ICONS.clock, 'Updates & analytics', () => ctx.toast('Coming soon')));

    const fav = iconButton(
      'tb-fav' + (page.favorite ? ' is-on' : ''),
      page.favorite ? ICONS.starFilled : ICONS.star,
      page.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      () => {
        store.toggleFavorite(page.id);
        render();
      },
    );
    right.appendChild(fav);

    const more = iconButton('tb-more', ICONS.more, 'Style, export, and more', () => openMenu(more, page));
    right.appendChild(more);

    container.appendChild(right);
  }

  function iconButton(className, svg, title, onClick) {
    const b = el('button', `tb-icon ${className}`, svg);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- the ••• page menu ----

  function openMenu(anchor, page) {
    openPopover(anchor, {
      className: 'tb-menu',
      placement: 'bottom-end',
      build: (root, close) => buildMenu(root, close, anchor, page),
    });
  }

  function buildMenu(root, close, anchor, page) {
    root.appendChild(el('div', 'tb-mlabel', 'Style'));
    root.appendChild(fontCards(page));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(switchRow('Small text', ICONS.page, page.smallText, (on) =>
      store.updatePage(page.id, { smallText: on })));
    root.appendChild(switchRow('Full width', ICONS.expand, page.fullWidth, (on) =>
      store.updatePage(page.id, { fullWidth: on })));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(actionRow(ICONS.moveTo, 'Move to', '⌘⇧P', close, () => ctx.toast('Coming soon')));
    root.appendChild(actionRow(ICONS.image, 'Customize page', null, close, () => ctx.toast('Coming soon')));
    root.appendChild(switchRow('Lock page', ICONS.lock, page.locked, (on) =>
      store.updatePage(page.id, { locked: on })));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(actionRow(
      page.favorite ? ICONS.starFilled : ICONS.star,
      page.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      null, close,
      () => { store.toggleFavorite(page.id); render(); },
    ));
    root.appendChild(actionRow(ICONS.link, 'Copy link', '⌘⌥L', close, () => copyText(publicUrl(page), ctx)));
    root.appendChild(actionRow(ICONS.duplicate, 'Duplicate', '⌘D', close, () => {
      const copy = store.duplicatePage(page.id);
      if (copy) ctx.openPage(copy.id);
    }));
    root.appendChild(actionRow(ICONS.expand, 'Open in Mac app', null, close, () => ctx.toast('Coming soon')));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(actionRow(ICONS.undo, 'Undo', '⌘Z', close, () => {
      try { document.execCommand?.('undo'); } catch { /* not supported here */ }
    }));
    root.appendChild(actionRow(ICONS.history, 'Page history', null, close, () => ctx.toast('Coming soon')));
    root.appendChild(actionRow(ICONS.analytics, 'Page analytics', null, close, () => ctx.toast('Coming soon')));
    root.appendChild(actionRow(ICONS.trash, 'Show deleted pages', null, close, () => ctx.openTrash(anchor)));
    root.appendChild(actionRow(ICONS.trash, 'Delete', null, close, () => {
      store.deletePage(page.id);
      ctx.goHome();
    }));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(actionRow(ICONS.import, 'Import', null, close, () => ctx.openImport()));
    root.appendChild(exportRow(close, page));
    root.appendChild(el('div', 'tb-mdiv'));

    root.appendChild(el('div', 'tb-mlabel', 'Connections'));
    root.appendChild(actionRow(ICONS.connect, 'Add connections', null, close, () => ctx.toast('Coming soon')));
  }

  function fontCards(page) {
    const wrap = el('div', 'tb-fonts');
    const cards = [
      { font: 'default', name: 'Default', family: 'var(--font-ui)' },
      { font: 'serif', name: 'Serif', family: 'var(--font-serif)' },
      { font: 'mono', name: 'Mono', family: 'var(--font-mono)' },
    ];
    for (const c of cards) {
      const card = el('button', 'tb-font' + (page.font === c.font ? ' is-active' : ''));
      card.dataset.font = c.font;
      const ag = el('span', 'tb-ag', 'Ag');
      ag.style.fontFamily = c.family;
      card.appendChild(ag);
      card.appendChild(el('span', 'tb-fontname', c.name));
      card.addEventListener('click', () => {
        store.updatePage(page.id, { font: c.font });
        page.font = c.font;
        for (const other of wrap.querySelectorAll('.tb-font')) other.classList.remove('is-active');
        card.classList.add('is-active');
      });
      wrap.appendChild(card);
    }
    return wrap;
  }

  // A menu row carrying a pill switch; toggling persists but keeps the menu open.
  function switchRow(label, icon, initialOn, onToggle) {
    let on = !!initialOn;
    const row = el('button', 'tb-mrow tb-mrow-switch');
    row.appendChild(el('span', 'tb-mrow-icon', icon));
    row.appendChild(el('span', 'tb-mrow-label', label));
    const sw = el('span', 'tb-switch' + (on ? ' is-on' : ''));
    row.appendChild(sw);
    row.addEventListener('click', () => {
      on = !on;
      sw.classList.toggle('is-on', on);
      onToggle(on);
    });
    return row;
  }

  // A menu row that runs an action after closing the menu.
  function actionRow(icon, label, hint, close, onClick) {
    const row = el('button', 'tb-mrow');
    row.appendChild(el('span', 'tb-mrow-icon', icon));
    row.appendChild(el('span', 'tb-mrow-label', label));
    if (hint) row.appendChild(el('span', 'tb-mrow-hint', hint));
    row.addEventListener('click', () => {
      close();
      onClick();
    });
    return row;
  }

  function exportRow(close, page) {
    const row = el('button', 'tb-mrow tb-mrow-stack');
    row.appendChild(el('span', 'tb-mrow-icon', ICONS.export));
    const stack = el('span', 'tb-mrow-col');
    stack.appendChild(el('span', 'tb-mrow-label', 'Export'));
    stack.appendChild(el('span', 'tb-mrow-sub', 'PDF, HTML, Markdown'));
    row.appendChild(stack);
    row.addEventListener('click', () => {
      close();
      exportMarkdown(page);
    });
    return row;
  }

  render();

  return {
    setPage(page) {
      currentPage = page || null;
      render();
    },
  };
}

// Minimal text escape for values interpolated into innerHTML title spans.
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
