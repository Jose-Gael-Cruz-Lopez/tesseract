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

/**
 * Re-read workspace/pages/prefs from localStorage into memory and notify every
 * surface. Used by sync's cross-tab listener: another tab's write lands in
 * localStorage (the storage event fires only in OTHER tabs), and without this
 * reload this tab's next whole-blob persist or push would clobber it.
 */
export function reloadFromStorage() {
  const ws = readLS(KEYS.workspace);
  const pages = readLS(KEYS.pages);
  const prefs = readLS(KEYS.prefs);
  _workspace = ws && typeof ws === 'object' ? ws : null;
  _pages = Array.isArray(pages) ? pages : [];
  _prefs = prefs && typeof prefs === 'object' ? prefs : {};
  emit('workspace');
  emit('pages', { type: 'reload' });
}

/**
 * Drop the workspace + pages (content only — prefs and listeners survive).
 * Used by sync when the local tree belongs to a DIFFERENT signed-in account
 * than the current one: that content lives in its owner's cloud row, and
 * keeping it here would leak it into the new account's workspace.
 */
export function clearWorkspaceContent() {
  _workspace = null;
  _pages = [];
  removeLS(KEYS.workspace);
  removeLS(KEYS.pages);
  emit('workspace');
  emit('pages', { type: 'clear' });
}

// ---------- export / import ----------

const EXPORT_FORMAT = 'mnemosphere-workspace';
const EXPORT_VERSION = 1;

/**
 * A portable snapshot of the workspace + every page (including trashed ones,
 * so a restore is lossless). Prefs are deliberately EXCLUDED: they are
 * device-local settings and carry the canopy dev token — a credential that
 * must never land in a shareable file or a sync payload.
 */
export function exportWorkspace() {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: structuredClone(_workspace),
    pages: structuredClone(_pages),
  };
}

/**
 * Replace the current workspace + pages with a snapshot from exportWorkspace().
 * Validates before touching anything — a rejected import leaves the store
 * byte-for-byte as it was. Prefs are untouched (content, not device settings).
 * Throws Error with a user-facing message on invalid input.
 */
export function importWorkspace(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a Mnemosphere export');
  if (data.format !== EXPORT_FORMAT) throw new Error('Not a Mnemosphere export');
  if (data.version !== EXPORT_VERSION) throw new Error(`Unsupported export version: ${data.version}`);
  if (!data.workspace || typeof data.workspace !== 'object') throw new Error('Export has no workspace');
  if (!Array.isArray(data.pages)) throw new Error('Export has no pages');
  for (const p of data.pages) {
    if (!p || typeof p !== 'object' || !p.id) throw new Error('Export contains an invalid page');
  }
  _workspace = structuredClone(data.workspace);
  _pages = structuredClone(data.pages);
  persistWorkspace();
  persistPages();
  emit('workspace');
  emit('pages', { type: 'import' });
  return _workspace;
}

// ---------- workspace ----------

export function getWorkspace() {
  return _workspace;
}

export function updateWorkspace(patch) {
  if (!_workspace) _workspace = defaultWorkspace();
  // `edited` feeds the sync last-write-wins comparison (src/data/sync.js) —
  // without it a rename-only change would look older than any remote row.
  Object.assign(_workspace, patch, { edited: Date.now() });
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

// delete/restore/favorite/destroy all stamp the LWW clock: sync's last-write-
// wins compares remote updated_at against the newest local `edited`, so a
// mutation that doesn't advance a clock is silently undone by any remote row
// written after the last stamped edit.
export function deletePage(id) {
  const page = getPage(id);
  if (!page) return null;
  const now = Date.now();
  for (const p of [page, ...descendantsOf(id)]) { p.deleted = true; p.edited = now; }
  persistPages();
  emit('pages', { type: 'delete', page });
  return page;
}

export function restorePage(id) {
  const page = getPage(id);
  if (!page) return null;
  const now = Date.now();
  for (const p of [page, ...descendantsOf(id)]) { p.deleted = false; p.edited = now; }
  persistPages();
  emit('pages', { type: 'restore', page });
  return page;
}

export function destroyPage(id) {
  const page = getPage(id);
  if (!page) return null;
  const doomed = new Set([id, ...descendantsOf(id).map((p) => p.id)]);
  _pages = _pages.filter((p) => !doomed.has(p.id));
  // The destroyed pages can't carry the clock — advance the workspace's own.
  if (_workspace) { _workspace.edited = Date.now(); persistWorkspace(); }
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
  page.edited = Date.now();
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

// Developer-mode active hub ("owner/name" from canopy's /me/repos). Every dev read is
// scoped to /r/:owner/:repo, so this is the sphere's tenant dimension. Persisted so a
// returning developer lands back in the same hub; '' means none selected (hub picker).
export function getDevHub() {
  return _prefs['dev.canopyHub'] || '';
}
export function setDevHub(repo) {
  return setPref('dev.canopyHub', repo || '');
}
