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
import { resetTheme } from './ui/theme.js';
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

  // Pause the WebGL loop while the page slide-over covers the graph (the
  // migration doc's setVisible contract — previously dead API, so the graph
  // burned battery animating pixels nobody could see). The pause waits out the
  // 600ms camera fly-to (graph.js focusNode) — freezing mid-flight looks
  // broken; resume is immediate. The timer is cancelled on close/teardown so a
  // stale pause can never freeze a graph that is visible again (or a new one).
  let pauseTimer = null;
  function pauseGraphSoon() {
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      if (globe) globe.setVisible(false);
    }, 700);
  }
  function resumeGraphNow() {
    clearTimeout(pauseTimer);
    pauseTimer = null;
    if (globe) globe.setVisible(true);
  }

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
      pauseGraphSoon();
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    },
    closePage() {
      if (currentId == null) return;
      currentId = null;
      editor.close();
      comments.close();
      topbar.setPage(null);
      sidebar.setActivePage && sidebar.setActivePage(null);
      resumeGraphNow();
      globe.clearFocus();
      history.replaceState(null, '', location.pathname + location.search);
    },

    // ---- Developer mode item viewing (read-only) ----
    openDevItem(node) {
      // A category is focused, not opened — the graph stays visible, so no pause.
      if (node.devKind === 'category') { globe.focusPage(node.id); return; }
      currentId = 'dev:' + node.id;
      mountDevPage(pageEl, node);
      globe.focusPage(node.id);
      pauseGraphSoon();
    },
    closeDevPage() {
      currentId = null;
      pageEl.classList.remove('show');
      pageEl.setAttribute('aria-hidden', 'true');
      resumeGraphNow();
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
      // First: deliver any pending debounced sync push while the Supabase
      // session is still valid, and release the store subscriptions — after
      // sign-out a push would 401 (or worse, land as another user). No-op when
      // sync never started; dynamic import keeps the module lazy like boot's.
      try {
        const { flushAndStopWorkspaceSync } = await import('./data/sync.js');
        await flushAndStopWorkspaceSync();
      } catch { /* sync module unavailable — nothing to flush */ }
      auth.logOut();
      if (globe) globe.dispose();
      // Local state alone is not the credential. The canopy session lives in an httpOnly
      // cookie that JS cannot touch, so it must be revoked server-side — and BEFORE the
      // hand-back, because boot() consults GET /auth/me first: a cookie that outlives the
      // sign-out re-derives a session on the very next reload and drops the user straight
      // back into the app they just left. Neither call throws, so awaiting both is safe.
      await Promise.all([supabaseSignOut(), canopyLogout()]);
      // The theme pref is keyed to the browser, not the account, so it outlives
      // the session: a user who had picked Dark was handed dark landing and
      // sign-in screens after signing out. Reset before the hand-back so the
      // auth screen renders light on its first paint rather than flashing.
      resetTheme();
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

  // Workspace replacement (import / eviction / cross-tab reload) with a page
  // open: the editor renders from the store only at open(), so a page left
  // open is a stale DOM whose next keystroke or checkbox click saves the OLD
  // content back over the freshly replaced tree (and sync pushes the
  // corruption to the cloud). Close it — the store is the source of truth.
  store.onStore('pages', (detail) => {
    const type = detail?.type;
    if (type !== 'import' && type !== 'clear' && type !== 'reload') return;
    if (mode === 'developer' || currentId == null) return;
    if (type === 'reload' && store.getPage(currentId)) { editor.open(currentId); return; }
    ctx.closePage();
  });

  // ---- Mode mounting ----
  function teardownMode() {
    currentId = null;
    clearTimeout(pauseTimer);
    pauseTimer = null;
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
  }

  // Guards the async hub-list fetch: only the newest mountDeveloper() may mount,
  // so a stale response can't double-mount after a remount or mode switch.
  let devMountSeq = 0;

  function mountDeveloper() {
    sidebar = null;
    // Chrome-only sidebar first: the no-hub states (picker / connect-a-repo /
    // hubs-unavailable) must never be a dead end — mode switch, Developer
    // settings, and Log out stay reachable even before a graph exists. The full
    // sidebar replaces this once the sphere mounts and its graph arrives.
    mountDevSidebarChrome(sidebarEl, ctx);
    if (!isConfigured()) { showConnectPrompt(); return; }
    // Hub-first (Phase 3): every dev read is scoped to /r/:owner/:repo, so an
    // active hub must exist before the sphere mounts. The hub list comes from
    // /me/repos; the persisted selection is re-validated against it so a hub
    // the user lost access to can't stick.
    const seq = ++devMountSeq;
    canopyApi.getMyRepos().then((res) => {
      if (seq !== devMountSeq || mode !== 'developer') return;
      devHubs = (res.ok && Array.isArray(res.data?.repos)) ? res.data.repos : [];
      const appSlug = (res.ok && res.data?.appSlug) || null;
      // Re-validate only against a SUCCESSFUL and NON-EMPTY list — canopy's
      // /me/repos degrades to 200 { repos: [] } on server-side failure (missing
      // user token, GitHub outage), so neither a failed fetch nor an empty list
      // may wipe the selection (the sphere's own reads surface any 401/404).
      if (shouldClearDevHub(res, store.getDevHub())) store.setDevHub('');
      if (store.getDevHub()) { mountDevSphere(); return; }
      mountDevHubPicker(globeEl, {
        repos: devHubs,
        appSlug,
        error: !res.ok,
        onPick: (repo) => ctx.setDevHub(repo),
        onRetry: () => ctx.refreshDev(),
      });
    });
    topbar.setPage(null);
  }

  function mountDevSphere() {
    const provider = devProvider();
    globe = initGraph(globeEl, {
      onOpenPage(id) { const node = devNodesById && devNodesById.get(id); if (node) ctx.openDevItem(node); },
      onHubFocus() {},
    }, provider);
    // Build the sidebar + node lookup from the same graph the globe uses.
    provider.getGraph().then((graph) => {
      // Flat now: every node carries its page, so hubs and items index the same
      // way (the old nested hubs/leaves walk is gone with the sphere builder).
      devNodesById = new Map();
      for (const node of graph.nodes) devNodesById.set(node.page.id, node.page);
      mountDevSidebar(sidebarEl, ctx, graph);
    });
  }

  function showConnectPrompt() {
    const state = el('div', 'dev-state');
    state.append(
      el('h2', null, 'Connect to canopy'),
      el('p', null, 'Developer mode reads a canopy instance. Add its URL and an access token to see the developer sphere.'),
    );
    const btn = el('button', null, 'Open Developer settings');
    btn.addEventListener('click', () => ctx.openSettings('developer'));
    state.appendChild(btn);
    globeEl.appendChild(state);
  }

  function remountMode() {
    teardownMode();
    if (mode === 'developer') mountDeveloper();
    else mountKnowledge();
  }

  remountMode();

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      ctx.openSearch();
      return;
    }
    if (e.key === '/' && !inEditableFocus() && !overlayOpen()) {
      e.preventDefault();
      ctx.openSearch();
      return;
    }
    if (e.key === 'Escape' && !overlayOpen() && currentId != null) {
      e.preventDefault();
      ctx.goHome();
    }
  }
  document.addEventListener('keydown', onKeydown);

  return { ctx, get sidebar() { return sidebar; }, topbar, editor, comments, get globe() { return globe; } };
}
