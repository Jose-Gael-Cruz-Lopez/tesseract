// The 240px page-tree sidebar (`sb-` prefix). Renders the workspace header,
// the Search / Updates / Settings nav, an optional Favorites section, the live
// page tree (with per-row add / rename / delete menus), an optional Teamspaces
// section, the templates / import / trash group, and the New page footer.
//
// It subscribes to the store's 'pages' and 'workspace' events and re-renders in
// place so the tree tracks every mutation (create, delete, restore, favorite,
// teamspace). Expansion state is kept in memory (default collapsed). Cross-
// surface actions go through the `ctx` callbacks; the Trash row calls this
// task's own `openTrash` directly (both files ship together in Task 10).
//
// No top-level DOM access — everything happens inside mountSidebar.
// Consumes: store, popover, ICONS, trash.

import { el, openPopover } from './popover.js';
import { ICONS } from './icons.js';
// Trash opens through ctx.openTrash (the app shell binds it to trash.js's
// openTrash) — the same channel the topbar's "Show deleted pages" uses — so
// the sidebar imports no sibling surface directly.
import {
  getWorkspace,
  topLevelPages,
  childrenOf,
  getPage,
  createPage,
  updatePage,
  deletePage,
  duplicatePage,
  favorites,
  getPrefs,
  setPref,
  onStore,
} from '../data/store.js';

export function mountSidebar(container, ctx) {
  const expanded = new Map(); // pageId → boolean (default collapsed)
  let activeId = null;

  const shell = typeof container.closest === 'function' ? container.closest('.shell') : null;

  // ---------- collapse / expand ----------

  function isCollapsed() {
    return shell ? shell.classList.contains('sidebar-collapsed') : !!getPrefs().sidebarCollapsed;
  }
  function setCollapsed(collapsed) {
    setPref('sidebarCollapsed', collapsed);
    if (shell) shell.classList.toggle('sidebar-collapsed', collapsed);
  }
  function toggleCollapse() {
    setCollapsed(!isCollapsed());
  }

  // A floating hamburger that lives on the shell and only shows while collapsed.
  if (shell && !shell.querySelector('.sb-expand')) {
    const expand = el('button', 'sb-expand', ICONS.expand);
    expand.type = 'button';
    expand.title = 'Open sidebar';
    expand.setAttribute('aria-label', 'Open sidebar');
    expand.addEventListener('click', () => setCollapsed(false));
    shell.appendChild(expand);
  }
  if (getPrefs().sidebarCollapsed && shell) shell.classList.add('sidebar-collapsed');

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      toggleCollapse();
    }
  }
  document.addEventListener('keydown', onKeydown);

  // ---------- page icon ----------

  function pageIconHTML(page) {
    const icon = page.icon;
    if (icon && icon.type === 'emoji' && icon.value) {
      return `<span class="sb-emoji">${icon.value}</span>`;
    }
    if (icon && icon.type === 'icon' && ICONS[icon.value]) return ICONS[icon.value];
    return ICONS.page;
  }

  // ---------- reusable row scaffolds ----------

  function navRow(iconName, label, key, onClick) {
    const row = el('button', 'sb-row sb-nav-row');
    row.type = 'button';
    if (key) row.dataset.sbNav = key;
    row.appendChild(el('span', 'sb-row-icon', ICONS[iconName]));
    row.appendChild(el('span', 'sb-row-label', label));
    row.addEventListener('click', onClick);
    return row;
  }

  function sectionLabel(text) {
    return el('div', 'sb-section-label', text);
  }

  // ---------- header ----------

  function buildHeader() {
    const ws = getWorkspace() || { name: 'Mnemosphere', ownerEmail: '' };
    const header = el('div', 'sb-header');

    const wsBtn = el('button', 'sb-ws');
    wsBtn.type = 'button';
    const letter = (ws.name || 'M').trim().charAt(0).toUpperCase() || 'M';
    wsBtn.appendChild(el('span', 'sb-avatar', letter));
    wsBtn.appendChild(el('span', 'sb-ws-name', ws.name || 'Mnemosphere'));
    wsBtn.addEventListener('click', () => openWorkspaceMenu(wsBtn, ws));

    const collapse = el('button', 'sb-collapse', ICONS.collapse);
    collapse.type = 'button';
    collapse.title = 'Close sidebar';
    collapse.setAttribute('aria-label', 'Close sidebar');
    collapse.addEventListener('click', () => setCollapsed(true));

    header.append(wsBtn, collapse);
    return header;
  }

  function openWorkspaceMenu(anchor, ws) {
    openPopover(anchor, {
      className: 'sb-ws-pop',
      build: (root, close) => {
        root.appendChild(el('div', 'sb-ws-pop-name', ws.name || 'Mnemosphere'));
        if (ws.ownerEmail) root.appendChild(el('div', 'sb-ws-pop-email', ws.ownerEmail));
        root.appendChild(el('div', 'sb-menu-divider'));

        // Mode switch: Knowledge (notes globe) ↔ Developer (canopy sphere).
        root.appendChild(el('div', 'sb-menu-label', 'Switch mode'));
        const active = ctx.mode ? ctx.mode() : 'knowledge';
        for (const [id, label] of [['knowledge', 'Knowledge'], ['developer', 'Developer']]) {
          const item = el('button', 'sb-menu-item' + (active === id ? ' is-active' : ''), (active === id ? '✓ ' : '') + label);
          item.type = 'button';
          item.addEventListener('click', () => { close(); ctx.setMode && ctx.setMode(id); });
          root.appendChild(item);
        }
        root.appendChild(el('div', 'sb-menu-divider'));

        const logout = el('button', 'sb-menu-item', 'Log out');
        logout.type = 'button';
        logout.addEventListener('click', () => {
          close();
          ctx.logOut();
        });
        root.appendChild(logout);
      },
    });
  }

  // ---------- tree ----------

  function buildTreeNode(page, depth) {
    const node = el('div', 'sb-tree-node');
    const kids = childrenOf(page.id);
    const isOpen = expanded.get(page.id) === true;

    const row = el('div', 'sb-tree-row');
    row.dataset.pageId = page.id;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    if (page.id === activeId) row.classList.add('is-active');
    if (isOpen) row.classList.add('is-open');

    // icon slot: twisty overlays the page icon (absolute) so the icon stays put
    const iconSlot = el('span', 'sb-icon-slot');
    const twisty = el('button', 'sb-twisty', ICONS.chevron);
    twisty.type = 'button';
    twisty.tabIndex = -1;
    twisty.setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand');
    const icon = el('span', 'sb-page-icon', pageIconHTML(page));
    iconSlot.append(twisty, icon);

    const title = el('span', 'sb-page-title');
    title.textContent = page.title || 'Untitled';

    const actions = el('div', 'sb-row-actions');
    const more = el('button', 'sb-more', ICONS.more);
    more.type = 'button';
    more.title = 'Delete, duplicate, and more...';
    more.setAttribute('aria-label', 'More options');
    const add = el('button', 'sb-add-child', ICONS.plus);
    add.type = 'button';
    add.title = 'Add a page inside';
    add.setAttribute('aria-label', 'Add a page inside');
    actions.append(more, add);

    row.append(iconSlot, title, actions);

    // open the page (unless a control inside the row handled the click)
    row.addEventListener('click', () => ctx.openPage(page.id));

    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      expanded.set(page.id, !isOpen);
      render();
    });

    add.addEventListener('click', (e) => {
      e.stopPropagation();
      expanded.set(page.id, true);
      const child = createPage({ parentId: page.id });
      ctx.openPage(child.id);
    });

    more.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(more, page, row, title);
    });

    node.appendChild(row);

    if (isOpen && kids.length) {
      const childrenWrap = el('div', 'sb-children');
      for (const child of kids) childrenWrap.appendChild(buildTreeNode(child, depth + 1));
      node.appendChild(childrenWrap);
    }

    return node;
  }

  function openRowMenu(anchor, page, row, titleEl) {
    openPopover(anchor, {
      className: 'sb-menu',
      build: (root, close) => {
        const item = (label, iconName, handler) => {
          const btn = el('button', 'sb-menu-item');
          btn.type = 'button';
          btn.appendChild(el('span', 'sb-menu-icon', ICONS[iconName]));
          btn.appendChild(el('span', 'sb-menu-label', label));
          btn.addEventListener('click', () => {
            close();
            handler();
          });
          return btn;
        };
        root.appendChild(item('Delete', 'trash', () => deletePage(page.id)));
        root.appendChild(item('Duplicate', 'duplicate', () => duplicatePage(page.id)));
        root.appendChild(item('Copy link', 'link', () => ctx.toast('Coming soon')));
        root.appendChild(item('Rename', 'newPage', () => startRename(page, row, titleEl)));
      },
    });
  }

  function startRename(page, row, titleEl) {
    const input = el('input', 'sb-rename');
    input.type = 'text';
    input.value = page.title || '';
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      updatePage(page.id, { title: input.value.trim() });
      // updatePage emits 'pages' → render() rebuilds this row with the new title.
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        done = true;
        render();
      }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // ---------- favorites ----------

  function pageRow(page, cls) {
    const row = el('button', `sb-row ${cls}`);
    row.type = 'button';
    row.dataset.pageId = page.id;
    if (page.id === activeId) row.classList.add('is-active');
    row.appendChild(el('span', 'sb-page-icon', pageIconHTML(page)));
    const title = el('span', 'sb-page-title');
    title.textContent = page.title || 'Untitled';
    row.appendChild(title);
    row.addEventListener('click', () => ctx.openPage(page.id));
    return row;
  }

  // ---------- render ----------

  function render() {
    container.innerHTML = '';
    const root = el('div', 'sb-root');

    root.appendChild(buildHeader());

    const nav = el('div', 'sb-nav');
    nav.appendChild(navRow('search', 'Search', 'search', () => ctx.openSearch()));
    const updates = navRow('updates', 'Updates', 'updates', () => ctx.openUpdates(updates));
    nav.appendChild(updates);
    nav.appendChild(navRow('settings', 'Settings & members', 'settings', () => ctx.openSettings()));
    root.appendChild(nav);

    const scroll = el('div', 'sb-scroll');

    const favs = favorites();
    if (favs.length) {
      const section = el('div', 'sb-section sb-favorites');
      section.appendChild(sectionLabel('Favorites'));
      for (const page of favs) section.appendChild(pageRow(page, 'sb-fav-row'));
      scroll.appendChild(section);
    }

    const tree = el('div', 'sb-section sb-tree-section');
    const treeInner = el('div', 'sb-tree');
    for (const page of topLevelPages()) treeInner.appendChild(buildTreeNode(page, 0));
    tree.appendChild(treeInner);

    const addPage = el('button', 'sb-row sb-add');
    addPage.type = 'button';
    addPage.dataset.sbAddPage = '';
    addPage.appendChild(el('span', 'sb-row-icon', ICONS.plus));
    addPage.appendChild(el('span', 'sb-row-label', 'Add a page'));
    addPage.addEventListener('click', () => {
      const page = createPage({ parentId: null });
      ctx.openPage(page.id);
    });
    tree.appendChild(addPage);
    scroll.appendChild(tree);

    const teamspaces = (getWorkspace()?.teamspaces) || [];
    if (teamspaces.length) {
      const section = el('div', 'sb-section sb-teamspaces');
      section.appendChild(sectionLabel('Teamspaces'));
      for (const ts of teamspaces) {
        const row = el('button', 'sb-row sb-ts-row');
        row.type = 'button';
        row.dataset.teamspaceId = ts.id;
        const iconHTML =
          ts.icon && typeof ts.icon === 'string' ? `<span class="sb-emoji">${ts.icon}</span>` : ICONS.teamspace;
        row.appendChild(el('span', 'sb-row-icon', iconHTML));
        row.appendChild(el('span', 'sb-row-label', ts.name || 'Teamspace'));
        row.addEventListener('click', () => ctx.toast('Coming soon'));
        section.appendChild(row);
      }
      scroll.appendChild(section);
    }

    const group = el('div', 'sb-section sb-group');
    const groupRow = (iconName, label, action, onClick) => {
      const row = el('button', 'sb-row sb-group-row');
      row.type = 'button';
      row.dataset.sbAction = action;
      row.appendChild(el('span', 'sb-row-icon', ICONS[iconName]));
      row.appendChild(el('span', 'sb-row-label', label));
      row.addEventListener('click', onClick);
      return row;
    };
    group.appendChild(groupRow('teamspace', 'Create a teamspace', 'teamspace', () => ctx.openTeamspace()));
    group.appendChild(groupRow('templates', 'Templates', 'templates', () => ctx.openTemplates()));
    group.appendChild(groupRow('import', 'Import', 'import', () => ctx.openImport()));
    const trashRow = groupRow('trash', 'Trash', 'trash', () => ctx.openTrash(trashRow));
    group.appendChild(trashRow);
    scroll.appendChild(group);

    root.appendChild(scroll);

    const footer = el('div', 'sb-footer');
    const newPage = el('button', 'sb-row sb-newpage');
    newPage.type = 'button';
    newPage.dataset.sbNewpage = '';
    newPage.appendChild(el('span', 'sb-row-icon', ICONS.newPage));
    newPage.appendChild(el('span', 'sb-row-label', 'New page'));
    newPage.addEventListener('click', () => {
      const page = createPage({ parentId: null });
      ctx.openPage(page.id);
    });
    footer.appendChild(newPage);
    root.appendChild(footer);

    container.appendChild(root);
  }

  // ---------- first-run tip ----------

  function showTipIfNeeded() {
    if (getPrefs().tipDismissed) return;
    if (document.querySelector('.sb-tip')) return;

    const tip = el('div', 'sb-tip');
    tip.appendChild(el('div', 'sb-tip-title', 'Here are some templates to help you get started'));
    tip.appendChild(
      el('div', 'sb-tip-body', 'Use them out of the box, or customize them to your own workflows.'),
    );
    const actions = el('div', 'sb-tip-actions');
    const ok = el('button', 'sb-tip-ok', 'OK');
    ok.type = 'button';
    const clear = el('button', 'sb-tip-clear', 'Clear templates');
    clear.type = 'button';
    actions.append(ok, clear);
    tip.appendChild(actions);

    const dismiss = () => {
      setPref('tipDismissed', true);
      tip.remove();
    };
    ok.addEventListener('click', dismiss);
    clear.addEventListener('click', () => {
      clearTemplates();
      dismiss();
    });

    (shell || document.body).appendChild(tip);
  }

  // Delete every seeded page except "Getting Started", which is emptied (its
  // sub-pages removed and its blocks cleared) so the user starts from a blank
  // canvas — matching the tip's "Clear templates" affordance.
  function clearTemplates() {
    const tops = topLevelPages();
    const kept = tops.find((p) => p.title === 'Getting Started');
    for (const page of tops) {
      if (kept && page.id === kept.id) continue;
      deletePage(page.id);
    }
    if (kept) {
      for (const child of childrenOf(kept.id)) deletePage(child.id);
      updatePage(kept.id, { blocks: '' });
    }
  }

  // ---------- live updates ----------

  onStore('pages', render);
  onStore('workspace', render);

  render();
  showTipIfNeeded();

  return {
    setActivePage(id) {
      activeId = id;
      render();
    },
    refresh: render,
  };
}
