// App shell. Builds the Notion-style frame — sidebar rail, topbar, content area
// with the globe behind a slide-over page panel — mounts every surface, and
// wires them through one `ctx` object. Two modes share this shell: Knowledge
// (the page store → notes globe) and Developer (canopy → dev sphere). The mode
// is switched from the sidebar workspace menu; only the globe + sidebar + page
// behavior differ, so the topbar/editor/comments chrome is mounted once.

import { initGlobe } from './globe/globe.js';
import * as store from './data/store.js';
import * as auth from './auth/auth.js';
import { supabaseSignOut } from './data/supabase.js';
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
import { isConfigured } from './dev/canopy-api.js';
import { devProvider } from './dev/dev-provider.js';
import { mountDevSidebar } from './dev/dev-sidebar.js';
import { mountDevPage } from './dev/dev-page.js';

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

  let mode = store.getMode();
  let currentId = null;      // knowledge: open page id
  let devNodesById = null;   // developer: leaf-node lookup for globe dot-clicks

  let sidebar;
  let topbar;
  let editor;
  let comments;
  let globe;

  const ctx = {
    store,
    auth,
    mode: () => mode,
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
      if (next === mode) return;
      mode = next;
      store.setMode(next);
      remountMode();
    },
    refreshDev() { if (mode === 'developer') mountDeveloper(); },

    openSearch: () => openSearch(ctx),
    openSettings: (panel) => openSettings(ctx, panel),
    openUpdates: (anchor) => openUpdates(anchor, ctx),
    openTemplates: () => openTemplates(ctx),
    openImport: () => openImport(ctx),
    openTeamspace: () => openTeamspace(ctx),
    openTrash: (anchor) => openTrash(anchor, ctx),
    openShare: (anchor, pageId) => openShare(anchor, pageId ?? currentId, ctx),
    toggleComments: (pageId) => comments.toggle(pageId ?? currentId),

    logOut() {
      auth.logOut();
      supabaseSignOut();
      if (globe) globe.dispose();
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
    globe = initGlobe(globeEl, {
      onOpenPage(pageId) { ctx.openPage(pageId); },
      onHubFocus() {},
    });
    topbar.setPage(null);
    const deepId = location.hash.slice(1);
    if (deepId && store.getPage(deepId)) ctx.openPage(deepId);
  }

  function mountDeveloper() {
    sidebar = null;
    if (!isConfigured()) { showConnectPrompt(); return; }
    const provider = devProvider();
    globe = initGlobe(globeEl, {
      onOpenPage(id) { const node = devNodesById && devNodesById.get(id); if (node) ctx.openDevItem(node); },
      onHubFocus() {},
    }, provider);
    // Build the sidebar + node lookup from the same graph the globe uses.
    provider.getGraph().then((graph) => {
      devNodesById = new Map();
      for (const hub of graph.hubs) {
        devNodesById.set(hub.page.id, hub.page);
        for (const leaf of hub.leaves) devNodesById.set(leaf.page.id, leaf.page);
      }
      mountDevSidebar(sidebarEl, ctx, graph);
    });
    topbar.setPage(null);
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
