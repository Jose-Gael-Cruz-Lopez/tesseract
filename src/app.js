// App shell. Builds the Notion-style frame — sidebar rail, topbar, content area
// with the globe behind a slide-over page panel — mounts every surface, and
// wires them through one `ctx` object. Two modes share this shell: Knowledge
// (the page store → notes globe) and Developer (canopy → dev sphere). The mode
// is switched from the sidebar workspace menu; only the globe + sidebar + page
// behavior differ, so the topbar/editor/comments chrome is mounted once.

import { initGraph } from './graph/graph.js';
import * as store from './data/store.js';
import * as auth from './auth/auth.js';
import { supabaseSignOut } from './data/supabase.js';
import { canopyLogout } from './data/canopy-session.js';
import { toast, el } from './ui/popover.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountTopbar } from './ui/topbar.js';
import { mountEditor } from './ui/editor.js';
import { mountComments, openShare } from './ui/share.js';
import { openSearch } from './ui/search.js';
import { openUpdates } from './ui/updates.js';
import { openSettings } from './ui/settings.js';
import { openTemplates } from './ui/templates-modal.js';
import { openImport } from './ui/import-modal.js';
import { openTeamspace } from './ui/teamspace-modal.js';
import { openTrash } from './ui/trash.js';
import { isConfigured, canopyApi } from './dev/canopy-api.js';
import { devProvider } from './dev/dev-provider.js';
import { mountDevSidebar, mountDevSidebarChrome } from './dev/dev-sidebar.js';
import { mountDevPage } from './dev/dev-page.js';
import { mountDevHubPicker, shouldClearDevHub } from './dev/dev-hub.js';

const SHELL_HTML = `
  <div class="shell">
    <aside class="shell-sidebar" id="shell-sidebar"></aside>
    <main class="shell-main">
      <header class="shell-topbar" id="shell-topbar"></header>
      <div class="shell-content">
        <div class="shell-globe" id="shell-globe"></div>
        <section class="shell-page" id="shell-page" aria-hidden="true"></section>
        <aside class="shell-comments" id="shell-comments"></aside>
      </div>
    </main>
  </div>`;

function inEditableFocus() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || a.isContentEditable;
}

function overlayOpen() {
  return !!document.querySelector('.pop-root, .mod-scrim');
}

export function mountApp(root, { onLogOut } = {}) {
  root.innerHTML = SHELL_HTML;
  const sidebarEl = root.querySelector('#shell-sidebar');
  const topbarEl = root.querySelector('#shell-topbar');
  const pageEl = root.querySelector('#shell-page');
  const commentsEl = root.querySelector('#shell-comments');
  const globeEl = root.querySelector('#shell-globe');

  // Developer mode requires an available canopy session; a persisted 'developer' from a
  // prior GitHub login must not strand a Google/knowledge-only user in a broken sphere.
  let mode = store.getMode();
  if (mode === 'developer' && !store.isDevAvailable()) mode = 'knowledge';
  let currentId = null;      // knowledge: open page id
  let devNodesById = null;   // developer: leaf-node lookup for globe dot-clicks
  let devHubs = [];          // developer: connected hubs from /me/repos (for the switcher)

  let sidebar;
  let topbar;
  let editor;
  let comments;
  let globe;

  const ctx = {
    store,
    auth,
    mode: () => mode,
    devAvailable: () => store.isDevAvailable(),
    currentPageId: () => currentId,

    // ---- Knowledge mode page routing ----
    openPage(id) {
      const page = store.getPage(id);
      if (!page || page.deleted) return;
      currentId = id;
      editor.open(id);
      topbar.setPage(page);
      sidebar.setActivePage && sidebar.setActivePage(id);
      globe.focusPage(id);
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    },
    closePage() {
      if (currentId == null) return;
      currentId = null;
      editor.close();
      comments.close();
      topbar.setPage(null);
      sidebar.setActivePage && sidebar.setActivePage(null);
      globe.clearFocus();
      history.replaceState(null, '', location.pathname + location.search);
    },

    // ---- Developer mode item viewing (read-only) ----
    openDevItem(node) {
      if (node.devKind === 'category') { globe.focusPage(node.id); return; }
      currentId = 'dev:' + node.id;
      mountDevPage(pageEl, node);
      globe.focusPage(node.id);
    },
    closeDevPage() {
      currentId = null;
      pageEl.classList.remove('show');
      pageEl.setAttribute('aria-hidden', 'true');
      globe.clearFocus();
    },

    goHome() {
