// The Share popover and the Comments side panel (Task 11). Both persist their
// state through the store's prefs (invites:<id>, shareWeb:<id>, comments:<id>).
// No top-level DOM access; this module never imports another surface module —
// the caller's `ctx` carries the cross-surface bits (auth session, toast).

import { ICONS } from './icons.js';
import { ART } from './illustrations.js';
import { el, openPopover } from './popover.js';
import { getPrefs, setPref, getPage } from '../data/store.js';

// ---------- shared helpers ----------

function relativeTime(ts) {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function slug(title) {
  const s = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

function publicUrl(page) {
  return `https://mnemosphere.site/${slug(page.title)}-${String(page.id).slice(0, 8)}`;
}

function iconHtml(icon) {
  if (!icon) return ICONS.page;
  if (icon.type === 'emoji') return `<span class="shr-emoji">${icon.value}</span>`;
  if (icon.type === 'icon') return ICONS[icon.value] || ICONS.page;
  if (icon.type === 'image') return `<img class="shr-img" src="${icon.value}" alt="">`;
  return ICONS.page;
}

function copyText(text, ctx) {
  try {
    globalThis.navigator?.clipboard?.writeText?.(text);
  } catch {
    /* clipboard denied / unavailable */
  }
  ctx.toast('Copied');
}

// A labelled pill switch row (used for the web options). Returns the row; the
// switch element carries `.is-on` when active.
function optionRow(label, on, onToggle) {
  const row = el('div', 'shr-row shr-opt');
  row.appendChild(el('span', 'shr-row-title', label));
  const sw = el('span', 'shr-switch' + (on ? ' is-on' : ''));
  row.appendChild(sw);
  row.addEventListener('click', () => onToggle(!sw.classList.contains('is-on')));
  return row;
}

// ---------- share popover ----------

function getShareWeb(pageId) {
  const saved = getPrefs()['shareWeb:' + pageId];
  return { on: false, editing: true, comments: true, duplicate: true, indexing: false, ...(saved || {}) };
}

function getInvites(pageId) {
  const saved = getPrefs()['invites:' + pageId];
  return Array.isArray(saved) ? saved : [];
}

export function openShare(anchor, pageId, ctx) {
  const page = getPage(pageId);
  if (!page) return () => {};

  return openPopover(anchor, {
    className: 'shr-pop',
    placement: 'bottom-end',
    build: (root) => {
      function render() {
        root.innerHTML = '';
        const web = getShareWeb(pageId);

        // header: active "Share" tab + page chip
        const head = el('div', 'shr-head');
        head.appendChild(el('span', 'shr-tab is-active', 'Share'));
        const chip = el('span', 'shr-chip');
        chip.appendChild(el('span', 'shr-chip-icon', iconHtml(page.icon)));
        chip.appendChild(el('span', 'shr-chip-title', escapeText(page.title || 'Untitled')));
        head.appendChild(chip);
        root.appendChild(head);

        // invite row
        const invite = el('div', 'shr-invite');
        const input = el('input', 'shr-input');
        input.type = 'text';
        input.placeholder = 'Add people, groups, or emails...';
        const inviteBtn = el('button', 'shr-invite-btn', 'Invite');
        invite.appendChild(input);
        invite.appendChild(inviteBtn);
        root.appendChild(invite);

        const chips = el('div', 'shr-chips');
        root.appendChild(chips);
        renderChips(chips, pageId);

        inviteBtn.addEventListener('click', () => {
          const value = input.value.trim();
          if (!value) return;
          const list = getInvites(pageId);
          list.push(value);
          setPref('invites:' + pageId, list);
          input.value = '';
          renderChips(chips, pageId);
        });

        root.appendChild(el('div', 'shr-div'));

        // "Share to web" toggle
        const toggle = el('div', 'shr-row shr-web-toggle');
        toggle.appendChild(el('span', 'shr-row-icon', ICONS.globeMark));
        const main = el('span', 'shr-row-main');
        main.appendChild(el('span', 'shr-row-title', 'Share to web'));
        main.appendChild(el('span', 'shr-row-sub', 'Publish and share link with anyone'));
        toggle.appendChild(main);
        toggle.appendChild(el('span', 'shr-switch' + (web.on ? ' is-on' : '')));
        toggle.addEventListener('click', () => {
          setShareWebPatch(pageId, { on: !web.on });
          render();
        });
        root.appendChild(toggle);

        if (web.on) root.appendChild(buildExpanded(page, pageId, web, render, ctx));

        // footer
        const foot = el('div', 'shr-foot');
        const learn = el('button', 'shr-learn', `${ICONS.question}<span>Learn about sharing</span>`);
        learn.addEventListener('click', () => ctx.toast('Coming soon'));
        const copyLink = el('button', 'shr-copy-link', `${ICONS.link}<span>Copy link</span>`);
        copyLink.addEventListener('click', () => copyText(publicUrl(page), ctx));
        foot.appendChild(learn);
        foot.appendChild(copyLink);
        root.appendChild(foot);
      }

      render();
    },
  });
}

function setShareWebPatch(pageId, patch) {
  setPref('shareWeb:' + pageId, { ...getShareWeb(pageId), ...patch });
}

function renderChips(container, pageId) {
  container.innerHTML = '';
  const list = getInvites(pageId);
  for (const who of list) {
    const chip = el('span', 'shr-invite-chip');
    chip.appendChild(el('span', 'shr-invite-avatar', (who[0] || '?').toUpperCase()));
    chip.appendChild(el('span', 'shr-invite-name', escapeText(who)));
    container.appendChild(chip);
  }
}

function buildExpanded(page, pageId, web, render, ctx) {
  const wrap = el('div', 'shr-web-expanded');

  // public URL + copy
  const urlRow = el('div', 'shr-url-row');
  const url = el('input', 'shr-url');
  url.type = 'text';
  url.readOnly = true;
  url.value = publicUrl(page);
  const copyWeb = el('button', 'shr-copy-web', 'Copy web link');
  copyWeb.addEventListener('click', () => copyText(publicUrl(page), ctx));
  urlRow.appendChild(url);
  urlRow.appendChild(copyWeb);
  wrap.appendChild(urlRow);

  // link expiry (PLUS)
  const expires = el('div', 'shr-row shr-expires');
  expires.appendChild(el('span', 'shr-row-title', 'Link expires'));
  const right = el('span', 'shr-expires-right');
  right.appendChild(el('span', 'shr-expires-val', 'Never'));
  right.appendChild(el('span', 'shr-plus', 'PLUS'));
  expires.appendChild(right);
  expires.addEventListener('click', () => ctx.toast('Coming soon'));
  wrap.appendChild(expires);

  // option switches
  wrap.appendChild(optionRow('Allow editing', web.editing, (on) => { setShareWebPatch(pageId, { editing: on }); render(); }));
  wrap.appendChild(optionRow('Allow comments', web.comments, (on) => { setShareWebPatch(pageId, { comments: on }); render(); }));
  wrap.appendChild(optionRow('Allow duplicate as template', web.duplicate, (on) => { setShareWebPatch(pageId, { duplicate: on }); render(); }));
  wrap.appendChild(optionRow('Search engine indexing', web.indexing, (on) => { setShareWebPatch(pageId, { indexing: on }); render(); }));

  wrap.appendChild(el('div', 'shr-note', 'Set a domain for your public links in Settings'));
  return wrap;
}

// ---------- comments side panel ----------

export function mountComments(container, ctx) {
  let openId = null;

  const panel = el('div', 'shr-panel shr-comments');
  container.appendChild(panel);
  container.style.display = 'none';

  function author() {
    const session = ctx?.auth?.getSession?.();
    if (session?.name) return session.name;
    const ws = ctx?.store?.getWorkspace?.();
    if (ws?.name) return ws.name;
    return 'You';
  }

  function getComments(id) {
    const saved = getPrefs()['comments:' + id];
    return Array.isArray(saved) ? saved : [];
  }

  function commentRow(c) {
    const row = el('div', 'shr-comment');
    const avatar = el('span', 'shr-avatar');
    avatar.textContent = (c.name || '?')[0].toUpperCase();
    const body = el('div', 'shr-comment-main');
    const meta = el('div', 'shr-comment-meta');
    const name = el('span', 'shr-comment-name');
    name.textContent = c.name || 'You';
    const time = el('span', 'shr-comment-time');
    time.textContent = relativeTime(c.time);
    meta.appendChild(name);
    meta.appendChild(time);
    const text = el('div', 'shr-comment-text');
    text.textContent = c.text;
    body.appendChild(meta);
    body.appendChild(text);
    row.appendChild(avatar);
    row.appendChild(body);
    return row;
  }

  function render() {
    panel.innerHTML = '';
    if (!openId) return;

    const body = el('div', 'shr-c-body');
    const list = getComments(openId);
    if (list.length === 0) {
      const empty = el('div', 'shr-empty');
      empty.appendChild(el('div', 'shr-empty-art', ART.commentsEmpty));
      empty.appendChild(el('div', 'shr-empty-title', 'No open comments yet'));
      empty.appendChild(el('div', 'shr-empty-sub', 'Open comments on this page will appear here'));
      body.appendChild(empty);
    } else {
      for (const c of list) body.appendChild(commentRow(c));
    }
    panel.appendChild(body);

    const composer = el('div', 'shr-composer');
    const avatar = el('span', 'shr-avatar');
    avatar.textContent = (author()[0] || 'Y').toUpperCase();
    const input = el('input', 'shr-c-input');
    input.type = 'text';
    input.placeholder = 'Add a comment...';
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      const arr = getComments(openId);
      arr.push({ name: author(), time: Date.now(), text });
      setPref('comments:' + openId, arr);
      input.value = '';
      render();
    });
    composer.appendChild(avatar);
    composer.appendChild(input);
    panel.appendChild(composer);
  }

  function open(id) {
    openId = id;
    container.style.display = 'block';
    render();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => panel.classList.add('shr-in'));
    } else {
      panel.classList.add('shr-in');
    }
  }

  function close() {
    openId = null;
    panel.classList.remove('shr-in');
    container.style.display = 'none';
    render();
  }

  return {
    toggle(id) {
      if (openId === id) close();
      else open(id);
    },
    close,
  };
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
