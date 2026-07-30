// The sidebar in developer mode: the five canopy categories as groups, each
// with its items as rows. Built from the same graph the globe uses (no second
// fetch). A row click opens the read-only dev page and focuses the globe hub.

import { el, openPopover } from '../ui/popover.js';
import { hubGroups } from '../graph/graph-data.js';

const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The "Developer · canopy" header row: the mode-switch / Developer-settings /
// Log-out popover. Shared by the full sidebar and the chrome-only mount below.
function buildDevSbLabel(ctx) {
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
  return label;
}
