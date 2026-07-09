// The page-tree store. A single in-memory source of truth (workspace, pages,
// prefs) mirrored to localStorage inside try/catch so the app keeps working in
// private-mode / storage-denied browsers. No top-level DOM or storage access —
// every read/write happens inside an exported function so the module import-smokes.

import { buildSeed } from './seed.js';

const KEYS = { workspace: 'ms:workspace', pages: 'ms:pages', prefs: 'ms:prefs' };

let _pages = [];
let _workspace = null;
let _prefs = {};
// Runtime-only (never persisted): true when a canopy GitHub session is detected at
// boot, meaning this user may use the developer side. Availability is per-session and
// must not survive a logout, so it lives in memory, not localStorage.
let _devAvailable = false;

const _listeners = { pages: new Set(), workspace: new Set(), prefs: new Set() };

// ---------- storage (guarded) ----------

function readLS(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLS(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / denied / unavailable — memory stays authoritative */
  }
}

function removeLS(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

const persistPages = () => writeLS(KEYS.pages, _pages);
const persistWorkspace = () => writeLS(KEYS.workspace, _workspace);
const persistPrefs = () => writeLS(KEYS.prefs, _prefs);

// ---------- events ----------

function emit(event, detail) {
  for (const cb of [..._listeners[event]]) {
    try {
      cb(detail);
    } catch {
      /* a faulty subscriber must not break a mutation */
    }
  }
}

export function onStore(event, cb) {
  _listeners[event]?.add(cb);
}

export function offStore(event, cb) {
  _listeners[event]?.delete(cb);
}

// ---------- helpers ----------

function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultWorkspace() {
  return { name: 'My Mnemosphere', ownerEmail: '', teamspaces: [] };
}

// Every page created by the store starts from this shape so downstream code can
// rely on every field being present.
function pageDefaults() {
  const now = Date.now();
  return {
    id: uuid(),
    title: '',
    icon: null,
    cover: null,
    coverPos: 50,
    blocks: '',
    parentId: null,
    created: now,
    edited: now,
    favorite: false,
    deleted: false,
    locked: false,
    font: 'default',
    smallText: false,
    fullWidth: false,
    teamspaceId: null,
  };
}

// All descendants of `id` (deep), including deleted ones, parents before
// children (breadth-first) so callers can rely on that order.
function descendantsOf(id) {
  const out = [];
  const queue = _pages.filter((p) => p.parentId === id);
  while (queue.length) {
    const p = queue.shift();
    out.push(p);
    for (const c of _pages) if (c.parentId === p.id) queue.push(c);
  }
  return out;
}

function bodyText(blocks) {
  if (!blocks) return '';
  if (typeof blocks === 'string') {
    return blocks.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (blocks.type === 'database') {
    const parts = [];
    for (const col of blocks.columns || []) {
      parts.push(col.name);
      for (const opt of col.options || []) parts.push(opt.label);
    }
    for (const row of blocks.rows || []) {
      for (const v of Object.values(row.cells || {})) {
        if (typeof v === 'string') parts.push(v);
      }
    }
    for (const view of blocks.views || []) parts.push(view.name);
    return parts.join(' ');
  }
  return '';
}

function makeSnippet(text, idx, len) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + len + 30);
  let snip = text.slice(start, end).trim();
  if (start > 0) snip = '…' + snip;
  if (end < text.length) snip = snip + '…';
  return snip;
}

// ---------- lifecycle ----------

export function initStore() {
  const ws = readLS(KEYS.workspace);
  const pages = readLS(KEYS.pages);
  const prefs = readLS(KEYS.prefs);
  _workspace = ws && typeof ws === 'object' ? ws : null;
  _pages = Array.isArray(pages) ? pages : [];
  _prefs = prefs && typeof prefs === 'object' ? prefs : {};
  return _workspace;
}

export function seedWorkspace(profile = {}) {
  const { name = 'Me', email = '' } = profile;
  _workspace = { name: `${name}'s Mnemosphere`, ownerEmail: email, teamspaces: [] };
  _pages = [];
  for (const entry of buildSeed()) createFromSeed(entry, null);
  persistWorkspace();
  persistPages();
  emit('workspace');
  return _workspace;
}

function createFromSeed(entry, parentId) {
  const { children = [], ...partial } = entry;
  const page = createPage({ ...partial, parentId });
  for (const child of children) createFromSeed(child, page.id);
  return page;
}

// test helper — clears memory, storage, and subscribers for a clean slate
export function resetStore() {
  _pages = [];
  _workspace = null;
  _prefs = {};
  _devAvailable = false;
  _listeners.pages.clear();
  _listeners.workspace.clear();
  _listeners.prefs.clear();
  removeLS(KEYS.workspace);
  removeLS(KEYS.pages);
  removeLS(KEYS.prefs);
}

// ---------- workspace ----------

export function getWorkspace() {
  return _workspace;
}

export function updateWorkspace(patch) {
  if (!_workspace) _workspace = defaultWorkspace();
  Object.assign(_workspace, patch);
  persistWorkspace();
  emit('workspace');
  return _workspace;
}

export function addTeamspace({ name, description = '', icon = null } = {}) {
  if (!_workspace) _workspace = defaultWorkspace();
  const teamspace = { id: uuid(), name, description, icon };
  _workspace.teamspaces.push(teamspace);
  persistWorkspace();
  emit('workspace');
  return teamspace;
}

// ---------- pages ----------

export function getPages() {
  return [..._pages];
}

export function getPage(id) {
  return _pages.find((p) => p.id === id);
}

export function childrenOf(parentId) {
  return _pages.filter((p) => p.parentId === parentId && !p.deleted);
}

export function topLevelPages() {
  return childrenOf(null);
}

export function createPage(partial = {}) {
  const page = { ...pageDefaults(), ...partial };
  _pages.push(page);
  persistPages();
  emit('pages', { type: 'create', page });
  return page;
}

export function updatePage(id, patch = {}) {
  const page = getPage(id);
  if (!page) return null;
  Object.assign(page, patch, { edited: Date.now() });
  persistPages();
  emit('pages', { type: 'update', page });
  return page;
}

export function deletePage(id) {
  const page = getPage(id);
  if (!page) return null;
  for (const p of [page, ...descendantsOf(id)]) p.deleted = true;
  persistPages();
  emit('pages', { type: 'delete', page });
  return page;
}

export function restorePage(id) {
  const page = getPage(id);
  if (!page) return null;
  for (const p of [page, ...descendantsOf(id)]) p.deleted = false;
  persistPages();
  emit('pages', { type: 'restore', page });
  return page;
}

export function destroyPage(id) {
  const page = getPage(id);
  if (!page) return null;
  const doomed = new Set([id, ...descendantsOf(id).map((p) => p.id)]);
  _pages = _pages.filter((p) => !doomed.has(p.id));
  persistPages();
  emit('pages', { type: 'destroy', page });
  return page;
}

// Deleted pages whose parent is missing or still alive — i.e. the roots of each
// deleted subtree. Cascaded children stay bundled under their root.
export function trashedPages() {
  return _pages.filter((p) => {
    if (!p.deleted) return false;
    if (p.parentId == null) return true;
    const parent = getPage(p.parentId);
    return !parent || !parent.deleted;
  });
}

export function duplicatePage(id) {
  const original = getPage(id);
  if (!original) return null;
  const subtree = [original, ...descendantsOf(id).filter((p) => !p.deleted)];
  const idMap = new Map();
  const now = Date.now();
  let rootCopy = null;
  for (const src of subtree) {
    const isRoot = src.id === id;
    const copy = {
      ...structuredClone(src),
      id: uuid(),
      created: now,
      edited: now,
      deleted: false,
      favorite: false,
      title: isRoot ? `${src.title} (1)` : src.title,
      parentId: isRoot ? src.parentId : idMap.get(src.parentId),
    };
    idMap.set(src.id, copy.id);
    _pages.push(copy);
    emit('pages', { type: 'create', page: copy });
    if (isRoot) rootCopy = copy;
  }
  persistPages();
  return rootCopy;
}

export function toggleFavorite(id) {
  const page = getPage(id);
  if (!page) return null;
  page.favorite = !page.favorite;
  persistPages();
  emit('pages', { type: 'update', page });
  return page;
}

export function favorites() {
  return _pages.filter((p) => p.favorite && !p.deleted);
}

export function searchPages(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const titleMatches = [];
  const bodyMatches = [];
  for (const p of _pages) {
    if (p.deleted) continue;
    const title = p.title || 'Untitled';
    if (title.toLowerCase().includes(q)) {
      titleMatches.push({ page: p, snippet: title });
      continue;
    }
    const text = bodyText(p.blocks);
    const idx = text.toLowerCase().indexOf(q);
    if (idx !== -1) {
      bodyMatches.push({ page: p, snippet: makeSnippet(text, idx, q.length) });
    }
  }
  return [...titleMatches, ...bodyMatches];
}

// ---------- prefs ----------

export function getPrefs() {
  return { ..._prefs };
}

export function setPref(key, value) {
  _prefs[key] = value;
  persistPrefs();
  emit('prefs', { key, value });
  return value;
}

// App mode: the knowledge globe (default) vs the developer sphere (canopy).
export function getMode() {
  return _prefs.mode === 'developer' ? 'developer' : 'knowledge';
}
export function setMode(mode) {
  return setPref('mode', mode === 'developer' ? 'developer' : 'knowledge');
}

// Whether the developer side is available to this user (a canopy GitHub session was
// detected at boot). Runtime-only; see _devAvailable.
export function isDevAvailable() {
  return _devAvailable;
}
export function setDevAvailable(available) {
  _devAvailable = !!available;
  return _devAvailable;
}

// Developer-mode connection to a canopy instance (URL + read token).
export function getDevConfig() {
  return { url: _prefs['dev.canopyUrl'] || '', token: _prefs['dev.canopyToken'] || '' };
}
export function setDevConfig({ url, token } = {}) {
  if (url !== undefined) setPref('dev.canopyUrl', url);
  if (token !== undefined) setPref('dev.canopyToken', token);
  return getDevConfig();
}
