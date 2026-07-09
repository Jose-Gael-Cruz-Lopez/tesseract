// The sidebar in developer mode: the five canopy categories as groups, each
// with its items as rows. Built from the same graph the globe uses (no second
// fetch). A row click opens the read-only dev page and focuses the globe hub.

import { el } from '../ui/popover.js';

const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// graph = { hubs: [{ page:{title, icon}, leaves:[{page:{title, devKind, devRef, id}}] }] }
// ctx.openDevItem(node) opens the item; ctx.refreshDev() re-fetches.
export function mountDevSidebar(container, ctx, graph) {
  container.innerHTML = '';
  const root = el('div', 'dev-sb');

  const label = el('div', 'dev-sb-label', 'Developer · canopy');
  root.appendChild(label);

  for (const hub of graph.hubs) {
    const group = el('div', 'dev-sb-group');
    const header = el('div', 'dev-sb-group-head');
    header.appendChild(el('span', 'dev-sb-icon', hub.page.icon || ''));
    header.appendChild(el('span', 'dev-sb-group-title', escapeText(hub.page.title)));
    header.appendChild(el('span', 'dev-sb-count', String(hub.leaves.length)));
    group.appendChild(header);

    for (const leaf of hub.leaves) {
      const row = el('button', 'dev-sb-row');
      row.type = 'button';
      row.appendChild(el('span', 'dev-sb-row-title', escapeText(leaf.page.title)));
      row.addEventListener('click', () => ctx.openDevItem(leaf.page));
      group.appendChild(row);
    }
    root.appendChild(group);
  }

  container.appendChild(root);
  return { root };
}
