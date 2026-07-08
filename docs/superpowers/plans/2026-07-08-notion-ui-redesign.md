# Notion-fidelity UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Mnemosphere's chrome — auth flow, sidebar, page editor, and every secondary surface — as a pixel-faithful replica of the 25 reference screenshots in `inspired design/`, with the 3D globe kept as the Home view.

**Architecture:** Vanilla ES modules on the existing Vite stack. A foundation layer (data store, mock auth, tokens, shared popover/icon/illustration modules, extracted globe) is built first and pins all interfaces; then independent UI surface modules are built in parallel against those interfaces; then a sequential integration phase wires everything in `main.js`; finally a visual-fidelity loop compares every surface against its reference screenshot.

**Tech Stack:** Vite 7, three 0.185.1 (unchanged), vitest + happy-dom (new devDeps, tests only). No runtime dependencies added. No framework.

**Spec:** `docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md` — read it before any task. Reference images: `inspired design/1.png` … `25.png` (read the ones named by your task).

## Global Constraints

- **No new runtime dependencies.** devDependencies may add only `vitest` and `happy-dom`.
- **Branding:** the product name is **Mnemosphere** everywhere. Never render the word "Notion" in the UI, and never copy Notion's logo or illustration artwork — all illustrations are original inline SVGs in an ink-sketch style (thin black strokes, sparse hatching).
- **Storage namespace:** every localStorage key starts with `ms:`. Old `mnemo:*` keys are never read or written.
- **Colors only via tokens:** all CSS colors come from custom properties defined in `src/styles/tokens.css`. No hex literals in surface CSS (exceptions: `globe.css` deep-space values, gradients baked into cover presets in `decor-data.js`).
- **Class prefixes (collision guard):** auth `au-`, sidebar `sb-`, topbar `tb-`, editor `ed-`, database `db-`, AI `ai-`, search `srch-`, updates `upd-`, settings `set-`, share/comments `shr-`, templates modal `tpl-`, import `imp-`, teamspace `ts-`, trash `tr-`, popover/modal/toast `pop-`/`mod-`/`toast-`, globe chrome `gl-`.
- **No top-level DOM access in any `src/ui/*`, `src/auth/auth-view.js`, or `src/data/*` module.** All DOM work happens inside exported functions. (This lets vitest import-smoke every module.)
- **Surface modules never import each other.** They may import only: `icons.js`, `illustrations.js`, `popover.js`, `theme.js`, and data modules. Cross-surface actions go through the `ctx` object. (Single exception: `editor.js` may *dynamically* import `database.js` and `ai.js` at render time, wrapped in try/catch.)
- **Every interactive control that has no real behavior yet** must call `ctx.toast('Coming soon')` — nothing silently dead.
- **Keyboard/copy fidelity:** copy strings, menu items, and keyboard hints must match the task's "Copy" list exactly.
- **Commit style:** small commits, present-tense summary, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Execution strategy (parallelism map)

- **Phase A (foundation):** Task 1 first; Tasks 2–7 in parallel (disjoint files); Task 8 (globe extraction + boot skeleton) after 2–7 land.
- **Phase B (surfaces):** Tasks 9–20 fully parallel, one agent each, isolated worktrees, one branch per task, disjoint files. Each ships its own vitest tests.
- **Phase C (integration):** Tasks 21–23 sequential in the main tree after all B branches merge.
- **Phase D (visual fidelity):** Task 24, driven from the main session with browser tooling; fix-ups may fan out again.
- Worktree agents: symlink the main checkout's `node_modules` (`ln -sfn "$MAIN/node_modules" node_modules`) instead of installing.

## Canonical interfaces (single source of truth)

Every task codes against these exact shapes. Do not rename.

### Page record (store)

```js
{
  id,                    // crypto.randomUUID()
  title,                 // string; '' renders as 'Untitled'
  icon,                  // {type:'emoji'|'icon'|'image', value, color?} | null
  cover,                 // {type:'preset'|'link', value} | null
  coverPos,              // number 0..100, vertical crop %, default 50
  blocks,                // HTML string (doc) | {type:'database', ...} (see below)
  parentId,              // string | null (null = top-level = globe hub)
  created, edited,       // epoch ms
  favorite, deleted,     // booleans
  locked,                // boolean (Lock page)
  font,                  // 'default'|'serif'|'mono'
  smallText, fullWidth,  // booleans
  teamspaceId,           // string | null
}
```

### Database block config

```js
{
  type: 'database',
  columns: [{ id, name, kind: 'title'|'text'|'checkbox'|'select'|'stars'|'date'|'url'|'person',
              options?: [{label, color}] }],       // color: 'gray'|'blue'|'green'|'yellow'|'red'
  rows:    [{ id, cells: {/* colId → value */} }], // title/text/date/url/person: string,
                                                   // checkbox: bool, select: label, stars: 0-5
  views:   [{ id, name, layout: 'table'|'gallery'|'board'|'timeline'|'calendar',
              filters: [{colId, value}], groupBy: colId|null }],
  activeView, // view id
}
```

### `src/data/store.js`

```js
export function initStore()                    // load from localStorage; returns workspace | null
export function seedWorkspace(profile)         // {name,email} → create workspace + seed pages
export function getWorkspace()                 // {name, ownerEmail, teamspaces:[{id,name,description,icon}]}
export function updateWorkspace(patch)
export function getPages()                     // all pages incl. deleted (callers filter)
export function getPage(id)
export function childrenOf(parentId)           // non-deleted, insertion order
export function topLevelPages()                // childrenOf(null)
export function createPage(partial)            // fills defaults, returns page
export function updatePage(id, patch)          // stamps edited, returns page
export function deletePage(id)                 // soft-delete page + descendants
export function restorePage(id)                // restore page + descendants
export function destroyPage(id)                // hard delete + descendants
export function trashedPages()
export function duplicatePage(id)              // deep copy, " (1)" suffix, returns copy
export function toggleFavorite(id)
export function favorites()
export function searchPages(query)             // [{page, snippet}] title-match first, then body
export function addTeamspace({name, description, icon})
export function getPrefs() / setPref(key, value)   // theme,startPage,sidebarCollapsed,
                                                   // tipDismissed, notif* toggles, shareWeb:<pageId>
export function onStore(event, cb) / offStore(event, cb)
// events: 'pages' (detail {type:'create'|'update'|'delete'|'restore'|'destroy', page}),
//         'workspace', 'prefs' (detail {key, value})
export function resetStore()                   // test helper: clear memory + storage
```

localStorage guarded: module keeps an in-memory map and mirrors to localStorage in try/catch (private-mode safe). Keys: `ms:workspace`, `ms:pages`, `ms:prefs`.

### `src/auth/auth.js`

```js
export async function signUp(email)            // {ok:true}; remembers pending email
export async function verifyCode(email, code)  // {ok: code.trim().length>0}
export function pendingEmail()                 // string | null
export async function completeProfile({name, password, avatar}) // creates session
export async function logIn(email)             // {ok}; existing or new pending
export function getSession()                   // {email, name, avatar, onboarded} | null
export function setOnboarded()
export function logOut()
```

Keys: `ms:session`, `ms:pending`. All async (Supabase-shaped).

### `src/ui/popover.js`

```js
export function openPopover(anchor, {className, build, placement='bottom-start', offset=6})
// build(el, close). Absolutely positioned, viewport-clamped, closes on outside
// mousedown + Escape. Returns close().
export function openModal({className, build, dim=true})
// centered, scrim, Escape/scrim closes. Returns close().
export function toast(message)                 // bottom-center chip, auto-hide 2.4s
export function el(tag, className, html)       // element helper (the old `elh`)
```

### `src/ui/theme.js`

```js
export function initTheme()        // apply saved pref ('system' default→light), listen to system
export function setTheme(mode)     // 'light'|'dark'|'system' → sets <html data-theme>, persists pref
export function getTheme()         // saved mode
```

### `src/globe/globe.js`

```js
export function initGlobe(container, hooks)
// hooks: {onOpenPage(pageId), onHubFocus(pageId|null)}
// reads pages via store imports; subscribes to 'pages' events and rebuilds live
// returns {focusPage(id), clearFocus(), setVisible(bool), dispose()}
```

### The `ctx` object (built in `main.js`, passed to every mount/open)

```js
ctx = {
  store: * ,            // the store module namespace
  auth: * ,             // the auth module namespace
  openPage(id), closePage(), currentPageId(),   // page routing
  goHome(),                                     // close page → globe
  openSearch(), openSettings(panel), openUpdates(anchor),
  openTemplates(), openImport(), openTeamspace(), openTrash(anchor),
  openShare(anchor, pageId), toggleComments(pageId),
  logOut(),
  toast(msg),
}
```

### Surface module exports

```js
// sidebar.js
export function mountSidebar(container, ctx)   // → {setActivePage(id|null), refresh()}
// topbar.js
export function mountTopbar(container, ctx)    // → {setPage(page|null)}
// editor.js
export function mountEditor(container, ctx)    // → {open(pageId), close(), isOpen()}
// database.js
export function renderDatabase(container, page, ctx)   // renders + persists via updatePage
// ai.js
export function mountAIBar(bodyEl, page, ctx)  // → {destroy()}
export const aiProvider = { async *generate(prompt) {} }  // yields word tokens
// search.js       → export function openSearch(ctx)
// updates.js      → export function openUpdates(anchor, ctx)
// settings.js     → export function openSettings(ctx, panel='notifications')
// share.js        → export function openShare(anchor, pageId, ctx)
//                   export function mountComments(container, ctx) // → {toggle(pageId), close()}
// templates-modal.js → export function openTemplates(ctx)
// import-modal.js    → export function openImport(ctx)
// teamspace-modal.js → export function openTeamspace(ctx)
// trash.js           → export function openTrash(anchor, ctx)
// auth-view.js       → export function mountAuth(container, {onComplete})  // full flow + login
```

### Test conventions (all tasks)

- Runner: `npx vitest run <file>` — zero config; DOM tests start with
  `// @vitest-environment happy-dom`.
- Store-dependent tests call `resetStore()` in `beforeEach`.
- Every module gets at least an import-smoke test:
  `test('imports', async () => { await import('../src/ui/<mod>.js') })`.
- UI tests assert structure/copy/behavior (classes, exact strings, click handlers) — never pixels.

---

## Phase A — Foundation

### Task 1: Test infrastructure

**Files:** Modify `package.json`.

- [ ] Add devDeps + script: `npm i -D vitest happy-dom` and add `"test": "vitest run"` to scripts.
- [ ] Create `tests/smoke.test.js`:

```js
import { test, expect } from 'vitest';
test('vitest runs', () => { expect(1 + 1).toBe(2); });
```

- [ ] Run `npx vitest run` → 1 pass. Commit `chore: add vitest + happy-dom test infra`.

### Task 2: Design tokens + base styles + theme module

**Files:** Create `src/styles/tokens.css`, `src/styles/base.css`, `src/ui/theme.js`, `tests/theme.test.js`.
**Reference:** `7.png` (light chrome), `18.png` (dark), `1.png` (auth light).

- [ ] **Failing test** (`tests/theme.test.js`, happy-dom): `setTheme('dark')` sets `document.documentElement.dataset.theme === 'dark'` and persists so a fresh `initTheme()` re-applies it; `setTheme('system')` follows a mocked `matchMedia`.
- [ ] `tokens.css` — define on `:root` (light) and `:root[data-theme="dark"]`:

```css
:root {
  --bg: #ffffff;            --bg-sidebar: #fbfbfa;   --bg-cream: #f7f6f3;
  --bg-hover: rgba(0,0,0,.04); --bg-active: rgba(0,0,0,.06);
  --bg-blue-light: #e7f3f8;
  --text: #37352f;          --text-2: rgba(55,53,47,.65); --text-3: rgba(55,53,47,.45);
  --border: rgba(55,53,47,.16); --divider: rgba(55,53,47,.09);
  --blue: #2383e2;          --blue-hover: #0077d4;
  --cta-red-bg: #fdecec;    --cta-red-text: #eb5757;  --cta-red-border: rgba(235,87,87,.6);
  --chip-gray: #e3e2e0; --chip-blue: #d3e5ef; --chip-green: #dbeddb;
  --chip-yellow: #fdecc8; --chip-red: #ffe2dd;
  --scrim: rgba(15,15,15,.6);
  --pop-bg: #ffffff;
  --pop-shadow: 0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.2);
  --sidebar-w: 240px; --topbar-h: 45px; --row-h: 27px;
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-serif: Lyon-Text, Georgia, ui-serif, serif;
  --font-mono: iawriter-mono, Nitti, Menlo, Courier, monospace;
}
:root[data-theme="dark"] {
  --bg: #191919; --bg-sidebar: #202020; --bg-cream: #191919;
  --bg-hover: rgba(255,255,255,.055); --bg-active: rgba(255,255,255,.09);
  --bg-blue-light: rgba(35,131,226,.15);
  --text: rgba(255,255,255,.9); --text-2: rgba(255,255,255,.5); --text-3: rgba(255,255,255,.35);
  --border: rgba(255,255,255,.13); --divider: rgba(255,255,255,.07);
  --cta-red-bg: rgba(235,87,87,.12); --cta-red-text: #ff7369;
  --chip-gray: #5a5a5a; --chip-blue: #28456c; --chip-green: #2b593f;
  --chip-yellow: #89632a; --chip-red: #6e3630;
  --pop-bg: #252525;
  --pop-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 3px 6px rgba(0,0,0,.3), 0 9px 24px rgba(0,0,0,.5);
}
```

  (Task 24 refines exact values by sampling the PNGs; token *names* are frozen.)
- [ ] `base.css`: reset, `body { font-family: var(--font-ui); color: var(--text); background: var(--bg); }`, shared button/input resets, `.toast-chip` styling, thin scrollbar styling matching Notion.
- [ ] `theme.js` per interface; persists via localStorage key `ms:prefs` (read/write directly with try/catch — theme must work before the store exists on auth screens).
- [ ] Run tests → pass. Commit `feat: design tokens, base styles, theme module`.

### Task 3: Icon set

**Files:** Create `src/ui/icons.js`, `tests/icons.test.js`.

- [ ] **Failing test:** import `ICONS`; assert every name in the list below is a string containing `<svg`.
- [ ] `icons.js`: `export const ICONS = {...}` — 16×16 inline SVGs, `stroke="currentColor"` line style (match the existing `ICON` map's look in `src/main.js:812-824`; copy those paths where names overlap). Required names: `search, updates, settings, page, pageFilled, chevron, plus, more, collapse, expand, trash, templates, import, teamspace, newPage (pencil-square), home, star, starFilled, comment, clock, share, ai (sparkle), send, checkbox, table, board, timeline, calendar, question, close, back, emoji (face), image, link, lock, copy, duplicate, moveTo, undo, history, analytics, export, connect, globeMark (Mnemosphere logo mark: circle + orbit ellipse), google (G glyph), apple, mail, gear, info, arrowUpDown, enter`.
- [ ] Run tests → pass. Commit `feat: full SVG icon set`.

### Task 4: Store + seed data

**Files:** Create `src/data/store.js`, `src/data/seed.js`, `tests/store.test.js`, `tests/seed.test.js`.

- [ ] **Failing tests** (`tests/store.test.js`) covering: create/get/childrenOf order; updatePage stamps `edited`; deletePage soft-deletes descendants and restorePage brings the same set back; destroyPage removes; duplicatePage deep-copies with ` (1)` suffix; toggleFavorite/favorites; searchPages matches title before body and returns snippets; prefs round-trip; `onStore('pages')` fires with `{type:'create'}`; persistence survives module "reload" (`initStore()` after mutation with a fresh in-memory copy from mocked localStorage); works when localStorage throws (mock it to throw → still functional in memory).

```js
import { beforeEach, test, expect } from 'vitest';
import * as store from '../src/data/store.js';
beforeEach(() => store.resetStore());
test('soft delete cascades and restores', () => {
  store.seedWorkspace({ name: 'Ada', email: 'a@b.c' });
  const parent = store.createPage({ title: 'P' });
  const child  = store.createPage({ title: 'C', parentId: parent.id });
  store.deletePage(parent.id);
  expect(store.getPage(child.id).deleted).toBe(true);
  expect(store.trashedPages().map(p => p.id)).toContain(parent.id);
  store.restorePage(parent.id);
  expect(store.getPage(child.id).deleted).toBe(false);
});
```

- [ ] Implement `store.js` per the canonical interface.
- [ ] Implement `seed.js`: `export function buildSeed()` returning `[{page partial, children:[...]}]` consumed by `seedWorkspace`. Exact seed (top-level order matters — it is the sidebar order in `7.png`):
  1. **Getting Started** — icon 👋, no cover. Blocks HTML: heading "Welcome to Mnemosphere!", line "Here are the basics:", then clickable checkboxes (`<div class="ed-todo"><input type=checkbox>…</div>`): "Click anywhere and just start typing", "Hit / to see all the types of content you can add — headers, videos, sub pages, etc.", "Highlight any text, and use the menu that pops up to <b>style</b> <i>your</i> <code>writing</code> however you like", "See the ⋮⋮ to the left of this checkbox on hover? Click and drag to move this line", "Click the + New Page button at the bottom of your sidebar to add a new page", "Click Templates in your sidebar to get started with pre-built pages", then a toggle block (`<details><summary>This is a toggle block. Click the little triangle to see more useful tips!</summary>…3 short tips…</details>`), then callout-style line "👉 Have a question? Click the ? at the bottom right for more guides, or to send us a message." Sub-pages: "Basics", "Shortcuts", "FAQ" (empty docs).
  2. **Quick Note** — icon 📌. Blocks: gray callout "<b>Mnemosphere Tip:</b> Use this template to write quick notes you can reference later and quickly create a rich document. You can embed links, images, to-do's, and more."; heading "Jot down some text"; a short paragraph; heading "Make a to-do list"; todos "Wake up" (checked), "Brush teeth" (checked), "Eat breakfast"; heading "Create sub-pages". Sub-pages: "Groceries", "Ideas", "Scratchpad".
  3. **Personal Home** — icon 🏠, cover preset `gradient-red`. Sub-pages: "Habit tracker", "Recipes", "Workout plan".
  4. **Task List** — icon ✔️. Blocks: the To-dos **database** (exact rows in Task 14's template data — import `TEMPLATE_TODOS` from `templates.js`… seed.js may NOT import templates.js (phase order); instead inline the same database config here and Task 14 re-exports it from seed). Columns: Task name (title), Assign (person), Due (date); rows: "Write project brief / Sohrab Amin / November 30, 2022", "Schedule team off-site / David Choi / (empty)" (checked), "Build Admin console / Tanner Goda / November 8, 2022" (checked), "Draft launch blog post / Christina Lin / (empty)", "Brainstorm on Share menu / Jen Jackson / November 8, 2022", "Come up with naming ideas / Jake Trower / November 8, 2022". View: table "Tasks". Sub-pages: "Work", "Home", "Errands".
  5. **Journal** — icon 📔. Sub-pages: "Morning pages", "Gratitude log", "Dream log".
  6. **Reading List** — icon 📚, cover preset `photo-books` (add this preset in Task 8 if missing: warm photo-style CSS gradient). Blocks: intro paragraph "The modern day reading list includes more than just books. We've created a dashboard to help you track books, articles, podcasts, and videos. Each media type has its own view based on the Type property." + line "✂️ One more thing… if you install the Mnemosphere Web Clipper, you can save links off the web directly to this table." + line "👆 Click through the different database tabs to see other views. Sort content by status, author, type, or publisher." Then the Reading List **database**: columns Name (title), Type (select: Article/gray, TV Series/blue, Book/green), Status (select: Not started/gray, In progress/blue, Done/green), Score (stars), Author (text), Completed (date), Link (url); rows: "Who Will Teach Silicon Valley to Be Ethical? / Article / Not started / 0 / Kara Swisher / (empty) / https://…", "Netflix: explained / TV Series / In progress / 0 / Ezra Klein & Joe Posner / (empty)", "Brave New World / Book / Done / 5 / Aldous Huxley / March 1, 2022", "Crime and Punishment / Book / Done / 4 / Fyodor Dostoevsky / March 28, 2022", "Sapiens: A Brief History of Humankind / Book / Done / 5 / Yuval Noah Harari / March 1, 2022". Views: "All" (table), "Grouped by status" (table, groupBy Status), "Books" (table, filter Type=Book), "Articles" (table, filter Type=Article), "Film + TV" (table, filter Type=TV Series), "Podcasts" (table). Sub-pages: "2026 books", "Articles", "Podcast queue".
- [ ] `tests/seed.test.js`: seeding creates exactly these 6 top-level pages in order, with sub-page counts (3,3,3,3,3,3), Task List + Reading List blocks have `type:'database'`.
- [ ] Run tests → pass. Commit `feat: page-tree store with events + Notion-style seed workspace`.

### Task 5: Mock auth module

**Files:** Create `src/auth/auth.js`, `tests/auth.test.js`.

- [ ] **Failing tests:** signUp stores pending email; verifyCode rejects empty, accepts "123456"; completeProfile creates session `{email, name, avatar, onboarded:false}`; setOnboarded flips it; logOut clears; getSession null when nothing; survives throwing localStorage.
- [ ] Implement per canonical interface (thin, ~80 lines, same guarded-storage pattern as store).
- [ ] Run tests → pass. Commit `feat: mock auth module with Supabase-shaped API`.

### Task 6: Shared popover/modal/toast

**Files:** Create `src/ui/popover.js`, `src/styles/modals.css`, `tests/popover.test.js`.

- [ ] **Failing tests** (happy-dom): `openPopover` appends `.pop-root` containing built content, positions from anchor rect, removes on returned close() and on outside mousedown; `openModal` renders `.mod-scrim` + `.mod-box`, Escape closes; `toast('hi')` appends `.toast-chip` with text "hi" that auto-removes (fake timers).
- [ ] Implement (port the clamping logic pattern from `src/main.js:665-678`). `modals.css`: `.pop-root { background: var(--pop-bg); box-shadow: var(--pop-shadow); border-radius: 6px; }`, scrim `var(--scrim)`, toast chip dark rounded.
- [ ] Run tests → pass. Commit `feat: shared anchored popover, modal, and toast primitives`.

### Task 7: Illustrations

**Files:** Create `src/ui/illustrations.js`, `tests/illustrations.test.js`.

- [ ] **Failing test:** every name below is a string containing `<svg`.
- [ ] `export const ART = {...}` — original ink-sketch SVGs (thin `#000` strokes at 1.5px, minimal fills, hand-drawn wobble): `character` (standing figure waving, striped shirt — bottom-left of `3.png`–`6.png`, ~120×220 viewBox), `team` (two figures over a document, for the "For my team" card), `personal` (figure writing in a notebook, "For personal use"), `school` (figure with books, "For school"), `inboxEmpty` (open envelope, `17.png`), `commentsEmpty` (two speech bubbles, `15.png` right panel), `trioAvatars` (three round ink faces, `22.png` header). Each drawn to read at ~150px wide; use `stroke="currentColor"` so dark mode inverts.
- [ ] Run tests → pass. Commit `feat: original ink-style illustration set`.

### Task 8: Globe extraction + boot skeleton

**Files:** Create `src/globe/globe.js`, `src/styles/globe.css`, `src/app.js` (app shell mount), rewrite `src/main.js`, rewrite `index.html`, move `src/nodes.js` → `src/globe/nodes.js`, move `src/decor-data.js` → `src/data/decor-data.js`, delete `src/styles.css`, create `tests/globe-data.test.js`.
**This task removes all old sidebar/page-view code — the new surfaces replace it.**

- [ ] **Failing test** (`tests/globe-data.test.js`, node env): a pure exported helper `buildGraphFromPages(pages)` returns `{hubs:[{page, dir, dist, scale, accent, leaves:[{page, parentIdx}]}]}` — top-level pages → hubs on a seeded fibonacci sphere (port the placement math from `src/main.js:170-186`), children → leaves, grandchildren → branches (parentIdx points at leaf), deeper descendants ignored; accent cycles `paletteHex` by hub index; same input ⇒ identical output (seeded RNG keyed by page id hash, not call order).
- [ ] `globe.js`: move the entire three.js scene (renderer, wireframe, tesseract, rings, streams, dust, stars, year label, intro reveal, spring physics, hub drag, hover tooltip, focus fly-to — `src/main.js:24-443` and `1311-1598`) into `initGlobe(container, hooks)`. Replace the procedural `clusterNames`/`PAGE_TITLES` generation with `buildGraphFromPages(topLevel + descendants)` reading the store; subscribe `onStore('pages')` → rebuild the affected hub (reuse `rebuildClusterGeometry` logic) or full rebuild on create/destroy of top-level pages. Dot click → `hooks.onOpenPage(page.id)`; hub click → focus + `hooks.onHubFocus(page.id)`; canvas renders into `container` (not `document.body`). Keep `window.__SBG__` dev handle. `globe.css`: canvas, `.gl-vignette`, `.gl-tooltip`, `.gl-hint` (styles ported from old `styles.css`).
- [ ] `app.js`: `export function mountApp(root)` — builds the shell skeleton only:

```html
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
</div>
```

  Mount globe into `#shell-globe`; temporary placeholder text in sidebar/topbar (replaced in Task 21). Page open/close = `.show` class slide-over (port transition from old styles.css).
- [ ] `main.js` (new, ~40 lines): `initTheme()`; `getSession()` → if no session or `!onboarded`, dynamic-import `auth-view.js` *if it exists* else render a plain "auth pending" div (Task 21 finishes this); else `initStore() || seedWorkspace(session)` then `mountApp`. Imports all css files that exist so far.
- [ ] `index.html`: strip to `<div id="root"></div>` + module script + the existing dark-paint critical style; keep title `Mnemosphere`.
- [ ] Run `npx vitest run` (all green) and `npm run build` (clean). Verify in the dev server: globe renders inside the shell with placeholder chrome; clicking a dot logs the page id. Commit `refactor: extract globe module driven by the store; new app shell + boot`.

---

## Phase B — Surfaces (parallel; each task = 1 agent, 1 branch)

Every Phase B task: **Step 0** — read the spec + your reference PNGs; **Step 1** — write failing happy-dom tests (structure/copy/behavior per the task's Verify list); **Step 2** — run, watch fail; **Step 3** — implement module + its CSS file; **Step 4** — tests green + `npx vitest run` for your files; **Step 5** — commit on your branch. Structure specs below are exhaustive for copy and anatomy; match geometry/spacing to the PNGs.

### Task 9: Auth + onboarding views

**Files:** Create `src/auth/auth-view.js`, `src/styles/auth.css`, `tests/auth-view.test.js`.
**Reference:** `1.png` `2.png` `3.png` `4.png` `5.png` `6.png`.
**Consumes:** `auth.js`, `ICONS`, `ART`, `toast`.
**Produces:** `mountAuth(container, {onComplete})` — `onComplete(profile)` fires after the "Getting ready…" beat.

Anatomy + exact copy:
- Hash routes inside the mount: `#/signup` (default), `#/login`, `#/onboarding/profile`, `#/onboarding/usecase`, `#/onboarding/about`.
- **Signup/Login** (`1.png`): fixed top-left `ICONS.globeMark` + bold "Mnemosphere" wordmark (14px). Centered column width 320px. H1 "Sign up" / "Log in" (~46px, 700). Label "Work email" (12px, `--text-2`). Input placeholder "Enter your email address...". Button "Continue with email" — `--cta-red-bg` bg, `--cta-red-text` text, 1px `--cta-red-border`, radius 5px, h 36px, full width. Line "You can also continue with SAML SSO" (12px, underlined link → toast). 24px gap. Buttons "Continue with Google" (G glyph) / "Continue with Apple" ( glyph) — white bg, 1px `--border`, h 36px → toast "Coming soon". Footer (fixed lower center, 12px `--text-3`, max-width 400px, centered): "By clicking "Continue with Apple/Google/Email/SAML" above, you acknowledge that you have read and understood, and agree to Mnemosphere's Terms & Conditions and Privacy Policy." with both link texts underlined.
- **Code step** (`2.png`): same screen, email input now filled + ✕ clear button inside; helper text "We just sent you a temporary sign up code. Please check your inbox and paste the sign up code below." (13px, `--text-2`, centered); label "Sign up code" (login: "Login code"); input "Paste login code"; button "Create new account" (login: "Continue with login code"). Non-empty code → `verifyCode` → `#/onboarding/profile` (signup) or `onComplete` short-circuit if the session already exists (login).
- **Profile** (`3.png`): full-screen `--bg-cream`. Centered column 320px: H2 "Welcome to Mnemosphere" (22px, 700), sub "First things first, tell us a bit about yourself." (14px `--text-2`). 64px gray avatar circle (person glyph); uploaded photo replaces it; caption link "Add a photo" (hidden file input, FileReader → data URL). Label "What should we call you?" input placeholder "e.g. Ada Lovelace, Ada, AL". Label "Set a password" password input placeholder "New password" + eye reveal toggle. Button "Continue" — `--blue` bg white text, disabled (40% opacity) until name && password.length ≥ 4. Footer lines: "You're creating an account for **<email>**." and "If you don't intend to set up a new account, you can log in with another email." (link → `#/signup`). `ART.character` fixed bottom-left ~120px wide.
- **Use case** (`4.png`): same cream bg + character. H2 "How are you planning to use Mnemosphere?", sub "We'll streamline your setup experience accordingly." Three cards (180×200, white, 1px `--border`, radius 4, hover shadow; selected: 2px `--blue` ring + filled radio): `ART.team` "For my team" "Collaborate on your docs, projects, and wikis." / `ART.personal` "For personal use" "Write better. Think more clearly. Stay organized." / `ART.school` "For school" "Keep your notes, research, and tasks all in one place." Radio circle top-right of each card. "Continue" below (disabled until picked).
- **About you** (`6.png` → `5.png`): H2 "Tell us about yourself", sub "We'll customize your Mnemosphere experience based on your choice." Three labeled selects: "What kind of work do you do?" (Select response / Product Design, Engineering, Marketing, Sales, Student, Other) · "What is your role?" (Select response / Solo, Team lead, Team member, Executive) · "What are you planning to do in Mnemosphere?" (multi-select popover, placeholder "Choose one or more...", options: Notes, Docs, Wiki, Projects, Tasks, Journal; shows "N selected"). "Continue" + "Skip" (12px link). Both → dim form to 40%, centered white toast card "Getting ready..." + CSS spinner (`5.png`), 1500ms, then `setOnboarded()` + `onComplete(profile)`.

- [ ] Tests: mount renders "Sign up" + all four continue paths' copy; submitting email swaps to code step containing "We just sent you a temporary sign up code…"; profile Continue disabled→enabled; selecting a card enables Continue; `onComplete` called after fake-timer 1500ms.
- [ ] Implement + CSS. Commit `feat: auth + onboarding flow (signup, code, profile, use case, about)`.

### Task 10: Sidebar + trash

**Files:** Create `src/ui/sidebar.js`, `src/ui/trash.js`, `src/styles/sidebar.css`, `tests/sidebar.test.js`.
**Reference:** `7.png` `8.png` (sidebar region).
**Consumes:** store, popover, ICONS. **Produces:** `mountSidebar`, `openTrash`.

Anatomy (240px, `--bg-sidebar`, right border `--divider`):
- **Header row** (h 44): 20px radius-4 letter-avatar (first letter of workspace name, `--chip-gray` bg), name truncated 14px/500, hover reveals `ICONS.collapse` button right. Click name → popover: workspace name, owner email (12px `--text-2`), divider, row "Log out" → `ctx.logOut()`.
- **Nav rows** (h 27, 14px, `--text-2`, icons `--text-3`): "Search" (→ `ctx.openSearch()`), "Updates" (→ `ctx.openUpdates(row)`), "Settings & members" (→ `ctx.openSettings()`).
- 12px gap. **Favorites** section label (11px/600 `--text-3`, uppercase-free "Favorites") — rendered only when `favorites().length > 0`, rows like tree rows.
- **Tree**: for `topLevelPages()` + nesting. Row: 27px; twisty chevron (`--text-3`, rotates 90° open; hidden until row hover, absolute so icon stays put — match `7.png` where twisties show on the hovered/open rows); 16px page icon (emoji verbatim or `ICONS.page`); title 14px truncated; hover reveals right-side `ICONS.plus` (add sub-page → creates "Untitled" child + `ctx.openPage(new.id)`) and `ICONS.more` (popover: Delete, Duplicate, Copy link, Rename — Rename swaps title for an inline input, Enter/blur commits via `updatePage`). Active page row: `--bg-active` + `--text` full opacity. Children indent 12px per level. Expansion state in memory (Map), default collapsed.
- Row "**+ Add a page**" (plus icon) → create top-level page + open it.
- 16px gap, then rows: "Create a teamspace" (`ICONS.teamspace`) → `ctx.openTeamspace()`; "Templates" (`ICONS.templates`) → `ctx.openTemplates()`; "Import" (`ICONS.import`) → `ctx.openImport()`; "Trash" (`ICONS.trash`) → `openTrash(row, ctx)`.
- **Footer** (border-top `--divider`): row "New page" with `ICONS.newPage` → create + open.
- **Collapse:** the header button sets `ms:prefs sidebarCollapsed`, shell class `sidebar-collapsed` (width→0, translate). Floating hamburger `ICONS.expand` top-left reopens. ⌘\\ toggles (register in mount).
- **First-run tooltip** (`7.png`): if `!getPrefs().tipDismissed` — white shadowed card anchored right of the tree, title "Here are some templates to help you get started" (600), body "Use them out of the box, or customize them to your own workflows." blue "OK" button + ghost "Clear templates" (deletes seeded pages except an emptied "Getting Started"). Either → `setPref('tipDismissed', true)`.
- **trash.js** popover (~414px): search input "Filter by page title...", list of `trashedPages()` rows (icon, title, parent-page name 12px `--text-3`, actions ↩ restore / 🗑 delete forever with confirm row "Are you sure? Delete permanently / Cancel"), empty state "No pages in Trash" + `ICONS.trash` large.

- [ ] Tests (happy-dom, seeded store): renders 6 seed titles in order; Search row calls `ctx.openSearch`; twisty expands children ("Basics" visible after expanding Getting Started); + on a row creates a child and calls `ctx.openPage`; star→Favorites section appears (call `toggleFavorite` then `refresh()`); trash popover lists a deleted page and restore returns it to the tree.
- [ ] Implement + CSS. Commit `feat: Notion-style sidebar with page tree, groups, trash popover`.

### Task 11: Top bar + share popover + comments panel

**Files:** Create `src/ui/topbar.js`, `src/ui/share.js`, `src/styles/topbar.css`, `tests/topbar.test.js`, `tests/share.test.js`.
**Reference:** `7.png` (bar), `14.png` (••• menu), `15.png` (share + comments), `25.png` (share expanded).
**Consumes:** store, popover, ICONS, ART. **Produces:** `mountTopbar`, `openShare`, `mountComments`.

- **Top bar** (h 45, transparent over content, 12px side padding): left breadcrumb — workspace name button (→ `ctx.goHome()`); when a page is set: "›"-free Notion style: `workspaceName` only on Home; on a page: page icon + title (14px) + gray chip "Private"? — **no**: match `7.png` exactly: just icon+title; sub-page shows "Parent / Child" with `--text-3` separator. Right (page only): "Edited <rel>" (14px `--text-2`, relative-time helper: just now/Nm/Nh/Nd ago), "Share" text button → `openShare(btn, pageId, ctx)`, `ICONS.comment` → `ctx.toggleComments(pageId)`, `ICONS.clock` → toast, `ICONS.star`/`starFilled` toggleFavorite, `ICONS.more` → the ••• menu.
- **••• menu** (`14.png`, w 265): section "Style" — three "Ag" cards (Default blue-tinted active, Serif, Mono) → `updatePage(id,{font})`; divider; toggle rows "Small text", "Full width" (pill switches, persist); divider; rows with right-aligned gray hints: "Move to ⌘⇧P" (toast), "Customize page" (toast), "Lock page" (toggles `locked`; editor obeys); divider; "Add to Favorites"/"Remove from Favorites", "Copy link ⌘⌥L" (clipboard + toast "Copied"), "Duplicate ⌘D" (duplicatePage + open copy), "Open in Mac app" (toast); divider; "Undo ⌘Z" (`document.execCommand('undo')`), "Page history" (toast), "Page analytics" (toast), "Show deleted pages" (→ `ctx.openTrash(anchor)`), "Delete" (deletePage + `ctx.goHome()`); divider; "Import" (→ `ctx.openImport()`), "Export" sub-hint "PDF, HTML, Markdown" (downloads `<title>.md` from blocks HTML via a Blob — strip tags for md); divider; label "Connections", row "Add connections" (toast). Footer hint "Last edited by <name>"? not in shot — omit.
- **share.js** (`15.png`/`25.png`, w 400): header tabs row: "Share" (active) + page chip `icon title`; input "Add people, groups, or emails..." + blue "Invite" (adds chips locally under input; persists to `ms:prefs` key `invites:<pageId>`); divider; row `ICONS.globeMark` "Share to web" + sub "Publish and share link with anyone" + switch. ON expands (`25.png`): URL field `https://mnemosphere.site/<slug>-<id8>` readonly + "Copy web link"; row "Link expires" value "Never" + amber "PLUS" badge; switch rows "Allow editing" (on), "Allow comments" (on), "Allow duplicate as template" (on), "Search engine indexing" (off) — persisted in prefs `shareWeb:<pageId>`; footnote "Set a domain for your public links in Settings"; footer left "Learn about sharing" (`ICONS.question`), right "Copy link".
- **Comments panel** (`15.png` right): 340px right panel slides in; header "Comments"? match shot: empty state centered — `ART.commentsEmpty`, "No open comments yet" (600), "Open comments on this page will appear here" (`--text-2`); composer bottom: avatar letter + input "Add a comment..." Enter appends comment row (name, rel-time, text), persisted `ms:prefs comments:<pageId>`.

- [ ] Tests: setPage(null) shows only workspace name; setPage(page) shows title + "Edited just now"; ••• menu lists every item string above; Lock page → editor flag persisted; share popover renders both toggle states; comment submit renders row.
- [ ] Implement + CSS. Commit `feat: top bar, ••• page menu, share popover, comments panel`.

### Task 12: Page editor

**Files:** Create `src/ui/editor.js`, `src/styles/editor.css`, `tests/editor.test.js`.
**Reference:** `7.png` (doc), `8.png` (new-page state), `13.png` (icon/cover picker).
**Consumes:** store, popover, ICONS, `decor-data.js` (`COVER_PRESETS, ICON_SET, ICON_COLORS, EMOJI`); dynamic `import('./database.js')` and `import('./ai.js')` in try/catch. **Produces:** `mountEditor`.

- Layout: `.ed-scroll` full height; optional `.ed-cover` (h 280, `background-position-y: var(coverPos)%`; hover buttons top-right "Change cover" "Reposition" "Remove" — Reposition enters drag mode adjusting `coverPos`); `.ed-doc` max-width 708px centered (fullWidth: 100% - 96px), fonts per `page.font` (`--font-serif`/`--font-mono`), `smallText` → 14px body.
- Icon 78px overlapping cover by 39px (no cover: sits above title); click → picker (below). Hover ghost row above title (visible on hover only, `--text-3` 14px): "☺ Add icon" (hidden if icon), "🖼 Add cover" (hidden if cover), "💬 Add comment" (→ `ctx.toggleComments`).
- Title: contenteditable h1 40px/700, placeholder "Untitled" (`:empty::before`), Enter moves to body; input → debounce 350ms `updatePage({title})`.
- **Body**: if `blocks` is a database config → delegate whole body to `renderDatabase` (fallback placeholder "Database view" if import fails). Else contenteditable `.ed-body` (16px, line-height 1.5), placeholder "Enter text or type '/' for commands", markdown-ish input rules on space: `-`→bullet `<ul>`, `[]`→`.ed-todo` checkbox div (checkbox clickable, persists), `#`/`##`→h1/h2, `>`→toggle `<details><summary>`; seeded HTML renders as-is (callout div `.ed-callout` gray rounded). Debounced persist. `locked` → `contenteditable=false` + lock banner chip "🔒 Locked".
- **New-page state** (`8.png`) when page has empty title + empty blocks: under the title, gray 16px rows (icon + label, hover `--bg-hover`): "Empty page" (highlighted `--bg-active` first), "Start writing with AI" (sparkle); label "Add new" (12px `--text-3`); "Import" → `ctx.openImport()`, "Templates" → `ctx.openTemplates()`, "Table" / "Board" / "Timeline" / "Calendar" → replace blocks with a fresh database config (2 empty rows; columns Name/title + Tags/select; view layout = the chosen one) and re-render, "••• More" → toast. Any typing in title/body or picking Empty page dismisses the menu.
- **Icon picker** (`13.png`): popover w 408: tab row "Emojis | Icons | Custom" + right "Remove"; Emojis: search "Filter…" + grid of `EMOJI` (28px cells); Icons: `ICON_COLORS` swatch row + grid of `ICON_SET` tinted current color; Custom: input "Paste link to an image..." + blue "Submit", "Upload file" full-width bordered button (FileReader, reject >5MB with toast "Please pick a file under 5 MB"), note lines "Recommended size is 280 × 280 pixels" and "The maximum size per file is 5 MB" + amber "PLUS PLANS" badge.
- **Cover picker**: popover, tabs "Gallery | Link" + "Remove"; Gallery: `COVER_PRESETS` swatch grid with labels; Link: "Paste an image link…" + "Submit". Sets `{cover}` via updatePage.
- Editor `open(pageId)`: renders everything from `getPage`, adds `.show` to `#shell-page`, subscribes to store updates for live title sync; `close()` hides.

- [ ] Tests: open(seeded Getting Started) renders title + first checkbox string "Click anywhere and just start typing"; checkbox click persists checked state into saved HTML; empty page shows all 9 new-page menu strings; choosing Table swaps blocks to `{type:'database'}`; icon picker Custom tab shows both size notes; title edit persists after 400ms fake timers.
- [ ] Implement + CSS. Commit `feat: Notion-style page editor with covers, icons, and new-page menu`.

### Task 13: AI writing surface

**Files:** Create `src/ui/ai.js`, `src/styles/ai.css`, `tests/ai.test.js`.
**Reference:** `9.png` `10.png` `11.png` `12.png`.
**Consumes:** popover, ICONS. **Produces:** `mountAIBar`, `aiProvider`.

- **Bar** (`9.png`): floating white shadowed rounded bar at the top of the doc: `ICONS.ai` purple sparkle + input "Ask AI to write anything..." + right send arrow (`ICONS.send`, purple when text). On focus with empty input → dropdown (w 320): label "Draft with AI" (12px `--text-3`); rows (pencil icons): "Brainstorm ideas...", "Blog post...", "Outline...", "Social media post...", "Press release...", "Creative story...", "Essay...", "··· See more ›"; divider; label "Insert AI blocks"; row "Summary". Row click fills the input ("Brainstorm ideas on ").
- **Streaming** (`11.png`): submit → provider stream types words into a `<ul>` appended to the body; bar becomes status: "AI is writing ⋯" left, right "Try again ↻" + "Stop esc". `aiProvider.generate(prompt)`: async generator yielding words at ~30ms (respect `prefers-reduced-motion`: instant). Canned content: if /brainstorm|idea/i → 10 "Design Thinking"-style bullet ideas keyed off the prompt topic (template: "Create a workshop on <topic> for beginners", "Develop a mobile app that teaches <topic> concepts", …10 variants); /blog|post/i → 3 short paragraphs; /outline/i → numbered outline; else → 2 generic paragraphs.
- **Done state** (`12.png`): generated block gets `.ai-highlight` (blue selection tint `--bg-blue-light`); bar → input "Tell AI what to do next" + below: disclaimer row "AI responses can be inaccurate or misleading. <u>Learn more</u>" + 👍 👎; menu popover: "✓ Done", "✎ Continue writing", "≣ Make longer", "↻ Try again", "✕ Close" + right hint "Escape". Done/Close → persist body via `ctx` callback (mount receives `onCommit(html)`) and destroy; Continue writing/Make longer/Try again re-stream (longer = append 4 more items); Escape key = Close.

- [ ] Tests: menu shows all 8 draft rows; generate('Brainstorm ideas on Design Thinking') with fake timers produces ≥8 `<li>` containing "Design Thinking"; Stop halts mid-stream; Done fires onCommit with the generated HTML.
- [ ] Implement + CSS. Commit `feat: AI writing bar with mock streaming provider`.

### Task 14: Databases-lite + template data

**Files:** Create `src/ui/database.js`, `src/data/templates.js`, `src/styles/database.css`, `tests/database.test.js`, `tests/templates.test.js`.
**Reference:** `19.png` `20.png` `23.png` `24.png`.
**Consumes:** store, popover, ICONS. **Produces:** `renderDatabase`, `TEMPLATES`.

- **Chrome** (top of block): view tabs row (14px: active `--text` + 2px bottom border, inactive `--text-2`; e.g. "⊞ All | Grouped by status | Books | …" with per-layout glyphs) + "+"; right cluster: "Filter" "Sort" (text `--text-2` — only when panel closed match `23.png`: chips), `ICONS.search`, `ICONS.more` (→ **View options panel**), blue "New ▾" button (adds row/card and focuses title cell).
- **Chip bar**: for the active view's filters: chips like "Type ▾" "Score ▾" (`--bg-hover` pills) + "+ Add filter"; chip click → popover listing the column's options; picking sets `view.filters` and re-renders; "Status" style chips per `23.png`.
- **Table view** (`19.png` `24.png`): header row `--text-2` 12px w/ per-kind glyphs (Aa title, ☑, ⌄ select, ★, 📅, 🔗, 👤); rows h 33 bordered `--divider`; cell renderers/editors — title: text + hover "OPEN ↗" affordance opens… (rows are not pages: just inline edit), text/date/url/person: inline `contenteditable`, checkbox: real checkbox left of title col if a checkbox column exists (`19.png` layout), select: colored chip (`--chip-<color>`; empty shows nothing; click → option popover), stars: 5 ★ glyphs filled 0-5 click-to-set; "+ New" footer row; "Calculate ⌄" right-footer `--text-3`. groupBy view: sections per option value with count headers.
- **Gallery view** (`20.png` `23.png`): grid cards (w ~230, border, radius 6, hover shadow): cover strip (first url/image col or icon-glyph placeholder strip), title 14px/600, select chips below; "+ New" ghost card.
- **Board/Timeline/Calendar layouts:** board = columns per select option with cards; timeline/calendar = styled stub (header + "This view is coming soon" ghost) — tabs still switch.
- **View options panel** (`23.png`, right-anchored popover w 290): title "View options"; rows with values right: name input row (pencil), "Layout > Gallery/Table", "Properties > N shown", "Filter > N filters", "Sort > None", "Group > None"; divider; "Lock database", "Copy link to view", "Duplicate view", "Delete view" (red) — Layout row cycles layout; others functional-lite (Duplicate/Delete mutate `views`; rest toast).
- All mutations persist via `updatePage(page.id, {blocks: config})`.
- **templates.js**: `export const TEMPLATES = [...]` — `{id, name, icon, category, description, madeBy:'Mnemosphere', build()}` where `build()` returns page partial(s). Categories/rail order (from `19.png`): Suggested: "To-do list" ✔️, "Projects & tasks", "Projects, tasks & sprints", "Meetings", "Docs"; Design: "Design Sprint", "Design System" 🖌, "Design Portfolio", "User Research Database", "Remote Brainstorming"; Life: "Reading List" 📚, "Habit Tracker", "Simple Budget", "Weekly To-do List", "Travel Planner"; Product management: "1:1 Notes", "Product Wiki", "Product Spec", "Vision and strategy". Rich builds: **To-do list** (the Task-4 To-dos config; description "Simple task management — create, organize, and track your tasks."), **Design System** (`20.png`/`23.png`: views "Design System" gallery / "List View" table / "By Status" table groupBy Status; columns Name title, Status select (Current/green, Needs Update/yellow), Type select; rows: "Accessibility #a11y / Current", "Typography Roboto / Needs Update", "Colors / Current", "Icons / Current 🟡"; description "A design system is a great way to keep everyone aligned. Use this template to document design patterns, assets, and brand, and make assets downloadable for everyone on your team."), **Reading List** (reuse Task-4 config; description "The modern day reading list includes books, articles, podcasts, and videos."). All others: `build()` returns a simple doc page with the template name, icon, and one intro paragraph.

- [ ] Tests: render Reading List config → 5 row titles present; "Books" tab filters to 3; checkbox toggle persists via updatePage (spy store); stars click sets value; gallery layout renders cards; TEMPLATES has all 19 names in the 4 categories; To-do list build returns database blocks.
- [ ] Implement + CSS. Commit `feat: databases-lite (table/gallery/board) + template catalog`.

### Task 15: Search modal

**Files:** Create `src/ui/search.js`, `src/styles/search.css` (tiny — modal styling shared), `tests/search.test.js`.
**Reference:** `16.png`. **Produces:** `openSearch(ctx)`.

- Centered modal w 600, top-aligned (12vh): input row (`ICONS.search` gray + input "Search <workspace name>…" 16px, autofocus); results list grouped by `edited`: "Today", "Past week", "Older" (11px/600 `--text-3` group labels); row: page icon, title 14px, parent name `--text-3` right?, selected row `--bg-hover` + right `⏎` enter-glyph badge (`16.png`); ↑/↓ move selection (wraps), Enter → `ctx.openPage(id)` + close, ⌘Enter same (new-tab is N/A); footer bar (border-top, 12px `--text-3`): "↑↓ Select   ↵ Open   ⌘↵ Open in a new tab". Empty query → recent pages by edited desc (max 8). Uses `searchPages`.

- [ ] Tests: shows seeded pages on open; typing "Reading" filters to Reading List; ArrowDown+Enter calls `ctx.openPage`; footer hints exact.
- [ ] Implement. Commit `feat: ⌘K search modal`.

### Task 16: Updates popover

**Files:** Create `src/ui/updates.js`, `src/styles/updates.css`, `tests/updates.test.js`.
**Reference:** `17.png`. **Produces:** `openUpdates(anchor, ctx)`.

- Popover w 420 anchored to the sidebar row: header tabs "Inbox" (active, 2px underline) "Archived" "All" + `ICONS.info`; right `ICONS.gear` (→ `ctx.openSettings('notifications')`); body empty state: `ART.inboxEmpty` (~96px), "You're all caught up" (14px/600), "When someone @mentions you, replies to your comments, or invites you to a page, you'll be notified here" (13px `--text-2`, centered, max-w 260). Tabs switch (all empty states identical for now).

- [ ] Tests: exact copy of the three strings; tab switch toggles active class; gear calls openSettings with 'notifications'.
- [ ] Implement. Commit `feat: updates inbox popover`.

### Task 17: Settings modal

**Files:** Create `src/ui/settings.js`, `src/styles/settings.css`, `tests/settings.test.js`.
**Reference:** `18.png`. **Consumes:** store, theme, popover, ICONS. **Produces:** `openSettings(ctx, panel)`.

- Modal 1150×max(80vh) two-pane. **Left nav** (w 240, `--bg-sidebar`): account email header (12px `--text-3`), rows: "My account" 👤-icon, "My notifications & settings" 🔔, "My connections" ⤴, "Language & region" 🌐; section label "Workspace"; rows: "Settings" ⚙, "Members" 👥, "Upgrade" ↗, "Billing" 💳, "Security" 🛡, "Identity & provisioning" 🪪, "Connections" ⤵. Active row `--bg-active`.
- **Panel: My notifications & settings** (default, matches `18.png`): H "My notifications"; toggle rows (title 14px + sub 12px `--text-2` + right switch): "Mobile push notifications — Receive push notifications on mentions and comments via your mobile app" (on), "Email notifications — Receive email updates, including mentions and comment replies" (on), "Always send email notifications — Receive emails about activity in your workspace, even when you're active on the app" (off); H "My settings"; row "Appearance — Customize how Mnemosphere looks on your device" + **dropdown (Light / Dark / Use system) → `setTheme()`**; row "Open on start — Choose what to show when Mnemosphere starts or when you switch workspaces" + dropdown "Last visited page / Home"; row "Open links in desktop app — You must have the Mac or Windows app installed" + switch (off); H "Privacy"; row "Cookie settings — See Cookie Notice for details" + link "Customize ›" (toast); row "Show my view history — People with edit or full access will be able to see when you've viewed a page. Learn more" + dropdown "Record". All toggles/dropdowns persist to prefs (`notifPush`, `notifEmail`, `notifAlways`, `startPage`, `openDesktop`, `viewHistory`).
- **Panel: My account**: avatar circle + "Upload photo" (updates session avatar), "Preferred name" input (updates session + workspace name suffix stays), "Password" section with "Change password" button (toast). Other 9 nav items → stub panel: H = item name + row "These settings are coming soon."

- [ ] Tests: nav renders all 11 items; default panel shows the three notification row titles; Appearance select→'dark' flips `document.documentElement.dataset.theme`; prefs persist.
- [ ] Implement. Commit `feat: settings modal with working appearance + notification prefs`.

### Task 18: Templates gallery modal

**Files:** Create `src/ui/templates-modal.js`, `src/styles/templates.css`, `tests/templates-modal.test.js`.
**Reference:** `19.png` `20.png`. **Consumes:** `TEMPLATES` (`../data/templates.js`), store, popover. **Produces:** `openTemplates(ctx)`.

- Modal 1150×80vh two-pane. **Left rail** (w 240): search input "Search templates" (filters rail), dropdown chip "👤 All templates ⌄" (static), category labels (11px/600 `--text-3`) + template rows (icon + name, active `--bg-active`) in the exact Task-14 order. **Right pane**: scrollable preview rendering the template's build output — title with icon, for database templates a static mini table/gallery mirroring `19.png`/`20.png` (reuse simple markup, not the live database module); bottom-docked card (border-top, white): template icon + name (16px/600), description 13px `--text-2`, right: blue "Get template" button + "Made by Mnemosphere" logo line (12px `--text-3`). Get template → `build()` pages created via store (top-level), `ctx.openPage(first.id)`, close.

- [ ] Tests: rail lists all 19 templates under 4 category labels; clicking "Design System" swaps preview title; Get template creates page(s) and calls openPage.
- [ ] Implement. Commit `feat: templates gallery modal`.

### Task 19: Import modal

**Files:** Create `src/ui/import-modal.js`, `src/styles/import.css`, `tests/import-modal.test.js`.
**Reference:** `21.png`. **Produces:** `openImport(ctx)`.

- Modal w 690: header "Import" (16px/600) + right link "ⓘ Learn about importing" (`--text-3`, toast); 3-column grid of bordered cards (h 52, radius 4, hover `--bg-hover`): each = 20px brand mark (simple original geometric SVGs inline in this module: Evernote elephant-ish silhouette, Trello two-bars board, Asana three dots, Confluence waves, "Aa" for Text & Markdown, table-grid for CSV, `</>` for HTML, "W" doc for Word, Docs page for Google Docs, open-box for Dropbox Paper, "Q" for Quip, bullet-tree for Workflowy) + label 14px. "Evernote" card carries a right sub-note "Get $5 in credit" (11px `--text-2`). Text & Markdown / CSV / HTML → hidden file input (`.md,.txt` / `.csv` / `.html`): md/txt → new page titled from filename, body = escaped text with line breaks (md: `#`→h1, `##`→h2, `- `→li minimal transform); csv → new page with a database config (first row = columns, all text kind); html → body = sanitized (strip `<script`) file HTML. Then `ctx.openPage(new.id)` + close + toast "Imported". Other 9 cards → toast "Coming soon".

- [ ] Tests: renders all 12 labels + "$5" note; mock md file import creates page with h1; csv import creates database blocks; Trello click toasts.
- [ ] Implement. Commit `feat: import modal with real md/csv/html import`.

### Task 20: Teamspace modal

**Files:** Create `src/ui/teamspace-modal.js`, `src/styles/teamspace.css`, `tests/teamspace.test.js`.
**Reference:** `22.png`. **Produces:** `openTeamspace(ctx)`.

- Modal w 460: top illustration `ART.trioAvatars` centered above a headline "Create your first teamspace to start using Mnemosphere with your teammates" (bold, but match `22.png`: small header row with the avatars + ✕ close, then content) — anatomy per shot: gray banner strip w/ avatars + headline 13px + ✕; body: centered 64px icon tile (letter "T" or first letter of typed name, `--chip-gray`) + caption "Choose icon" (click cycles a few emoji options); label "Teamspace name" + input placeholder "Acme Labs" + sub "Teamspaces are where your team organizes pages, permissions, and members" (12px `--text-3`); label "Description (optional)" + textarea placeholder "Details about your teamspace"; row `ICONS.teamspace` "Everyone at <workspace name> and new members will have access to this teamspace" (12px); footer: left "ⓘ Learn about teamspaces" (toast), right blue "Create teamspace" disabled until name → `addTeamspace` + toast "Teamspace created" + close. (Sidebar picks up teamspaces via its store subscription — sidebar Task 10 renders a "Teamspaces" section label + row per teamspace above the second group when `getWorkspace().teamspaces.length > 0`.)

- [ ] Tests: button disabled → typing enables; create calls `addTeamspace` with name/description; icon tile shows first letter live.
- [ ] Implement. Commit `feat: create-teamspace modal`.

---

## Phase C — Integration (sequential, main tree)

### Task 21: Merge + full wiring in `main.js`/`app.js`

**Files:** Modify `src/main.js`, `src/app.js`; merge all Phase B branches first (disjoint files — resolve none).

- [ ] Merge every Phase B branch; `npx vitest run` → all green; `npm run build` → clean.
- [ ] `main.js`: import every stylesheet; boot: `initTheme()` → session check → `mountAuth(root, {onComplete})` when signed out/un-onboarded; onComplete → `seedWorkspace` (if fresh) → `location.hash=''` → `mountApp(root)`.
- [ ] `app.js`: build the real `ctx` (all functions per canonical interface — `openPage` opens editor + `topbar.setPage` + `sidebar.setActivePage` + `globe.focusPage`; `goHome` closes editor + `clearFocus` + `topbar.setPage(null)`; `logOut` → `auth.logOut()` + re-mount auth). Mount sidebar/topbar/editor/comments; globe `onOpenPage` → `ctx.openPage`. Global keys: ⌘K → openSearch (and plain `/` when no editable focused), Esc → close page (when no popover open — popover module already eats Esc first via its own listener). First-run tooltip appears after mount (sidebar owns it).
- [ ] Editor's dynamic imports now resolve; delete its fallbacks' "if missing" logging.
- [ ] Manual dev-server pass of the full loop: fresh profile (clear localStorage) → signup → code → profile → use case → about → "Getting ready…" → workspace with globe + seeded sidebar → open Getting Started → checklist renders → new page → menu → Table → database renders → AI flow → search → updates → settings (dark mode flips live) → share → templates → import md → teamspace → trash restore → log out → log in.
- [ ] `npx vitest run` + `npm run build`. Commit `feat: wire the full app shell — auth gate, surfaces, globe home`.

### Task 22: Globe ↔ store live-sync polish

**Files:** Modify `src/globe/globe.js`.

- [ ] Verify (dev server): creating a top-level page adds a hub live; adding a sub-page adds an orbiting dot; deleting removes; restore returns them; "Clear templates" collapses the globe to one hub without errors; dot click opens the right page; Esc returns and the hub is focused.
- [ ] Fix whatever the pass surfaces (rebuild-on-event edge cases, disposed material reuse). Add regression tests in `tests/globe-data.test.js` for `buildGraphFromPages` determinism after add/delete.
- [ ] `npx vitest run`. Commit `fix: globe live-sync with store mutations`.

### Task 23: Dead-code sweep

**Files:** Delete leftovers; modify `README.md`, `DESIGN_SPEC.md` note.

- [ ] Confirm `src/styles.css`, old root `src/nodes.js`/`src/decor-data.js` copies are gone; `git grep -n "mnemo:"` → no hits in `src/`; `git grep -n "Notion"` in `src/` → no user-visible hits (comments referencing the design source are fine).
- [ ] README: update run instructions + one-paragraph description of the new architecture. DESIGN_SPEC.md: prepend a note that UI chrome is now specced by `docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md`.
- [ ] `npm run build` + `npx vitest run`. Commit `chore: remove legacy UI code, update docs`.

### Task 24: Visual fidelity loop

**Run from the main session (browser tooling).** For each surface: open it in the dev server, screenshot, compare side-by-side against its reference PNG, list deviations (spacing, size, color, weight, missing affordances), fix, re-shoot. Coverage checklist (reference → surface):

- [ ] `1.png` signup · `2.png` code step · `3.png` profile · `4.png` use case · `5.png` getting-ready · `6.png` about
- [ ] `7.png` workspace + sidebar + tooltip + Getting Started doc · `8.png` new-page menu
- [ ] `9–12.png` AI states · `13.png` icon picker + cover · `14.png` ••• menu
- [ ] `15.png` share + comments · `25.png` share expanded · `16.png` search · `17.png` updates
- [ ] `18.png` settings **in dark mode** (flip Appearance first — also proves theming)
- [ ] `19.png`/`20.png` templates modal · `21.png` import · `22.png` teamspace · `23.png` Design System gallery + view options · `24.png` Reading List table
- [ ] Sample exact pixel colors from the PNGs for any token that reads off; adjust `tokens.css` only.
- [ ] Final `npx vitest run` + `npm run build`; commit per fix batch `polish: match <surface> to reference`.

---

## Self-review notes

- Spec coverage: every spec section maps to a task (auth→9, sidebar/trash→10, topbar/share/comments→11, editor/pickers→12, AI→13, databases+templates data→14, search→15, updates→16, settings/theming→2+17, templates modal→18, import→19, teamspace→20, globe-home→8+22, theming tokens→2, seed→4, verification→24, error handling→4/5/6 guarded-storage + 12 file-size cap).
- Interface names are pinned once under "Canonical interfaces"; tasks reference those exact names.
- Reposition/coverPos, locked, font/smallText/fullWidth flow topbar→store→editor consistently.
