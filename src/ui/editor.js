// Page editor surface (7.png doc / 8.png new-page state / 13.png pickers).
// Renders one page at a time into the shell's page panel: optional cover,
// 78px icon, hover ghost row, contenteditable title + body (markdown-ish
// input rules), the new-page action menu, and the icon/cover picker popovers.
//
// No top-level DOM access — everything happens inside mountEditor. Database
// and AI surfaces are *dynamically* imported at render time inside try/catch
// (the one sanctioned cross-surface import), with placeholder fallbacks so
// the editor works before those modules exist.

import { ICONS } from './icons.js';
import { openPopover, el } from './popover.js';
import { getPage, updatePage, onStore } from '../data/store.js';
import { COVER_PRESETS, ICON_SET, ICON_COLORS, EMOJI } from '../data/decor-data.js';

// Lazy loaders for the surfaces this editor may delegate to. Same pattern as
// main.js's auth-view glob: a literal `import('./database.js')` fails Vite's
// import analysis while the file doesn't exist yet, whereas the glob resolves
// to {} until the module lands (Task 13/14) and then loads it lazily. The
// `loadSurface` throw funnels the not-there-yet case into each call site's
// try/catch placeholder fallback.
const lazySurfaces = import.meta.glob('./{database,ai}.js');

function loadSurface(name) {
  const load = lazySurfaces[`./${name}.js`];
  if (!load) return Promise.reject(new Error(`${name}.js is not available yet`));
  return load();
}

const SAVE_DEBOUNCE = 350;
const MAX_ICON_FILE_BYTES = 5 * 1024 * 1024;
const COVER_FALLBACK_HEIGHT = 280;

function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isDatabase = (blocks) => !!blocks && typeof blocks === 'object' && blocks.type === 'database';

// Fresh database config for the new-page menu's Table/Board/Timeline/Calendar
// rows: two empty rows, Name(title) + Tags(select) columns, one view with the
// chosen layout.
function freshDatabase(layout) {
  const names = { table: 'Table', board: 'Board', timeline: 'Timeline', calendar: 'Calendar' };
  const viewId = uid();
  return {
    type: 'database',
    columns: [
      { id: uid(), name: 'Name', kind: 'title' },
      { id: uid(), name: 'Tags', kind: 'select', options: [] },
    ],
    rows: [
      { id: uid(), cells: {} },
      { id: uid(), cells: {} },
    ],
    views: [{ id: viewId, name: names[layout] || 'Table', layout, filters: [], groupBy: null }],
    activeView: viewId,
  };
}

// Element (not markup) so user-provided image URLs are assigned as a DOM
// property — a pasted link containing `"` can't break out of an attribute.
function iconNode(icon) {
  if (icon.type === 'emoji') {
    const span = el('span', 'ed-icon-emoji');
    span.textContent = icon.value;
    return span;
  }
  if (icon.type === 'icon') {
    const entry = ICON_SET.find((i) => i.id === icon.value);
    return el('span', 'ed-icon-line', entry ? entry.svg : '');
  }
  if (icon.type === 'image') {
    const img = el('img', 'ed-icon-img');
    img.src = icon.value;
    img.alt = '';
    return img;
  }
  return el('span', 'ed-icon-emoji');
}

function applyCoverStyle(coverEl, cover, coverPos) {
  const preset = cover.type === 'preset' ? COVER_PRESETS.find((p) => p.id === cover.value) : null;
  if (preset) {
    coverEl.style.background = preset.css;
  } else if (cover.type === 'link') {
    coverEl.style.backgroundImage = `url("${cover.value}")`;
  }
  // set after the `background` shorthand so it isn't reset by it
  coverEl.style.backgroundSize = 'cover';
  coverEl.style.backgroundRepeat = 'no-repeat';
  coverEl.style.backgroundPositionY = `${coverPos ?? 50}%`;
}

export function mountEditor(container, ctx) {
  let pageId = null;

  // element refs for the currently rendered page
  let scrollEl = null;
  let docEl = null;
  let titleEl = null;
  let bodyEl = null;
  let newMenuEl = null;

  let titleTimer = null;
  let bodyTimer = null;
  let iconColor = ICON_COLORS[0];
  let renderToken = 0; // guards async body renders against stale pages

  // Live title sync: other surfaces (topbar rename, sidebar) update the store;
  // reflect it here unless the user is mid-edit in the title itself.
  onStore('pages', (detail) => {
    if (!detail || detail.type !== 'update' || !pageId) return;
    if (detail.page.id !== pageId || !titleEl) return;
    if (document.activeElement === titleEl) return;
    if (titleEl.textContent !== detail.page.title) titleEl.textContent = detail.page.title;
  });

  // ---------- persistence ----------

  function saveTitleSoon() {
    const id = pageId;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      if (!titleEl || id !== pageId) return;
      updatePage(id, { title: titleEl.textContent.replace(/\n/g, ' ').trim() });
    }, SAVE_DEBOUNCE);
  }

  function saveBodyNow() {
    if (!bodyEl || !pageId) return;
    updatePage(pageId, { blocks: bodyEl.innerHTML });
  }

  function saveBodySoon() {
    const id = pageId;
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(() => {
      if (id === pageId) saveBodyNow();
    }, SAVE_DEBOUNCE);
  }

  // ---------- new-page menu ----------

  function dismissNewMenu() {
    if (newMenuEl) {
      newMenuEl.remove();
      newMenuEl = null;
    }
  }

  async function startWritingWithAI() {
    dismissNewMenu();
    try {
      const mod = await loadSurface('ai');
      mod.mountAIBar(bodyEl, getPage(pageId), ctx);
    } catch {
      ctx.toast('Coming soon');
    }
  }

  function swapToDatabase(layout) {
    updatePage(pageId, { blocks: freshDatabase(layout) });
    render();
  }

  function buildNewMenu() {
    const menu = el('div', 'ed-new');
    const row = (icon, label, run, highlighted) => {
      const btn = el('button', highlighted ? 'ed-new-row ed-new-hl' : 'ed-new-row');
      btn.type = 'button';
      btn.innerHTML = `<span class="ed-new-ic">${icon}</span><span class="ed-new-txt">${label}</span>`;
      btn.addEventListener('click', run);
      return btn;
    };
    menu.appendChild(row(ICONS.page, 'Empty page', () => {
      dismissNewMenu();
      bodyEl?.focus();
    }, true));
    menu.appendChild(row(ICONS.ai, 'Start writing with AI', startWritingWithAI));
    menu.appendChild(el('div', 'ed-new-label', 'Add new'));
    menu.appendChild(row(ICONS.import, 'Import', () => ctx.openImport()));
    menu.appendChild(row(ICONS.templates, 'Templates', () => ctx.openTemplates()));
    menu.appendChild(row(ICONS.table, 'Table', () => swapToDatabase('table')));
    menu.appendChild(row(ICONS.board, 'Board', () => swapToDatabase('board')));
    menu.appendChild(row(ICONS.timeline, 'Timeline', () => swapToDatabase('timeline')));
    menu.appendChild(row(ICONS.calendar, 'Calendar', () => swapToDatabase('calendar')));
    menu.appendChild(row(ICONS.more, 'More', () => ctx.toast('Coming soon')));
    return menu;
  }

  // ---------- markdown-ish input rules ----------

  // Find the top-level line the caret sits in: the element (or text node)
  // whose parent is the body itself.
  function caretLine(node) {
    let line = node;
    while (line && line.parentNode !== bodyEl) line = line.parentNode;
    return line;
  }

  function onBodyKeydown(e) {
    if (e.key !== ' ') return;
    let sel;
    try {
      sel = document.getSelection();
    } catch {
      return;
    }
    if (!sel || !sel.anchorNode || !bodyEl.contains(sel.anchorNode)) return;
    const line = caretLine(sel.anchorNode);
    if (!line) return;
    const text = (line.textContent || '').trim();
    let replacement = null;
    let caretTarget = null;
    if (text === '-') {
      replacement = el('ul', '', '<li></li>');
      caretTarget = replacement.querySelector('li');
    } else if (text === '[]') {
      replacement = el('div', 'ed-todo', '<input type="checkbox">');
      caretTarget = replacement;
    } else if (text === '#') {
      replacement = el('h1');
      caretTarget = replacement;
    } else if (text === '##') {
      replacement = el('h2');
      caretTarget = replacement;
    } else if (text === '>') {
      replacement = el('details', '', '<summary></summary>');
      caretTarget = replacement.querySelector('summary');
    }
    if (!replacement) return;
    e.preventDefault();
    if (line.nodeType === Node.TEXT_NODE) {
      bodyEl.replaceChild(replacement, line);
    } else {
      line.replaceWith(replacement);
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(caretTarget);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* caret placement is best-effort (jsdom/happy-dom) */
    }
    saveBodySoon();
  }

  // Checkbox clicks: managed by hand (attribute + property) so the checked
  // state serializes into the saved HTML deterministically.
  function onBodyClick(e) {
    const target = e.target;
    if (!target || !target.matches || !target.matches('.ed-todo input[type="checkbox"]')) return;
    e.preventDefault();
    const on = !target.hasAttribute('checked');
    if (on) target.setAttribute('checked', '');
    else target.removeAttribute('checked');
    target.checked = on;
    saveBodyNow();
  }

  // ---------- pickers ----------

  function setIcon(icon) {
    updatePage(pageId, { icon });
    render();
  }

  function setCover(cover) {
    updatePage(pageId, { cover });
    render();
  }

  function pickerTabs(root, names, onPick, onRemove) {
    const bar = el('div', 'ed-pick-tabs');
    const buttons = names.map((name, i) => {
      const b = el('button', i === 0 ? 'ed-pick-tab ed-pick-tab-on' : 'ed-pick-tab');
      b.type = 'button';
      b.textContent = name;
      b.addEventListener('click', () => {
        for (const other of buttons) other.classList.toggle('ed-pick-tab-on', other === b);
        onPick(name);
      });
      bar.appendChild(b);
      return b;
    });
    const remove = el('button', 'ed-pick-remove');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', onRemove);
    bar.appendChild(remove);
    root.appendChild(bar);
  }

  function buildEmojiTab(host, close) {
    const search = el('input', 'ed-emoji-search');
    search.setAttribute('placeholder', 'Filter…');
    const grid = el('div', 'ed-emoji-grid');
    const paint = (query) => {
      grid.innerHTML = '';
      const q = query.trim().toLowerCase();
      for (const entry of EMOJI) {
        if (q && !entry.name.includes(q) && !entry.char.includes(q)) continue;
        const cell = el('button', 'ed-emoji-cell');
        cell.type = 'button';
        cell.textContent = entry.char;
        cell.title = entry.name;
        cell.addEventListener('click', () => {
          close();
          setIcon({ type: 'emoji', value: entry.char });
        });
        grid.appendChild(cell);
      }
    };
    search.addEventListener('input', () => paint(search.value));
    paint('');
    host.append(search, grid);
  }

  function buildIconsTab(host, close) {
    const swatches = el('div', 'ed-swatches');
    const grid = el('div', 'ed-icon-grid');
    const paintSwatches = () => {
      swatches.innerHTML = '';
      for (const color of ICON_COLORS) {
        const dot = el('button', color === iconColor ? 'ed-swatch ed-swatch-on' : 'ed-swatch');
        dot.type = 'button';
        dot.style.background = color; // data-driven tint, like cover preset css
        dot.addEventListener('click', () => {
          iconColor = color;
          paintSwatches();
          paintGrid();
        });
        swatches.appendChild(dot);
      }
    };
    const paintGrid = () => {
      grid.innerHTML = '';
      for (const entry of ICON_SET) {
        const cell = el('button', 'ed-icon-cell');
        cell.type = 'button';
        cell.style.color = iconColor;
        cell.innerHTML = entry.svg;
        cell.title = entry.id;
        cell.addEventListener('click', () => {
          close();
          setIcon({ type: 'icon', value: entry.id, color: iconColor });
        });
        grid.appendChild(cell);
      }
    };
    paintSwatches();
    paintGrid();
    host.append(swatches, grid);
  }

  function buildCustomTab(host, close) {
    const row = el('div', 'ed-custom-row');
    const input = el('input', 'ed-custom-input');
    input.setAttribute('placeholder', 'Paste link to an image...');
    const submit = el('button', 'ed-custom-submit');
    submit.type = 'button';
    submit.textContent = 'Submit';
    submit.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      close();
      setIcon({ type: 'image', value });
    });
    row.append(input, submit);

    const file = el('input', 'ed-upload-input');
    file.type = 'file';
    file.setAttribute('accept', 'image/*');
    file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      if (!picked) return;
      if (picked.size > MAX_ICON_FILE_BYTES) {
        ctx.toast('Please pick a file under 5 MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        close();
        setIcon({ type: 'image', value: reader.result });
      };
      reader.readAsDataURL(picked);
    });
    const upload = el('button', 'ed-upload');
    upload.type = 'button';
    upload.textContent = 'Upload file';
    upload.addEventListener('click', () => file.click());

    const note1 = el('div', 'ed-note', 'Recommended size is 280 × 280 pixels');
    const note2 = el('div', 'ed-note');
    note2.append(
      el('span', '', 'The maximum size per file is 5 MB'),
      el('span', 'ed-badge', 'PLUS PLANS'),
    );
    host.append(row, upload, file, note1, note2);
  }

  function openIconPicker(anchor) {
    openPopover(anchor, {
      className: 'ed-icon-pop',
      build(root, close) {
        const body = el('div', 'ed-pick-body');
        const show = (tab) => {
          body.innerHTML = '';
          if (tab === 'Emojis') buildEmojiTab(body, close);
          else if (tab === 'Icons') buildIconsTab(body, close);
          else buildCustomTab(body, close);
        };
        pickerTabs(root, ['Emojis', 'Icons', 'Custom'], show, () => {
          close();
          setIcon(null);
        });
        root.appendChild(body);
        show('Emojis');
      },
    });
  }

  function buildGalleryTab(host, close) {
    const grid = el('div', 'ed-gallery');
    for (const preset of COVER_PRESETS) {
      const item = el('div', 'ed-gallery-item');
      const swatch = el('button', 'ed-gallery-swatch');
      swatch.type = 'button';
      swatch.style.background = preset.css;
      swatch.addEventListener('click', () => {
        close();
        setCover({ type: 'preset', value: preset.id });
      });
      item.append(swatch, el('div', 'ed-gallery-label', preset.label));
      grid.appendChild(item);
    }
    host.appendChild(grid);
  }

  function buildCoverLinkTab(host, close) {
    const row = el('div', 'ed-custom-row');
    const input = el('input', 'ed-custom-input');
    input.setAttribute('placeholder', 'Paste an image link…');
    const submit = el('button', 'ed-custom-submit');
    submit.type = 'button';
    submit.textContent = 'Submit';
    submit.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      close();
      setCover({ type: 'link', value });
    });
    row.append(input, submit);
    host.appendChild(row);
  }

  function openCoverPicker(anchor) {
    openPopover(anchor, {
      className: 'ed-cover-pop',
      build(root, close) {
        const body = el('div', 'ed-pick-body');
        const show = (tab) => {
          body.innerHTML = '';
          if (tab === 'Gallery') buildGalleryTab(body, close);
          else buildCoverLinkTab(body, close);
        };
        pickerTabs(root, ['Gallery', 'Link'], show, () => {
          close();
          setCover(null);
        });
        root.appendChild(body);
        show('Gallery');
      },
    });
  }

  // ---------- cover ----------

  function enterReposition(coverEl, page) {
    coverEl.classList.add('ed-repositioning');
    const hint = el('div', 'ed-cover-hint', 'Drag to reposition');
    coverEl.appendChild(hint);
    let dragging = false;
    let startY = 0;
    let pos = page.coverPos ?? 50;
    let startPos = pos;
    const id = page.id;

    const onDown = (e) => {
      dragging = true;
      startY = e.clientY;
      startPos = pos;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const height = coverEl.offsetHeight || COVER_FALLBACK_HEIGHT;
      const delta = ((e.clientY - startY) / height) * 100;
      pos = Math.max(0, Math.min(100, startPos - delta));
      coverEl.style.backgroundPositionY = `${pos}%`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      cleanup();
      updatePage(id, { coverPos: Math.round(pos) });
    };
    function cleanup() {
      coverEl.classList.remove('ed-repositioning');
      hint.remove();
      coverEl.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    coverEl.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function buildCover(page) {
    const cover = el('div', 'ed-cover');
    applyCoverStyle(cover, page.cover, page.coverPos);
    const btns = el('div', 'ed-cover-btns');
    const btn = (label, run) => {
      const b = el('button', 'ed-cover-btn');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      btns.appendChild(b);
      return b;
    };
    btn('Change cover', (e) => openCoverPicker(e.currentTarget));
    btn('Reposition', () => enterReposition(cover, page));
    btn('Remove', () => setCover(null));
    cover.appendChild(btns);
    return cover;
  }

  // ---------- doc header (icon / ghost row / lock / title) ----------

  function buildGhostRow(page) {
    const ghost = el('div', 'ed-ghost');
    const btn = (icon, label, run) => {
      const b = el('button', 'ed-ghost-btn');
      b.type = 'button';
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.addEventListener('click', run);
      ghost.appendChild(b);
      return b;
    };
    if (!page.icon) btn(ICONS.emoji, 'Add icon', (e) => openIconPicker(e.currentTarget));
    if (!page.cover) btn(ICONS.image, 'Add cover', (e) => openCoverPicker(e.currentTarget));
    btn(ICONS.comment, 'Add comment', () => ctx.toggleComments(page.id));
    return ghost;
  }

  // ---------- body ----------

  function renderDatabaseBody(host, page) {
    const token = renderToken;
    loadSurface('database')
      .then((mod) => {
        if (token !== renderToken) return;
        host.innerHTML = '';
        mod.renderDatabase(host, page, ctx);
      })
      .catch(() => {
        if (token !== renderToken) return;
        host.innerHTML = '';
        host.appendChild(el('div', 'ed-db-fallback', 'Database view'));
      });
  }

  // ---------- render ----------

  function render() {
    const page = getPage(pageId);
    if (!page) return;
    renderToken += 1;
    newMenuEl = null;
    container.innerHTML = '';

    scrollEl = el('div', 'ed-scroll');
    container.appendChild(scrollEl);

    if (page.cover) scrollEl.appendChild(buildCover(page));

    docEl = el('div', 'ed-doc');
    if (page.fullWidth) docEl.classList.add('ed-full');
    if (page.smallText) docEl.classList.add('ed-small');
    if (page.font === 'serif') docEl.classList.add('ed-serif');
    if (page.font === 'mono') docEl.classList.add('ed-mono');
    scrollEl.appendChild(docEl);

    if (page.icon) {
      const icon = el('button', page.cover ? 'ed-icon ed-icon-overlap' : 'ed-icon');
      icon.type = 'button';
      icon.appendChild(iconNode(page.icon));
      if (page.icon.type === 'icon' && page.icon.color) icon.style.color = page.icon.color;
      icon.addEventListener('click', (e) => openIconPicker(e.currentTarget));
      docEl.appendChild(icon);
    }

    docEl.appendChild(buildGhostRow(page));

    if (page.locked) docEl.appendChild(el('div', 'ed-lock', '🔒 Locked'));

    titleEl = el('h1', 'ed-title');
    titleEl.setAttribute('contenteditable', page.locked ? 'false' : 'true');
    titleEl.setAttribute('spellcheck', 'false');
    titleEl.textContent = page.title;
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dismissNewMenu();
        bodyEl?.focus();
      }
    });
    titleEl.addEventListener('input', () => {
      dismissNewMenu();
      saveTitleSoon();
    });
    docEl.appendChild(titleEl);

    const isNewPage = !page.locked && !page.title && page.blocks === '';

    if (isDatabase(page.blocks)) {
      bodyEl = null;
      const host = el('div', 'ed-db');
      docEl.appendChild(host);
      renderDatabaseBody(host, page);
    } else {
      if (isNewPage) {
        newMenuEl = buildNewMenu();
        docEl.appendChild(newMenuEl);
      }
      bodyEl = el('div', 'ed-body');
      bodyEl.setAttribute('contenteditable', page.locked ? 'false' : 'true');
      bodyEl.innerHTML = typeof page.blocks === 'string' ? page.blocks : '';
      bodyEl.addEventListener('input', () => {
        dismissNewMenu();
        saveBodySoon();
      });
      bodyEl.addEventListener('keydown', onBodyKeydown);
      bodyEl.addEventListener('click', onBodyClick);
      docEl.appendChild(bodyEl);
    }
  }

  // ---------- public API ----------

  function open(id) {
    pageId = id;
    render();
    container.classList.add('show');
    container.setAttribute('aria-hidden', 'false');
  }

  function close() {
    pageId = null;
    clearTimeout(titleTimer);
    clearTimeout(bodyTimer);
    container.classList.remove('show');
    container.setAttribute('aria-hidden', 'true');
  }

  function isOpen() {
    return pageId != null;
  }

  return { open, close, isOpen };
}
