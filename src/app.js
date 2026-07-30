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
      if (mode === 'developer') ctx.closeDevPage();
      else ctx.closePage();
    },

    // ---- Mode switch ----
    setMode(m) {
      const next = m === 'developer' ? 'developer' : 'knowledge';
      // Can't enter developer mode without an available canopy session — send the user
      // through GitHub sign-in instead (returns to the app with the developer side on).
      if (next === 'developer' && !store.isDevAvailable()) {
        try { window.location.href = '/auth/login?return=/'; } catch { /* nav blocked */ }
        return;
      }
      if (next === mode) return;
      mode = next;
      store.setMode(next);
      remountMode();
    },
    refreshDev() { if (mode === 'developer') remountMode(); },

    // ---- Developer hub dimension (which /r/:owner/:repo the sphere reads) ----
    devHub: () => store.getDevHub(),
    devHubs: () => devHubs,
    setDevHub(repo) {
      if (repo === store.getDevHub()) return;
      store.setDevHub(repo);
      if (mode === 'developer') remountMode();
    },

    openSearch: () => openSearch(ctx),
    openSettings: (panel) => openSettings(ctx, panel),
    openUpdates: (anchor) => openUpdates(anchor, ctx),
    openTemplates: () => openTemplates(ctx),
    openImport: () => openImport(ctx),
    openTeamspace: () => openTeamspace(ctx),
    openTrash: (anchor) => openTrash(anchor, ctx),
    openShare: (anchor, pageId) => openShare(anchor, pageId ?? currentId, ctx),
    toggleComments: (pageId) => comments.toggle(pageId ?? currentId),

    async logOut() {
      auth.logOut();
      if (globe) globe.dispose();
      // Local state alone is not the credential. The canopy session lives in an httpOnly
      // cookie that JS cannot touch, so it must be revoked server-side — and BEFORE the
      // hand-back, because boot() consults GET /auth/me first: a cookie that outlives the
      // sign-out re-derives a session on the very next reload and drops the user straight
      // back into the app they just left. Neither call throws, so awaiting both is safe.
      await Promise.all([supabaseSignOut(), canopyLogout()]);
      if (typeof onLogOut === 'function') onLogOut();
      else location.reload();
    },

    toast,
  };

  // Shared chrome (both modes).
  topbar = mountTopbar(topbarEl, ctx);
  editor = mountEditor(pageEl, ctx);
  comments = mountComments(commentsEl, ctx);
  topbar.setPage(null);

  // ---- Mode mounting ----
  function teardownMode() {
    currentId = null;
    if (globe) { globe.dispose(); globe = null; }
    pageEl.classList.remove('show');
    pageEl.setAttribute('aria-hidden', 'true');
    sidebarEl.innerHTML = '';
    globeEl.innerHTML = '';
  }

  function mountKnowledge() {
    sidebar = mountSidebar(sidebarEl, ctx);
    globe = initGraph(globeEl, {
      onOpenPage(pageId) { ctx.openPage(pageId); },
      onHubFocus() {},
    });
    topbar.setPage(null);
    const deepId = location.hash.slice(1);
    if (deepId && store.getPage(deepId)) ctx.openPage(deepId);
