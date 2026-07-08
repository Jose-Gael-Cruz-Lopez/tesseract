// Trash popover (`tr-` prefix). Opened from the sidebar's "Trash" row (and via
// ctx.openTrash in the app shell). Lists the roots of every deleted page
// subtree with a title filter, a restore action, and a two-step
// delete-forever confirmation. Empty when nothing has been trashed.
//
// No top-level DOM access — all DOM work lives inside openTrash so the module
// import-smokes in a bare node env. Consumes: store, popover, ICONS.

import { openPopover, el } from './popover.js';
import { ICONS } from './icons.js';
import { trashedPages, getPage, restorePage, destroyPage } from '../data/store.js';

/**
 * Open the Trash popover anchored to `anchor`.
 * Restore emits a store 'restore' event; delete-forever emits 'destroy' —
 * the subscribed sidebar re-renders its tree off those events.
 */
export function openTrash(anchor, ctx) {
  return openPopover(anchor, {
    className: 'tr-pop',
    placement: 'bottom-start',
    build: (root) => {
      let filter = '';

      const search = el('div', 'tr-search');
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'Filter by page title...';
      input.value = filter;
      search.appendChild(input);

      const list = el('div', 'tr-list');

      input.addEventListener('input', () => {
        filter = input.value;
        renderList();
      });

      function pageIconHTML(page) {
        const icon = page.icon;
        if (icon && icon.type === 'emoji' && icon.value) {
          return `<span class="tr-emoji">${icon.value}</span>`;
        }
        if (icon && icon.type === 'icon' && ICONS[icon.value]) return ICONS[icon.value];
        return ICONS.page;
      }

      function parentName(page) {
        if (page.parentId == null) return '';
        const parent = getPage(page.parentId);
        if (!parent) return '';
        return parent.title || 'Untitled';
      }

      function renderList() {
        list.innerHTML = '';
        const q = filter.trim().toLowerCase();
        const rows = trashedPages().filter((p) => {
          if (!q) return true;
          return (p.title || 'Untitled').toLowerCase().includes(q);
        });

        if (rows.length === 0) {
          const empty = el('div', 'tr-empty');
          empty.appendChild(el('div', 'tr-empty-icon', ICONS.trash));
          empty.appendChild(el('div', 'tr-empty-text', 'No pages in Trash'));
          list.appendChild(empty);
          return;
        }

        for (const page of rows) list.appendChild(renderRow(page));
      }

      function renderRow(page) {
        const row = el('div', 'tr-row');

        const icon = el('span', 'tr-row-icon', pageIconHTML(page));
        const main = el('div', 'tr-row-main');
        main.appendChild(el('div', 'tr-row-title', page.title || 'Untitled'));
        const parent = parentName(page);
        if (parent) main.appendChild(el('div', 'tr-row-parent', parent));

        const actions = el('div', 'tr-row-actions');
        const restore = el('button', 'tr-restore', ICONS.undo);
        restore.type = 'button';
        restore.title = 'Restore';
        restore.setAttribute('aria-label', 'Restore');
        const del = el('button', 'tr-delete', ICONS.trash);
        del.type = 'button';
        del.title = 'Delete permanently';
        del.setAttribute('aria-label', 'Delete permanently');
        actions.append(restore, del);

        restore.addEventListener('click', () => {
          restorePage(page.id);
          renderList();
        });

        del.addEventListener('click', () => {
          row.innerHTML = '';
          row.appendChild(buildConfirm(page, row));
        });

        row.append(icon, main, actions);
        return row;
      }

      function buildConfirm(page) {
        const confirm = el('div', 'tr-confirm');
        confirm.appendChild(el('span', 'tr-confirm-text', 'Are you sure?'));
        const yes = el('button', 'tr-confirm-yes', 'Delete permanently');
        yes.type = 'button';
        const cancel = el('button', 'tr-confirm-cancel', 'Cancel');
        cancel.type = 'button';
        confirm.append(yes, cancel);

        yes.addEventListener('click', () => {
          destroyPage(page.id);
          renderList();
        });
        cancel.addEventListener('click', () => {
          renderList();
        });
        return confirm;
      }

      root.append(search, list);
      renderList();
    },
  });
}
