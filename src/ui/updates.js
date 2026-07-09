// Updates inbox popover (sidebar "Updates" row). Three tabs — Inbox,
// Archived, All — all sharing the same empty state for now. No top-level
// DOM access: everything happens inside openUpdates()'s build callback.

import { openPopover } from './popover.js';
import { ICONS } from './icons.js';
import { ART } from './illustrations.js';

const TABS = ['Inbox', 'Archived', 'All'];

/**
 * Open the updates popover, anchored to `anchor` (the sidebar's Updates row).
 * `ctx.openSettings(panel)` is used by the gear icon; `ctx.toast(message)` is
 * used by controls with no behavior yet (the info icon).
 */
export function openUpdates(anchor, ctx) {
  return openPopover(anchor, {
    className: 'upd-pop',
    build(root) {
      root.innerHTML = `
        <div class="upd-header">
          <div class="upd-tabs">
            ${TABS.map((label, i) => `<button type="button" class="upd-tab${i === 0 ? ' upd-tab-active' : ''}" data-tab="${label.toLowerCase()}">${label}</button>`).join('')}
            <button type="button" class="upd-info" aria-label="About updates" title="About updates">${ICONS.info}</button>
          </div>
          <button type="button" class="upd-gear" aria-label="Notification settings" title="Notification settings">${ICONS.gear}</button>
        </div>
        <div class="upd-body">
          <div class="upd-empty">
            <div class="upd-empty-art">${ART.inboxEmpty}</div>
            <div class="upd-empty-title">You're all caught up</div>
            <div class="upd-empty-desc">When someone @mentions you, replies to your comments, or invites you to a page, you'll be notified here</div>
          </div>
        </div>`;

      const tabs = [...root.querySelectorAll('.upd-tab')];
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach((t) => t.classList.remove('upd-tab-active'));
          tab.classList.add('upd-tab-active');
          // All tabs render the same empty state for now — nothing else to swap.
        });
      });

      root.querySelector('.upd-info').addEventListener('click', () => ctx.toast('Coming soon'));
      root.querySelector('.upd-gear').addEventListener('click', () => ctx.openSettings('notifications'));
    },
  });
}
