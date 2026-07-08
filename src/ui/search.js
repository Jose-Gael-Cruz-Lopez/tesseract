// The ⌘K search modal — centered over the app, top-aligned near the page.
// No top-level DOM access: every DOM touch happens inside openSearch() so
// this module import-smokes safely. Surface modules never import each
// other; cross-surface actions (opening a page) go through `ctx`.

import { ICONS } from './icons.js';
import { el, openModal } from './popover.js';

const MAX_RECENT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_ORDER = ['Today', 'Past week', 'Older'];

// Which of the three date buckets a page's `edited` timestamp falls into.
function bucketFor(edited, now) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (edited >= startOfToday.getTime()) return 'Today';
  if (edited >= now - 7 * DAY_MS) return 'Past week';
  return 'Older';
}

// Stable grouping: pages arrive pre-sorted by relevance/recency and keep
// that relative order within each bucket.
function groupByEdited(pages) {
  const now = Date.now();
  const buckets = { Today: [], 'Past week': [], Older: [] };
  for (const page of pages) buckets[bucketFor(page.edited, now)].push(page);
  return GROUP_ORDER.map((label) => ({ label, pages: buckets[label] })).filter((g) => g.pages.length);
}

// Builds the leading icon cell: an emoji is user data (rendered as text),
// the fallback document glyph is trusted markup from ICONS.
function rowIconEl(page) {
  if (page.icon && page.icon.type === 'emoji' && page.icon.value) {
    return textSpan('srch-row-icon', page.icon.value);
  }
  return el('span', 'srch-row-icon', ICONS.page);
}

// Page titles/emoji are user data, never trusted markup — build these
// spans with textContent rather than el()'s innerHTML so a page titled
// e.g. "<img src=x onerror=...>" renders as inert text, not markup.
function textSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

export function openSearch(ctx) {
  const { store } = ctx;
  let query = '';
  let selectedIndex = 0;
  let flatIds = [];

  const closeModal = openModal({
    className: 'srch-modal',
    build(box) {
      const workspace = store.getWorkspace();
      const wsName = workspace ? workspace.name : '';

      const inputRow = el('div', 'srch-input-row');
      const inputIcon = el('span', 'srch-input-icon', ICONS.search);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'srch-input';
      input.placeholder = `Search ${wsName}…`;
      input.autocomplete = 'off';
      inputRow.appendChild(inputIcon);
      inputRow.appendChild(input);

      const listEl = el('div', 'srch-list');

      const footer = el('div', 'srch-footer');
      const hint = (text) => el('span', 'srch-hint', text);
      footer.appendChild(hint('↑↓ Select'));
      footer.appendChild(document.createTextNode(' '));
      footer.appendChild(hint('↵ Open'));
      footer.appendChild(document.createTextNode(' '));
      footer.appendChild(hint('⌘↵ Open in a new tab'));

      box.appendChild(inputRow);
      box.appendChild(listEl);
      box.appendChild(footer);

      function currentPages() {
        const q = query.trim();
        if (!q) {
          return store
            .getPages()
            .filter((p) => !p.deleted)
            .sort((a, b) => b.edited - a.edited)
            .slice(0, MAX_RECENT);
        }
        return store.searchPages(q).map((r) => r.page);
      }

      function openSelected() {
        const id = flatIds[selectedIndex];
        if (!id) return;
        ctx.openPage(id);
        closeModal();
      }

      function moveSelection(delta) {
        if (!flatIds.length) return;
        selectedIndex = (selectedIndex + delta + flatIds.length) % flatIds.length;
        render();
      }

      function render() {
        const pages = currentPages();
        flatIds = pages.map((p) => p.id);
        if (selectedIndex >= flatIds.length) selectedIndex = Math.max(0, flatIds.length - 1);

        listEl.innerHTML = '';

        if (!pages.length) {
          listEl.appendChild(el('div', 'srch-empty', 'No results'));
          return;
        }

        for (const group of groupByEdited(pages)) {
          listEl.appendChild(el('div', 'srch-group-label', group.label));
          for (const page of group.pages) {
            const idx = flatIds.indexOf(page.id);
            const isSelected = idx === selectedIndex;
            const row = el('div', `srch-row${isSelected ? ' is-selected' : ''}`);
            row.dataset.id = page.id;

            row.appendChild(rowIconEl(page));
            row.appendChild(textSpan('srch-row-title', page.title || 'Untitled'));

            if (page.parentId) {
              const parent = store.getPage(page.parentId);
              const parentTitle = parent ? parent.title || 'Untitled' : '';
              if (parentTitle) row.appendChild(textSpan('srch-row-parent', parentTitle));
            }

            row.appendChild(el('span', 'srch-row-enter', ICONS.enter));

            row.addEventListener('mouseenter', () => {
              if (selectedIndex === idx) return;
              selectedIndex = idx;
              render();
            });
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
              selectedIndex = idx;
              openSelected();
            });

            listEl.appendChild(row);
          }
        }
      }

      input.addEventListener('input', () => {
        query = input.value;
        selectedIndex = 0;
        render();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveSelection(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveSelection(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          openSelected();
        }
      });

      render();
      input.focus();
    },
  });

  return closeModal;
}
