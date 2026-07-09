// Settings modal: a two-pane (left nav / right panel) modal built on top of
// src/ui/popover.js's openModal. Per shared-context.md, surface modules may
// import only icons.js, illustrations.js, popover.js, theme.js, and data
// modules (never each other) — so account-panel session reads/writes go
// through `ctx.auth` (the auth module namespace handed in on `ctx`), never a
// direct import of src/auth/auth.js. No top-level DOM access: every DOM
// touch happens inside openSettings() or the helpers it calls.

import { getPrefs, setPref } from '../data/store.js';
import { setTheme, getTheme } from './theme.js';
import { openModal, openPopover, el } from './popover.js';
import { ICONS } from './icons.js';

// ---------- nav model ----------

const PERSONAL_NAV = [
  { id: 'account', label: 'My account', icon: '👤' },
  { id: 'notifications', label: 'My notifications & settings', icon: '🔔' },
  { id: 'developer', label: 'Developer', icon: '🧑‍💻' },
  { id: 'myConnections', label: 'My connections', icon: '⤴' },
  { id: 'language', label: 'Language & region', icon: '🌐' },
];

const WORKSPACE_NAV = [
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'members', label: 'Members', icon: '👥' },
  { id: 'upgrade', label: 'Upgrade', icon: '↗' },
  { id: 'billing', label: 'Billing', icon: '💳' },
  { id: 'security', label: 'Security', icon: '🛡' },
  { id: 'identity', label: 'Identity & provisioning', icon: '🪪' },
  { id: 'connections', label: 'Connections', icon: '⤵' },
];

const ALL_NAV = [...PERSONAL_NAV, ...WORKSPACE_NAV];

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Use system' },
];

const START_PAGE_OPTIONS = [
  { value: 'last', label: 'Last visited page' },
  { value: 'home', label: 'Home' },
];

const VIEW_HISTORY_OPTIONS = [
  { value: 'record', label: 'Record' },
  { value: 'off', label: 'Off' },
];

function labelForId(id) {
  return ALL_NAV.find((item) => item.id === id)?.label || '';
}

function labelFor(options, value) {
  return (options.find((o) => o.value === value) || options[0]).label;
}

// ---------- small building blocks ----------

function switchEl(initialOn, onToggle) {
  const btn = el('button', `set-switch${initialOn ? ' is-on' : ''}`);
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(initialOn));
  let on = initialOn;
  btn.addEventListener('click', () => {
    on = !on;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', String(on));
    onToggle(on);
  });
  return btn;
}

function rowText(title, subHtml) {
  return el('div', 'set-row-text',
    `<div class="set-row-title">${title}</div><div class="set-row-sub">${subHtml}</div>`);
}

function toggleRow(title, sub, initialOn, onToggle) {
  const row = el('div', 'set-row');
  row.appendChild(rowText(title, sub));
  row.appendChild(switchEl(initialOn, onToggle));
  return row;
}

// Anchored option menu (Light/Dark/Use system, etc). Reuses popover.js so
// positioning/outside-click/Escape all come for free.
function openOptionMenu(anchor, options, currentValue, onPick) {
  return openPopover(anchor, {
    className: 'set-dd-menu',
    build(root, close) {
      for (const opt of options) {
        const item = el('button', `set-dd-item${opt.value === currentValue ? ' is-selected' : ''}`, opt.label);
        item.type = 'button';
        item.addEventListener('click', () => {
          onPick(opt.value);
          close();
        });
        root.appendChild(item);
      }
    },
  });
}

function dropdownButton(extraClass, initialLabel, onOpen) {
  const btn = el('button', `set-dd-btn ${extraClass}`,
    `<span class="set-dd-label">${initialLabel}</span><span class="set-dd-chevron">${ICONS.chevron}</span>`);
  btn.type = 'button';
  btn.addEventListener('click', () => onOpen(btn));
  return btn;
}

function dropdownRow(title, sub, extraClass, options, currentValue, onPick) {
  const row = el('div', 'set-row');
  row.appendChild(rowText(title, sub));
  let value = currentValue;
  const btn = dropdownButton(extraClass, labelFor(options, value), (anchor) => {
    openOptionMenu(anchor, options, value, (picked) => {
      value = picked;
      btn.querySelector('.set-dd-label').textContent = labelFor(options, picked);
      onPick(picked);
    });
  });
  row.appendChild(btn);
  return row;
}

function linkRow(title, sub, linkText, ctx) {
  const row = el('div', 'set-row');
  row.appendChild(rowText(title, sub));
  const link = el('a', 'set-link', linkText);
  link.href = '#';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    ctx.toast('Coming soon');
  });
  row.appendChild(link);
  return row;
}

// ---------- panels ----------

function renderNotificationsPanel(ctx) {
  const prefs = getPrefs();
  const panel = el('div', 'set-panel-inner');

  panel.appendChild(el('h2', 'set-h', 'My notifications'));
  panel.appendChild(toggleRow(
    'Mobile push notifications',
    'Receive push notifications on mentions and comments via your mobile app',
    prefs.notifPush !== undefined ? prefs.notifPush : true,
    (on) => setPref('notifPush', on),
  ));
  panel.appendChild(toggleRow(
    'Email notifications',
    'Receive email updates, including mentions and comment replies',
    prefs.notifEmail !== undefined ? prefs.notifEmail : true,
    (on) => setPref('notifEmail', on),
  ));
  panel.appendChild(toggleRow(
    'Always send email notifications',
    "Receive emails about activity in your workspace, even when you're active on the app",
    prefs.notifAlways !== undefined ? prefs.notifAlways : false,
    (on) => setPref('notifAlways', on),
  ));

  panel.appendChild(el('h2', 'set-h', 'My settings'));
  panel.appendChild(dropdownRow(
    'Appearance',
    'Customize how Mnemosphere looks on your device',
    'set-dd-appearance',
    THEME_OPTIONS,
    getTheme(),
    (mode) => setTheme(mode),
  ));
  panel.appendChild(dropdownRow(
    'Open on start',
    'Choose what to show when Mnemosphere starts or when you switch workspaces',
    'set-dd-startpage',
    START_PAGE_OPTIONS,
    prefs.startPage !== undefined ? prefs.startPage : 'last',
    (v) => setPref('startPage', v),
  ));
  panel.appendChild(toggleRow(
    'Open links in desktop app',
    'You must have the Mac or Windows app installed',
    prefs.openDesktop !== undefined ? prefs.openDesktop : false,
    (on) => setPref('openDesktop', on),
  ));

  panel.appendChild(el('h2', 'set-h', 'Privacy'));
  panel.appendChild(linkRow(
    'Cookie settings',
    'See Cookie Notice for details',
    'Customize ›',
    ctx,
  ));
  const historyRow = dropdownRow(
    'Show my view history',
    "People with edit or full access will be able to see when you've viewed a page. ",
    'set-dd-viewhistory',
    VIEW_HISTORY_OPTIONS,
    prefs.viewHistory !== undefined ? prefs.viewHistory : 'record',
    (v) => setPref('viewHistory', v),
  );
  const learnMore = el('a', 'set-link', 'Learn more');
  learnMore.href = '#';
  learnMore.addEventListener('click', (e) => {
    e.preventDefault();
    ctx.toast('Coming soon');
  });
  historyRow.querySelector('.set-row-sub').appendChild(learnMore);
  panel.appendChild(historyRow);

  return panel;
}

function renderAccountPanel(ctx) {
  const session = ctx.auth.getSession() || {};
  const panel = el('div', 'set-panel-inner');
  panel.appendChild(el('h2', 'set-h', 'My account'));

  const avatarRow = el('div', 'set-avatar-row');
  const avatarWrap = el('div', 'set-avatar');
  if (session.avatar) {
    avatarWrap.innerHTML = `<img src="${session.avatar}" alt="" />`;
  } else {
    avatarWrap.textContent = (session.name || session.email || '?').trim().charAt(0).toUpperCase() || '?';
  }
  avatarRow.appendChild(avatarWrap);

  const uploadBtn = el('button', 'set-upload-btn', 'Upload photo');
  uploadBtn.type = 'button';

  const fileInput = el('input', 'set-avatar-input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || typeof FileReader === 'undefined') return;
    const reader = new FileReader();
    reader.onload = () => {
      ctx.auth.updateSession({ avatar: reader.result });
      avatarWrap.innerHTML = `<img src="${reader.result}" alt="" />`;
    };
    reader.readAsDataURL(file);
  });
  uploadBtn.addEventListener('click', () => fileInput.click());

  avatarRow.appendChild(uploadBtn);
  avatarRow.appendChild(fileInput);
  panel.appendChild(avatarRow);

  const nameRow = el('div', 'set-field-row');
  nameRow.appendChild(el('label', 'set-field-label', 'Preferred name'));
  const nameInput = el('input', 'set-field-input');
  nameInput.type = 'text';
  nameInput.value = session.name || '';
  // Workspace name (e.g. "Ada's Mnemosphere") is untouched — only the
  // session's display name changes here.
  nameInput.addEventListener('change', () => {
    ctx.auth.updateSession({ name: nameInput.value });
  });
  nameRow.appendChild(nameInput);
  panel.appendChild(nameRow);

  panel.appendChild(el('h2', 'set-h', 'Password'));
  const pwRow = el('div', 'set-row');
  pwRow.appendChild(rowText('Password', 'Change the password used to log in to Mnemosphere'));
  const pwBtn = el('button', 'set-btn', 'Change password');
  pwBtn.type = 'button';
  pwBtn.addEventListener('click', () => ctx.toast('Coming soon'));
  pwRow.appendChild(pwBtn);
  panel.appendChild(pwRow);

  return panel;
}

function renderStubPanel(label) {
  const panel = el('div', 'set-panel-inner');
  panel.appendChild(el('h2', 'set-h', label));
  panel.appendChild(el('div', 'set-row set-row-stub', 'These settings are coming soon.'));
  return panel;
}

function devField(label, input) {
  const wrap = el('div', 'set-field');
  wrap.appendChild(el('label', 'set-field-label', label));
  wrap.appendChild(input);
  return wrap;
}

function renderDeveloperPanel(ctx) {
  const panel = el('div', 'set-panel-inner');
  panel.appendChild(el('h2', 'set-h', 'Developer'));
  panel.appendChild(el('div', 'set-row-sub', 'Connect the developer sphere to a canopy instance (read-only). Mint a token at /admin on your canopy; see canopy/SETUP.md.'));

  const cfg = ctx.store.getDevConfig();
  const urlInput = el('input', 'set-input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://canopy.you.workers.dev';
  urlInput.value = cfg.url;
  const urlHint = el('div', 'set-field-hint', 'Leave blank when this app is served by canopy itself (one fused deploy) — reads use the current site.');
  const tokenInput = el('input', 'set-input');
  tokenInput.type = 'password';
  tokenInput.placeholder = 'canopy_mcp_…';
  tokenInput.value = cfg.token;

  const persist = () => ctx.store.setDevConfig({ url: urlInput.value.trim(), token: tokenInput.value.trim() });
  urlInput.addEventListener('change', persist);
  tokenInput.addEventListener('change', persist);

  const status = el('div', 'set-dev-status');
  const test = el('button', 'set-dev-test', 'Test connection');
  test.type = 'button';
  test.addEventListener('click', async () => {
    persist();
    status.textContent = 'Testing…';
    const { makeCanopyApi } = await import('../dev/canopy-api.js');
    const res = await makeCanopyApi().getMe();
    status.textContent = res.ok
      ? `Connected as ${res.data.login || 'user'}.`
      : res.status === 401
        ? 'Unauthorized — check the token.'
        : 'Could not reach canopy — check the URL and that CORS_ORIGINS allows this app.';
  });

  panel.append(devField('Canopy URL', urlInput), urlHint, devField('Access token', tokenInput), test, status);
  return panel;
}

function renderPanel(id, ctx) {
  if (id === 'account') return renderAccountPanel(ctx);
  if (id === 'notifications') return renderNotificationsPanel(ctx);
  if (id === 'developer') return renderDeveloperPanel(ctx);
  return renderStubPanel(labelForId(id));
}

// ---------- nav ----------

function navRow(item, activeId, onSelect) {
  const row = el('button', `set-nav-row${item.id === activeId ? ' is-active' : ''}`,
    `<span class="set-nav-icon">${item.icon}</span><span class="set-nav-label">${item.label}</span>`);
  row.type = 'button';
  row.dataset.panel = item.id;
  row.addEventListener('click', () => onSelect(item.id));
  return row;
}

function buildNav(activeId, onSelect, email) {
  const nav = el('nav', 'set-nav');
  nav.appendChild(el('div', 'set-nav-header', email || ''));
  for (const item of PERSONAL_NAV) nav.appendChild(navRow(item, activeId, onSelect));
  nav.appendChild(el('div', 'set-nav-section', 'Workspace'));
  for (const item of WORKSPACE_NAV) nav.appendChild(navRow(item, activeId, onSelect));
  return nav;
}

// ---------- entry point ----------

export function openSettings(ctx, panel = 'notifications') {
  return openModal({
    className: 'set-modal',
    build(box, close) {
      const closeBtn = el('button', 'set-close', ICONS.close);
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.addEventListener('click', () => close());
      box.appendChild(closeBtn);

      let email = '';
      try {
        email = ctx.auth?.getSession?.()?.email || '';
      } catch {
        email = '';
      }

      const panelHost = el('div', 'set-panel');

      function select(id) {
        panelHost.innerHTML = '';
        panelHost.appendChild(renderPanel(id, ctx));
        box.querySelectorAll('.set-nav-row').forEach((row) => {
          row.classList.toggle('is-active', row.dataset.panel === id);
        });
      }

      const nav = buildNav(panel, select, email);
      box.appendChild(nav);
      box.appendChild(panelHost);
      panelHost.appendChild(renderPanel(panel, ctx));
    },
  });
}
