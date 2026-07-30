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
