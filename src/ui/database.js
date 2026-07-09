// Databases-lite surface (19.png To-dos table, 20.png Design System gallery,
// 23.png view options panel, 24.png Reading List table).
//
// `renderDatabase(container, page, ctx)` renders `page.blocks` (a database
// config — see shared-context.md for the canonical shape) and persists every
// mutation via `ctx.store.updatePage(page.id, { blocks: config })`. The config
// object is mutated in place and re-rendered, so seeded databases (Task List,
// Reading List) and template-created ones flow through the exact same path.
//
// No top-level DOM access — all DOM work happens inside renderDatabase.

import { ICONS } from './icons.js';
import { openPopover, el } from './popover.js';

const KIND_GLYPHS = {
  title: 'Aa',
  text: '≡',
  checkbox: '☑',
  select: '⌄',
  stars: '★',
  date: '📅',
  url: '🔗',
  person: '👤',
};

const LAYOUT_ICONS = {
  table: ICONS.table,
  gallery: ICONS.templates,
  board: ICONS.board,
  timeline: ICONS.timeline,
  calendar: ICONS.calendar,
};

const LAYOUT_ORDER = ['table', 'gallery', 'board', 'timeline', 'calendar'];
const LAYOUT_LABELS = { table: 'Table', gallery: 'Gallery', board: 'Board', timeline: 'Timeline', calendar: 'Calendar' };

const CHIP_COLORS = ['gray', 'blue', 'green', 'yellow', 'red'];

// Glyph strip for gallery cards without an image/url value (20.png/23.png
// cover areas are icon collages; ours is a fixed decorative line-icon strip).
const COVER_GLYPHS = [ICONS.image, ICONS.starFilled, ICONS.lock, ICONS.gear, ICONS.duplicate];

function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function renderDatabase(container, page, ctx) {
  const config = page.blocks;
  if (!config || config.type !== 'database' || !Array.isArray(config.views) || !config.views.length) {
    container.innerHTML = '';
    return;
  }

  const persist = () => ctx.store.updatePage(page.id, { blocks: config });
  const soon = () => ctx.toast('Coming soon');

  const colById = (id) => config.columns.find((c) => c.id === id);
  const titleCol = config.columns.find((c) => c.kind === 'title');
  const activeView = () =>
    config.views.find((v) => v.id === config.activeView) || config.views[0];

  // A filter with no value yet (a "Status ⌄" style chip, 20.png) matches everything.
  const visibleRows = (view) =>
    config.rows.filter((row) =>
      (view.filters || []).every((f) => f.value == null || f.value === '' || row.cells[f.colId] === f.value),
    );

  const colorOf = (col, value) =>
    (col.options || []).find((o) => o.label === value)?.color;

  function chipEl(label, color) {
    const chip = el('span', `db-chip db-chip-${CHIP_COLORS.includes(color) ? color : 'gray'}`);
    chip.textContent = label;
    return chip;
  }

  // Group `rows` by a select column: one bucket per option (in option order,
  // empty buckets skipped) + a trailing "No <name>" bucket for unset values.
  function groupRows(rows, col) {
    const groups = [];
    const labels = new Set((col.options || []).map((o) => o.label));
    for (const opt of col.options || []) {
      const bucket = rows.filter((r) => r.cells[col.id] === opt.label);
      if (bucket.length) groups.push({ option: opt, rows: bucket });
    }
    const leftover = rows.filter((r) => {
      const v = r.cells[col.id];
      return v == null || v === '' || !labels.has(v);
    });
    if (leftover.length) groups.push({ option: null, rows: leftover });
    return groups;
  }

  // The filter-value / select-cell popover lists a column's pickable values.
  function columnOptions(col) {
    if (col.kind === 'select') {
      return (col.options || []).map((o) => ({ label: o.label, value: o.label, color: o.color }));
    }
    if (col.kind === 'stars') {
      return [1, 2, 3, 4, 5].map((n) => ({ label: '★'.repeat(n), value: n }));
    }
    const seen = [];
    for (const row of config.rows) {
      const v = row.cells[col.id];
      if (v != null && v !== '' && !seen.includes(v)) seen.push(v);
    }
    return seen.map((v) => ({ label: String(v), value: v }));
  }

  function openOptionsPopover(anchor, col, onPick) {
    openPopover(anchor, {
      className: 'db-opt-pop',
      build(root, close) {
        for (const opt of columnOptions(col)) {
          const btn = el('button', 'db-opt');
          btn.type = 'button';
          if (col.kind === 'select') btn.appendChild(chipEl(opt.label, opt.color));
          else btn.textContent = opt.label;
          btn.addEventListener('click', () => {
            close();
            onPick(opt.value);
          });
          root.appendChild(btn);
        }
      },
    });
  }

  function addRow() {
    const row = { id: uid(), cells: {} };
    config.rows.push(row);
    persist();
    rerender();
    container.querySelector(`.db-row[data-row-id="${row.id}"] .db-title-text`)?.focus();
  }

  // ---------- chrome: view tabs + right cluster ----------

  function buildChrome(view) {
    const chrome = el('div', 'db-chrome');

    const tabs = el('div', 'db-tabs');
    for (const v of config.views) {
      const t = el('button', v.id === view.id ? 'db-tab db-tab-active' : 'db-tab');
      t.type = 'button';
      t.appendChild(el('span', 'db-tab-ic', LAYOUT_ICONS[v.layout] || ICONS.table));
      const name = el('span', 'db-tab-name');
      name.textContent = v.name;
      t.appendChild(name);
      t.addEventListener('click', () => {
        if (config.activeView === v.id) return;
        config.activeView = v.id;
        persist();
        rerender();
      });
      tabs.appendChild(t);
    }
    const addTab = el('button', 'db-tab-add', ICONS.plus);
    addTab.type = 'button';
    addTab.addEventListener('click', soon);
    tabs.appendChild(addTab);
    chrome.appendChild(tabs);

    const ctas = el('div', 'db-ctas');
    for (const label of ['Filter', 'Sort']) {
      const b = el('button', 'db-txtbtn');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', soon);
      ctas.appendChild(b);
    }
    const search = el('button', 'db-icbtn db-search', ICONS.search);
    search.type = 'button';
    search.addEventListener('click', soon);
    ctas.appendChild(search);
    const more = el('button', 'db-icbtn db-more', ICONS.more);
    more.type = 'button';
    more.addEventListener('click', (e) => openViewOptions(e.currentTarget, activeView()));
    ctas.appendChild(more);
    const newBtn = el('button', 'db-new', 'New <span class="db-new-caret">▾</span>');
    newBtn.type = 'button';
    newBtn.addEventListener('click', addRow);
    ctas.appendChild(newBtn);
    chrome.appendChild(ctas);

    return chrome;
  }

  // ---------- chip bar ----------

  function buildChips(view) {
    const bar = el('div', 'db-chips');
    for (const filter of view.filters || []) {
      const col = colById(filter.colId);
      if (!col) continue;
      const chip = el('button', 'db-chip-filter');
      chip.type = 'button';
      chip.textContent =
        filter.value != null && filter.value !== ''
          ? `${col.name}: ${filter.value} ▾`
          : `${col.name} ▾`;
      chip.addEventListener('click', (e) => {
        openOptionsPopover(e.currentTarget, col, (value) => {
          filter.value = filter.value === value ? null : value; // re-pick clears
          persist();
          rerender();
        });
      });
      bar.appendChild(chip);
    }
    const add = el('button', 'db-addfilter');
    add.type = 'button';
    add.textContent = '+ Add filter';
    add.addEventListener('click', (e) => {
      const anchor = e.currentTarget;
      openPopover(anchor, {
        className: 'db-opt-pop',
        build(root, close) {
          for (const col of config.columns) {
            const btn = el('button', 'db-opt');
            btn.type = 'button';
            btn.innerHTML = `<span class="db-kind">${KIND_GLYPHS[col.kind] || ''}</span>`;
            const name = el('span');
            name.textContent = col.name;
            btn.appendChild(name);
            btn.addEventListener('click', () => {
              close();
              (view.filters ||= []).push({ colId: col.id, value: null });
              persist();
              rerender();
            });
            root.appendChild(btn);
          }
        },
      });
    });
    bar.appendChild(add);
    return bar;
  }

  // ---------- table cells ----------

  function buildCell(row, col) {
    const cell = el('div', `db-cell db-cell-${col.kind}`);

    if (col.kind === 'title') {
      const text = el('span', 'db-title-text');
      text.setAttribute('contenteditable', 'true');
      text.setAttribute('spellcheck', 'false');
      text.textContent = row.cells[col.id] || '';
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          text.blur();
        }
      });
      text.addEventListener('blur', () => {
        const value = text.textContent.replace(/\n/g, ' ').trim();
        if (value === (row.cells[col.id] || '')) return;
        row.cells[col.id] = value;
        persist();
      });
      cell.appendChild(text);
      // Rows are not pages — OPEN just drops you into inline editing.
      const open = el('button', 'db-open');
      open.type = 'button';
      open.textContent = 'OPEN ↗';
      open.addEventListener('click', () => text.focus());
      cell.appendChild(open);
      return cell;
    }

    if (col.kind === 'checkbox') {
      const box = el('input', 'db-check');
      box.type = 'checkbox';
      box.checked = !!row.cells[col.id];
      box.addEventListener('change', () => {
        row.cells[col.id] = box.checked;
        persist();
      });
      cell.appendChild(box);
      return cell;
    }

    if (col.kind === 'select') {
      const value = row.cells[col.id];
      if (value) cell.appendChild(chipEl(value, colorOf(col, value))); // empty shows nothing
      cell.addEventListener('click', (e) => {
        openOptionsPopover(e.currentTarget, col, (picked) => {
          row.cells[col.id] = picked;
          persist();
          rerender();
        });
      });
      return cell;
    }

    if (col.kind === 'stars') {
      const value = Number(row.cells[col.id]) || 0;
      const pill = el('span', value > 0 ? 'db-stars db-stars-set' : 'db-stars');
      for (let i = 0; i < 5; i += 1) {
        const star = el('button', i < value ? 'db-star db-star-on' : 'db-star');
        star.type = 'button';
        star.textContent = '★';
        star.addEventListener('click', () => {
          row.cells[col.id] = value === i + 1 ? 0 : i + 1; // re-click clears
          persist();
          rerender();
        });
        pill.appendChild(star);
      }
      cell.appendChild(pill);
      return cell;
    }

    // text / date / url / person: inline contenteditable
    const value = row.cells[col.id] != null ? String(row.cells[col.id]) : '';
    if (col.kind === 'person' && value) {
      const avatar = el('span', 'db-avatar');
      avatar.textContent = value.trim().charAt(0).toUpperCase();
      cell.appendChild(avatar);
    }
    const text = el('span', 'db-edit');
    text.setAttribute('contenteditable', 'true');
    text.setAttribute('spellcheck', 'false');
    text.textContent = value;
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        text.blur();
      }
    });
    text.addEventListener('blur', () => {
      const next = text.textContent.replace(/\n/g, ' ').trim();
      if (next === value) return;
      row.cells[col.id] = next;
      persist();
    });
    cell.appendChild(text);
    return cell;
  }

  function buildRow(row) {
    const rowEl = el('div', 'db-row');
    rowEl.dataset.rowId = row.id;
    for (const col of config.columns) rowEl.appendChild(buildCell(row, col));
    return rowEl;
  }

  function buildHeaderRow() {
    const header = el('div', 'db-hrow');
    for (const col of config.columns) {
      const cell = el('div', `db-hcell db-cell-${col.kind}`);
      cell.appendChild(el('span', 'db-kind', KIND_GLYPHS[col.kind] || ''));
      if (col.kind !== 'checkbox') {
        const name = el('span', 'db-hname');
        name.textContent = col.name;
        cell.appendChild(name);
      }
      header.appendChild(cell);
    }
    return header;
  }

  function buildFooter() {
    const foot = el('div', 'db-foot');
    const newRow = el('button', 'db-newrow');
    newRow.type = 'button';
    newRow.textContent = '+ New';
    newRow.addEventListener('click', addRow);
    foot.appendChild(newRow);
    const calc = el('button', 'db-calc');
    calc.type = 'button';
    calc.textContent = 'Calculate ⌄';
    calc.addEventListener('click', soon);
    foot.appendChild(calc);
    return foot;
  }

  function buildTable(view) {
    const table = el('div', 'db-table');
    table.appendChild(buildHeaderRow());
    const rows = visibleRows(view);
    const groupCol = view.groupBy ? colById(view.groupBy) : null;
    if (groupCol && groupCol.kind === 'select') {
      for (const group of groupRows(rows, groupCol)) {
        const section = el('div', 'db-group');
        const head = el('div', 'db-group-head');
        if (group.option) head.appendChild(chipEl(group.option.label, group.option.color));
        else {
          const none = el('span', 'db-group-none');
          none.textContent = `No ${groupCol.name}`;
          head.appendChild(none);
        }
        head.appendChild(document.createTextNode(' '));
        head.appendChild(el('span', 'db-group-count', String(group.rows.length)));
        section.appendChild(head);
        for (const row of group.rows) section.appendChild(buildRow(row));
        table.appendChild(section);
      }
    } else {
      for (const row of rows) table.appendChild(buildRow(row));
    }
    table.appendChild(buildFooter());
    return table;
  }

  // ---------- gallery ----------

  function buildGallery(view) {
    const grid = el('div', 'db-gallery');
    const urlCol = config.columns.find((c) => c.kind === 'url');
    for (const row of visibleRows(view)) {
      const card = el('div', 'db-card');
      const cover = el('div', 'db-card-cover');
      const url = urlCol ? row.cells[urlCol.id] : '';
      if (url) {
        const img = el('img', 'db-card-img');
        img.src = url;
        img.alt = '';
        cover.appendChild(img);
      } else {
        cover.classList.add('db-card-glyphs');
        cover.innerHTML = COVER_GLYPHS.map((g) => `<span class="db-card-glyph">${g}</span>`).join('');
      }
      card.appendChild(cover);
      const title = el('div', 'db-card-title');
      title.textContent = (titleCol && row.cells[titleCol.id]) || 'Untitled';
      card.appendChild(title);
      const chips = el('div', 'db-card-chips');
      for (const col of config.columns) {
        if (col.kind !== 'select') continue;
        const value = row.cells[col.id];
        if (value) chips.appendChild(chipEl(value, colorOf(col, value)));
      }
      card.appendChild(chips);
      grid.appendChild(card);
    }
    const ghost = el('button', 'db-card-new');
    ghost.type = 'button';
    ghost.textContent = '+ New';
    ghost.addEventListener('click', addRow);
    grid.appendChild(ghost);
    return grid;
  }

  // ---------- board ----------

  function buildBoard(view) {
    const board = el('div', 'db-board');
    const groupCol =
      (view.groupBy && colById(view.groupBy)?.kind === 'select' && colById(view.groupBy)) ||
      config.columns.find((c) => c.kind === 'select');
    const rows = visibleRows(view);
    if (!groupCol) {
      board.appendChild(el('div', 'db-stub-ghost', 'This view is coming soon'));
      return board;
    }
    for (const group of groupRows(rows, groupCol)) {
      const column = el('div', 'db-bcol');
      const head = el('div', 'db-bcol-head');
      if (group.option) head.appendChild(chipEl(group.option.label, group.option.color));
      else {
        const none = el('span', 'db-group-none');
        none.textContent = `No ${groupCol.name}`;
        head.appendChild(none);
      }
      head.appendChild(document.createTextNode(' '));
      head.appendChild(el('span', 'db-group-count', String(group.rows.length)));
      column.appendChild(head);
      for (const row of group.rows) {
        const card = el('div', 'db-bcard');
        card.textContent = (titleCol && row.cells[titleCol.id]) || 'Untitled';
        column.appendChild(card);
      }
      board.appendChild(column);
    }
    return board;
  }

  // ---------- timeline / calendar stub ----------

  function buildStub(view) {
    const stub = el('div', 'db-stub');
    const head = el('div', 'db-stub-head', LAYOUT_ICONS[view.layout] || '');
    const name = el('span');
    name.textContent = view.name;
    head.appendChild(name);
    stub.appendChild(head);
    stub.appendChild(el('div', 'db-stub-ghost', 'This view is coming soon'));
    return stub;
  }

  // ---------- view options panel (23.png) ----------

  function openViewOptions(anchor, view) {
    openPopover(anchor, {
      className: 'db-vopts',
      placement: 'bottom-end',
      build(root, close) {
        root.appendChild(el('div', 'db-vo-title', 'View options'));

        const nameRow = el('div', 'db-vo-name', `<span class="db-vo-ic">${ICONS.newPage}</span>`);
        const input = el('input', 'db-vo-input');
        input.value = view.name;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
        });
        input.addEventListener('blur', () => {
          const name = input.value.trim();
          if (!name || name === view.name) return;
          view.name = name;
          persist();
          rerender();
        });
        nameRow.appendChild(input);
        root.appendChild(nameRow);

        const row = (icon, label, value, run, danger) => {
          const r = el('button', danger ? 'db-vo-row db-vo-danger' : 'db-vo-row');
          r.type = 'button';
          r.innerHTML = `<span class="db-vo-ic">${icon}</span><span class="db-vo-label"></span>`;
          r.querySelector('.db-vo-label').textContent = label;
          if (value != null) {
            const val = el('span', 'db-vo-value');
            val.textContent = value;
            r.appendChild(val);
            r.appendChild(el('span', 'db-vo-chev', ICONS.chevron));
          }
          r.addEventListener('click', run);
          root.appendChild(r);
          return r;
        };

        const layoutRow = row(ICONS.expand, 'Layout', LAYOUT_LABELS[view.layout] || 'Table', () => {
          const next = LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(view.layout) + 1) % LAYOUT_ORDER.length];
          view.layout = next;
          persist();
          rerender();
          layoutRow.querySelector('.db-vo-value').textContent = LAYOUT_LABELS[next];
        });
        row(ICONS.settings, 'Properties', `${config.columns.length} shown`, soon);
        const filterCount = (view.filters || []).length;
        row(ICONS.search, 'Filter', filterCount === 1 ? '1 filter' : `${filterCount} filters`, soon);
        row(ICONS.arrowUpDown, 'Sort', 'None', soon);
        row(ICONS.board, 'Group', (view.groupBy && colById(view.groupBy)?.name) || 'None', soon);

        root.appendChild(el('div', 'db-vo-div'));

        row(ICONS.lock, 'Lock database', null, soon);
        row(ICONS.link, 'Copy link to view', null, soon);
        row(ICONS.duplicate, 'Duplicate view', null, () => {
          const copy = structuredClone(view);
          copy.id = uid();
          copy.name = `${view.name} (1)`;
          config.views.push(copy);
          config.activeView = copy.id;
          persist();
          close();
          rerender();
        });
        row(ICONS.trash, 'Delete view', null, () => {
          if (config.views.length <= 1) {
            soon(); // the only view can't be deleted yet
            return;
          }
          config.views = config.views.filter((v) => v.id !== view.id);
          if (config.activeView === view.id) config.activeView = config.views[0].id;
          persist();
          close();
          rerender();
        }, true);
      },
    });
  }

  // ---------- render ----------

  function buildBody(view) {
    if (view.layout === 'gallery') return buildGallery(view);
    if (view.layout === 'board') return buildBoard(view);
    if (view.layout === 'timeline' || view.layout === 'calendar') return buildStub(view);
    return buildTable(view);
  }

  function rerender() {
    container.innerHTML = '';
    const root = el('div', 'db');
    if (config.intro) root.appendChild(el('div', 'db-intro', config.intro));
    const view = activeView();
    root.appendChild(buildChrome(view));
    root.appendChild(buildChips(view));
    root.appendChild(buildBody(view));
    container.appendChild(root);
  }

  rerender();
}
