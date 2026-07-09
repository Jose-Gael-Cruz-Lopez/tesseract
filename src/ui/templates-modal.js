// The "Templates" gallery modal (19.png / 20.png) — a two-pane layout: a
// left rail (search + a static "All templates" dropdown chip + the Task-14
// catalog grouped by category) and a right preview pane (title, a static
// mini table/gallery for database templates, plain intro text for doc
// templates) with a bottom-docked "Get template" card. No top-level DOM
// access — every DOM touch happens inside openTemplates() so this module
// import-smokes cleanly.
//
// Surface modules never import each other: the template's page is created
// through ctx.store (never a direct src/data/store.js import) and opened
// through ctx.openPage, never by importing another surface module.

import { openModal, el } from './popover.js';
import { TEMPLATES } from '../data/templates.js';

// Category order is derived from the catalog itself (first-appearance
// order), not hardcoded, so the rail always mirrors src/data/templates.js.
const CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

// Small glyph shown before each mini-table header, echoing Notion's
// per-property type icon. Purely decorative chrome for a *static* preview
// (never a real database view) — see renderTable() below.
const KIND_GLYPH = {
  title: 'Aa',
  text: 'Aa',
  select: '◐',
  stars: '★',
  date: '🗓',
  url: '🔗',
  person: '👤',
};

const LAYOUT_GLYPH = {
  table: '☰',
  gallery: '⊞',
  board: '📋',
  timeline: '📈',
  calendar: '📅',
};

/** Open the templates gallery modal. */
export function openTemplates(ctx) {
  let close;
  close = openModal({
    className: 'tpl-modal',
    build(box, closeFn) {
      close = closeFn;
      renderTemplatesModal(box, close, ctx);
    },
  });
  return close;
}

function renderTemplatesModal(box, close, ctx) {
  let selected = TEMPLATES[0];
  let query = '';

  // ---------- left rail ----------
  const rail = el('div', 'tpl-rail');

  const searchWrap = el('div', 'tpl-search');
  searchWrap.appendChild(el('span', 'tpl-search-icon', '🔍'));
  const searchInput = el('input', 'tpl-search-input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search templates';
  searchWrap.appendChild(searchInput);
  rail.appendChild(searchWrap);

  const allChip = el('button', 'tpl-all-chip', '👤 All templates ⌄');
  allChip.type = 'button';
  allChip.addEventListener('click', () => ctx.toast('Coming soon'));
  rail.appendChild(allChip);

  const railList = el('div', 'tpl-rail-list');
  rail.appendChild(railList);
  box.appendChild(rail);

  // ---------- right preview pane ----------
  const previewPane = el('div', 'tpl-preview-pane');
  const preview = el('div', 'tpl-preview');
  const footer = el('div', 'tpl-footer');
  previewPane.appendChild(preview);
  previewPane.appendChild(footer);
  box.appendChild(previewPane);

  function renderRail() {
    railList.innerHTML = '';
    const q = query.trim().toLowerCase();

    for (const category of CATEGORIES) {
      const inCategory = TEMPLATES.filter((t) => t.category === category);
      const visible = q ? inCategory.filter((t) => t.name.toLowerCase().includes(q)) : inCategory;
      if (visible.length === 0) continue;

      railList.appendChild(el('div', 'tpl-cat-label', category));

      for (const t of visible) {
        const row = el('button', `tpl-row${t.id === selected.id ? ' is-active' : ''}`);
        row.type = 'button';
        row.dataset.id = t.id;
        row.appendChild(el('span', 'tpl-row-icon', t.icon));
        row.appendChild(el('span', 'tpl-row-name', t.name));
        row.addEventListener('click', () => {
          selected = t;
          renderRail();
          renderPreview();
        });
        railList.appendChild(row);
      }
    }
  }

  function renderPreview() {
    preview.innerHTML = '';
    footer.innerHTML = '';

    const built = selected.build();

    const header = el('div', 'tpl-preview-header');
    header.appendChild(el('span', 'tpl-preview-icon', built.icon?.value || selected.icon));
    header.appendChild(el('span', 'tpl-preview-title', built.title));
    preview.appendChild(header);

    if (built.blocks && typeof built.blocks === 'object' && built.blocks.type === 'database') {
      preview.appendChild(renderDatabasePreview(built.blocks));
    } else {
      preview.appendChild(el('div', 'tpl-preview-doc', built.blocks || ''));
    }

    // ---- bottom-docked card: catalog name/description, never the built
    // page's own title (e.g. "To-do list" here, even though its built page
    // is titled "To-dos" above — matches 19.png exactly). ----
    const info = el('div', 'tpl-footer-info');
    info.appendChild(el('span', 'tpl-footer-icon', selected.icon));
    const text = el('div', 'tpl-footer-text');
    text.appendChild(el('div', 'tpl-footer-name', selected.name));
    text.appendChild(el('div', 'tpl-footer-desc', selected.description));
    info.appendChild(text);
    footer.appendChild(info);

    const actions = el('div', 'tpl-footer-actions');
    const getBtn = el('button', 'tpl-get-btn', 'Get template');
    getBtn.type = 'button';
    getBtn.addEventListener('click', () => {
      const partial = selected.build();
      const page = ctx.store.createPage({ ...partial, parentId: null });
      ctx.openPage(page.id);
      close();
    });
    actions.appendChild(getBtn);
    actions.appendChild(el('div', 'tpl-made-by', `Made by ${selected.madeBy}`));
    footer.appendChild(actions);
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderRail();
  });

  renderRail();
  renderPreview();
}

// ---------- static database preview (reuses simple markup, never the live
// database.js module — per shared-context.md, surface modules never import
// each other) ----------

function renderDatabasePreview(db) {
  const wrap = el('div', 'tpl-preview-db');
  const view = db.views.find((v) => v.id === db.activeView) || db.views[0];

  const tabs = el('div', 'tpl-preview-tabs');
  for (const v of db.views) {
    tabs.appendChild(
      el('span', `tpl-tab${v.id === view.id ? ' is-active' : ''}`, `${LAYOUT_GLYPH[v.layout] || '☰'} ${v.name}`),
    );
  }
  wrap.appendChild(tabs);

  wrap.appendChild(view.layout === 'gallery' ? renderGallery(db) : renderTable(db));
  return wrap;
}

function renderTable(db) {
  const table = el('table', 'tpl-preview-table');
  const checkboxCol = db.columns.find((c) => c.kind === 'checkbox');
  const headerCols = db.columns.filter((c) => c.kind !== 'checkbox');

  const thead = el('thead');
  const headRow = el('tr');
  for (const col of headerCols) {
    headRow.appendChild(el('th', '', `${KIND_GLYPH[col.kind] || ''} ${col.name}`.trim()));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of db.rows) {
    const tr = el('tr');
    headerCols.forEach((col, i) => {
      const value = row.cells[col.id];
      const td = el('td');
      if (i === 0 && checkboxCol) {
        td.textContent = `${row.cells[checkboxCol.id] ? '☑' : '☐'} ${value ?? ''}`;
      } else if (col.kind === 'select' && value) {
        const opt = (col.options || []).find((o) => o.label === value);
        td.appendChild(el('span', `tpl-tag tpl-tag-${opt?.color || 'gray'}`, value));
      } else if (col.kind === 'stars') {
        const n = value || 0;
        td.textContent = '★'.repeat(n) + '☆'.repeat(5 - n);
      } else {
        td.textContent = value ?? '';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function renderGallery(db) {
  const grid = el('div', 'tpl-gallery');
  const titleCol = db.columns.find((c) => c.kind === 'title') || db.columns[0];
  const otherCols = db.columns.filter((c) => c.id !== titleCol.id);

  for (const row of db.rows) {
    const card = el('div', 'tpl-gallery-card');
    card.appendChild(el('div', 'tpl-gallery-card-media'));
    const body = el('div', 'tpl-gallery-card-body');
    body.appendChild(el('div', 'tpl-gallery-card-title', row.cells[titleCol.id] || ''));
    for (const col of otherCols) {
      const value = row.cells[col.id];
      if (!value) continue;
      if (col.kind === 'select') {
        const opt = (col.options || []).find((o) => o.label === value);
        body.appendChild(el('span', `tpl-tag tpl-tag-${opt?.color || 'gray'}`, value));
      } else {
        body.appendChild(el('span', 'tpl-gallery-card-sub', value));
      }
    }
    card.appendChild(body);
    grid.appendChild(card);
  }
  return grid;
}
