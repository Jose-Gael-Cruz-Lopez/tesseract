// The sidebar in developer mode: the five canopy categories as groups, each
// with its items as rows. Built from the same graph the globe uses (no second
// fetch). A row click opens the read-only dev page and focuses the globe hub.

import { el, openPopover } from '../ui/popover.js';

const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// graph = { hubs: [{ page:{title, icon}, leaves:[{page:{title, devKind, devRef, id}}] }] }
// ctx.openDevItem(node) opens the item; ctx.setMode switches back to Knowledge.
// ctx.devHub() / ctx.devHubs() / ctx.setDevHub(repo) drive the active-hub switcher
// (the dev-side mirror of canopy's admin repo switcher).
export function mountDevSidebar(container, ctx, graph) {
  container.innerHTML = '';
  const root = el('div', 'dev-sb');

  // Header doubles as the mode switch (the dev sidebar replaces the knowledge
  // one, so the switch must live here too).
  const label = el('button', 'dev-sb-label dev-sb-switch', 'Developer · canopy ⌄');
  label.type = 'button';
  label.addEventListener('click', () => {
    openPopover(label, {
      className: 'sb-ws-pop',
      build: (pop, close) => {
        pop.appendChild(el('div', 'sb-menu-label', 'Switch mode'));
        for (const [id, text] of [['knowledge', 'Knowledge'], ['developer', 'Developer']]) {
          const active = id === 'developer';
          const item = el('button', 'sb-menu-item' + (active ? ' is-active' : ''), (active ? '✓ ' : '') + text);
          item.type = 'button';
          item.addEventListener('click', () => { close(); ctx.setMode && ctx.setMode(id); });
          pop.appendChild(item);
        }
        pop.appendChild(el('div', 'sb-menu-divider'));
        const settings = el('button', 'sb-menu-item', 'Developer settings');
        settings.type = 'button';
        settings.addEventListener('click', () => { close(); ctx.openSettings && ctx.openSettings('developer'); });
        pop.appendChild(settings);
        const logout = el('button', 'sb-menu-item', 'Log out');
        logout.type = 'button';
        logout.addEventListener('click', () => { close(); ctx.logOut && ctx.logOut(); });
        pop.appendChild(logout);
      },
    });
  });
  root.appendChild(label);

  // Active-hub switcher: which /r/:owner/:repo hub the sphere reads. Only rendered
  // when the shell provides the hub dimension (an active hub always exists then).
  const activeHub = ctx.devHub && ctx.devHub();
  if (activeHub) {
    const hubBtn = el('button', 'dev-sb-hub', escapeText(activeHub) + ' ⌄');
    hubBtn.type = 'button';
    hubBtn.title = 'Switch hub';
    hubBtn.addEventListener('click', () => {
      openPopover(hubBtn, {
        className: 'sb-ws-pop',
        build: (pop, close) => {
          pop.appendChild(el('div', 'sb-menu-label', 'Switch hub'));
          // A failed /me/repos leaves the list empty — still show the active hub.
          const hubs = (ctx.devHubs && ctx.devHubs()) || [];
          for (const r of hubs.length ? hubs : [{ repo: activeHub }]) {
            const active = r.repo === activeHub;
            const item = el('button', 'sb-menu-item' + (active ? ' is-active' : ''), (active ? '✓ ' : '') + escapeText(r.repo));
            item.type = 'button';
            item.addEventListener('click', () => { close(); ctx.setDevHub && ctx.setDevHub(r.repo); });
            pop.appendChild(item);
          }
        },
      });
    });
    root.appendChild(hubBtn);
  }

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
