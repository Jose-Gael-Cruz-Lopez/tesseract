// App shell (Task 21). Builds the Notion-style frame — sidebar rail, topbar,
// content area with the globe behind a slide-over page panel — mounts every
// surface, and wires them together through one `ctx` object. The globe is the
// Home view; opening a page slides a panel over it and focuses its hub behind.

import { initGlobe } from './globe/globe.js';
import * as store from './data/store.js';
import * as auth from './auth/auth.js';
import { toast } from './ui/popover.js';
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

// A page-editor keeps a live editable surface with unsaved keystrokes; we never
// want a global shortcut to fire while the caret is in a field.
function inEditableFocus() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || a.isContentEditable;
}

// An open modal/popover owns Escape and outside interaction; the shell should
// stand down while one is up.
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

  let currentId = null;

  // Forward-declared so ctx can close over them before they're assigned.
  let sidebar;
  let topbar;
  let editor;
  let comments;
  let globe;

  const ctx = {
    store,
    auth,
    currentPageId: () => currentId,

    openPage(id) {
      const page = store.getPage(id);
      if (!page || page.deleted) return;
      currentId = id;
      editor.open(id);
      topbar.setPage(page);
      sidebar.setActivePage(id);
      globe.focusPage(id);
      if (location.hash !== '#' + id) {
        history.replaceState(null, '', '#' + id);
      }
    },

    closePage() {
      if (currentId == null) return;
      currentId = null;
      editor.close();
      comments.close();
      topbar.setPage(null);
      sidebar.setActivePage(null);
      globe.clearFocus();
      history.replaceState(null, '', location.pathname + location.search);
    },

    goHome() {
      ctx.closePage();
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

    logOut() {
      auth.logOut();
      if (globe) globe.dispose();
      if (typeof onLogOut === 'function') onLogOut();
      else location.reload();
    },

    toast,
  };

  sidebar = mountSidebar(sidebarEl, ctx);
  topbar = mountTopbar(topbarEl, ctx);
  editor = mountEditor(pageEl, ctx);
  comments = mountComments(commentsEl, ctx);
  topbar.setPage(null);

  globe = initGlobe(globeEl, {
    onOpenPage(pageId) { ctx.openPage(pageId); },
    onHubFocus() { /* focus is reflected by the globe itself; no chrome change */ },
  });

  // A deep link (#<pageId>) opens straight to that page.
  const deepId = location.hash.slice(1);
  if (deepId && store.getPage(deepId)) ctx.openPage(deepId);

  // Global shortcuts. The sidebar owns ⌘\ (collapse); overlays own their own
  // Escape. Here: ⌘K / "/" open search, Escape returns from an open page.
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

  return { ctx, sidebar, topbar, editor, comments, globe };
}
