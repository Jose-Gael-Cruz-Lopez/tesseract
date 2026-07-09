// Single "create your first teamspace" modal (reference: 22.png).
// No top-level DOM access — all DOM work happens inside openTeamspace() so
// this module import-smokes cleanly.

import { openModal, el } from './popover.js';
import { ART } from './illustrations.js';
import { ICONS } from './icons.js';

// A small, fixed set of emoji the icon tile cycles through when clicked.
// Index -1 (the starting state) shows the derived letter instead of an emoji.
const ICON_EMOJI_CYCLE = ['🚀', '🏢', '📁', '💡', '🌍', '⭐'];

function letterFor(name) {
  const trimmed = name.trim();
  return (trimmed ? trimmed[0] : 'T').toUpperCase();
}

/** Open the "create your first teamspace" modal. */
export function openTeamspace(ctx) {
  return openModal({
    className: 'ts-modal',
    build: (box, close) => renderTeamspaceModal(box, close, ctx),
  });
}

function renderTeamspaceModal(box, close, ctx) {
  const workspace = ctx.store.getWorkspace();

  let name = '';
  let description = '';
  let iconIndex = -1; // -1 = letter mode, >=0 = index into ICON_EMOJI_CYCLE

  // ---- banner ----
  const banner = el('div', 'ts-banner');
  const avatars = el('div', 'ts-banner-avatars', ART.trioAvatars);
  const bannerText = el(
    'div',
    'ts-banner-text',
    'Create your first teamspace to start using Mnemosphere with your teammates'
  );
  const closeBtn = el('button', 'ts-close', ICONS.close);
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  banner.append(avatars, bannerText, closeBtn);

  // ---- body ----
  const body = el('div', 'ts-body');

  const iconTile = el('button', 'ts-icon-tile', letterFor(name));
  iconTile.type = 'button';
  iconTile.setAttribute('aria-label', 'Choose icon');
  const iconCaption = el('div', 'ts-icon-caption', 'Choose icon');

  function renderIconTile() {
    iconTile.textContent = iconIndex === -1 ? letterFor(name) : ICON_EMOJI_CYCLE[iconIndex];
  }

  iconTile.addEventListener('click', () => {
    iconIndex += 1;
    if (iconIndex >= ICON_EMOJI_CYCLE.length) iconIndex = -1;
    renderIconTile();
  });

  const nameLabel = el('label', 'ts-label', 'Teamspace name');
  const nameInput = el('input', 'ts-name-input');
  nameInput.type = 'text';
  nameInput.id = 'ts-name-input';
  nameLabel.htmlFor = nameInput.id;
  nameInput.placeholder = 'Acme Labs';
  const nameSub = el(
    'div',
    'ts-name-sub',
    'Teamspaces are where your team organizes pages, permissions, and members'
  );

  const descLabel = el('label', 'ts-label', 'Description (optional)');
  const descInput = el('textarea', 'ts-desc-input');
  descInput.id = 'ts-desc-input';
  descLabel.htmlFor = descInput.id;
  descInput.placeholder = 'Details about your teamspace';

  const accessRow = el('div', 'ts-access-row');
  const accessIcon = el('span', 'ts-access-icon', ICONS.teamspace);
  const accessText = el(
    'span',
    'ts-access-text',
    `Everyone at ${workspace.name} and new members will have access to this teamspace`
  );
  accessRow.append(accessIcon, accessText);

  body.append(iconTile, iconCaption, nameLabel, nameInput, nameSub, descLabel, descInput, accessRow);

  // ---- footer ----
  const footer = el('div', 'ts-footer');
  const learnBtn = el('button', 'ts-learn', 'ⓘ Learn about teamspaces');
  learnBtn.type = 'button';
  learnBtn.addEventListener('click', () => ctx.toast('Coming soon'));

  const createBtn = el('button', 'ts-create', 'Create teamspace');
  createBtn.type = 'button';
  createBtn.disabled = true;
  createBtn.addEventListener('click', () => {
    if (createBtn.disabled) return;
    const icon = iconIndex === -1 ? null : { type: 'emoji', value: ICON_EMOJI_CYCLE[iconIndex] };
    ctx.store.addTeamspace({ name: name.trim(), description: description.trim(), icon });
    ctx.toast('Teamspace created');
    close();
  });

  footer.append(learnBtn, createBtn);

  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    createBtn.disabled = name.trim().length === 0;
    renderIconTile();
  });

  descInput.addEventListener('input', () => {
    description = descInput.value;
  });

  box.append(banner, body, footer);
}
