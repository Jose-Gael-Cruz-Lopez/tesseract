# Mnemosphere · Notion-fidelity UI/UX redesign — Design Spec

**Date:** 2026-07-08
**Reference material:** the 25 screenshots in `inspired design/` (`1.png` … `25.png`).
The goal is to replicate their layout, spacing, color, and component design as
faithfully as the source images allow — rebranded to Mnemosphere, with original
assets (no Notion logo or illustration files are copied; illustrations are
redrawn in a similar ink-sketch spirit).

## Decisions (settled with the user)

1. **Globe becomes the Home view.** The Notion-style sidebar + page editor
   replace the current UI; the 3D globe remains the main content view when no
   page is open.
2. **Light + dark themes with a toggle.** Light is pixel-faithful to the
   screenshots; dark matches screenshot `18.png`. Settings → Appearance drives
   it (Light / Dark / Use system).
3. **Mnemosphere branding, Notion's design.** Identical layout/spacing/colors;
   "Mnemosphere" name, our own simple logo mark, original ink-style
   illustrations.
4. **Everything in the screenshots gets built** — search, updates, settings,
   share, templates, import, teamspace, AI menu — real UI with local/stub
   behavior where a backend would be required.
5. **Full mock auth gate.** First visit lands on Sign up; mock logic end to
   end; local session; Supabase-shaped API seam for later.
6. **Notion-style default workspace** after onboarding: Getting Started,
   Quick Note, Personal Home, Task List, Journal, Reading List — each with a
   few themed sub-pages so the globe has orbiting nodes.

## Approach

Vanilla ES modules on the existing Vite stack. No new dependencies. The
three.js globe code moves to `src/globe/` nearly untouched; new UI is
imperative DOM in focused modules; theming via CSS custom properties.

## File structure

```
src/
  main.js                 boot: session check → auth screens OR app shell
  globe/
    globe.js              scene, physics, drag, intro (moved from main.js)
    nodes.js              tesseract nucleus (existing)
    decor-data.js         cover/icon preset data (existing)
  data/
    store.js              page-tree model + localStorage + change events
    seed.js               default workspace pages/content
    templates.js          template definitions (To-do list, Design System, Reading List, …)
  auth/
    auth.js               mock session API (signUp, verifyCode, logIn, logOut, getSession)
    auth-view.js          sign up, code, welcome, use-case, about-you, log in screens
  ui/
    icons.js              inline SVG icon set
    illustrations.js      original ink-style SVG illustrations
    theme.js              theme application + system listener
    popover.js            shared anchored popover / modal helpers
    sidebar.js            workspace header, nav rows, page tree, footer
    topbar.js             breadcrumb, edited, share, comments, star, ••• menu
    editor.js             title/blocks/cover/icon, new-page state, pickers
    database.js           mini database block: table + gallery views
    ai.js                 AI bar, draft menu, mock streaming writer
    search.js             ⌘K modal
    updates.js            inbox popover
    settings.js           settings modal
    share.js              share popover + comments panel
    templates-modal.js    template gallery
    import-modal.js       import grid (md/csv/html real, rest stubbed)
    teamspace-modal.js    create-teamspace modal
    trash.js              trash popover
  styles/
    tokens.css            light + dark custom properties
    base.css  auth.css  sidebar.css  editor.css  modals.css  database.css  globe.css
```

`index.html` is reduced to mount points; all chrome is built by modules.

## Data model & persistence

Single page tree; every node is a **page**:

```js
{ id, title, icon,            // icon: {type:'emoji'|'icon'|'image', value, color?}
  cover,                      // {type:'preset'|'link', value} | null
  blocks,                     // editor HTML string, or {type:'database', ...} config
  parentId,                   // null = top-level (globe hub)
  edited, created,            // timestamps
  favorite: bool, deleted: bool }
```

- Top-level pages = globe hubs. Children = leaf dots. Grandchildren = branch
  dots. Deeper nesting works in the sidebar but adds no dots.
- Delete → Trash (`deleted: true`, restorable). Delete forever removes.
- Workspace: `{ name: "<FirstName>'s Mnemosphere", ownerEmail, teamspaces: [] }`.
- Storage namespace `ms:*` (`ms:session`, `ms:profile`, `ms:workspace`,
  `ms:pages`, `ms:prefs`). Old `mnemo:*` keys are ignored (clean start).
- `store.js` emits events (`page-added`, `page-updated`, `page-deleted`,
  `page-restored`, `workspace-updated`); sidebar, globe, editor, search all
  subscribe. One source of truth.
- localStorage wrapped in try/catch with in-memory fallback (private mode).

## Auth + onboarding (screens: `1–6.png`)

Hash routes: `#/signup`, `#/login`, `#/onboarding/profile`,
`#/onboarding/usecase`, `#/onboarding/about`. No session → redirect to signup.

1. **Sign up** (`1.png`): logo mark + "Mnemosphere" wordmark top-left. Centered
   ~320px column: big bold "Sign up" heading; "Work email" mini-label; input
   with placeholder and blue focus ring; salmon "Continue with email" button;
   "You can also continue with SAML SSO" underlined link (toast: coming soon);
   spaced divider; "Continue with Google" / "Continue with Apple" outlined
   buttons with logos (toast: coming soon); small gray legal footer with
   underlined links.
2. **Code step** (`2.png`): email shown as filled input with ✕ clear icon;
   helper copy ("We just sent you a temporary sign up code…"); "Sign up code"
   label; "Paste login code" input; salmon "Create new account" button. Any
   non-empty code passes (mock).
3. **Welcome** (`3.png`): warm cream background; "Welcome to Mnemosphere"
   heading + "First things first, tell us a bit about yourself."; gray avatar
   circle + "Add a photo" (real file upload → profile, stored as data URL);
   "What should we call you?" input (placeholder "e.g. Ada Lovelace, Ada, AL");
   "Set a password" input with reveal toggle; blue Continue disabled until name
   + password valid; footer "You're creating an account for <email>" +
   "log in with another email" link (returns to signup); original ink character
   bottom-left.
4. **Use case** (`4.png`): "How are you planning to use Mnemosphere?" +
   subtitle; three selectable cards (For my team / For personal use / For
   school) with original line-art illustrations, radio circle top-right,
   selected ring; blue Continue.
5. **About you** (`5.png`, `6.png`): "Tell us about yourself" + subtitle; three
   dropdowns (kind of work / role / planning to do — multi); blue Continue +
   "Skip" link. Continue/Skip → dimmed form + white "Getting ready…" spinner
   toast (~1.5 s) → seed workspace → app.
6. **Log in**: mirrors Sign up with "Log in" heading (email → code → in).
   Log out (sidebar workspace menu) clears session → signup.

`auth.js` exposes async `signUp(email)`, `verifyCode(email, code)`,
`logIn(email)`, `logOut()`, `getSession()`, `updateProfile(p)` — mock
implementations today, Supabase later without touching views.

## App shell

### Sidebar (screens: `7.png`, `8.png`)

240 px, bg token (light `#fbfbfa`). Top to bottom:

- **Workspace header**: 20px rounded letter-avatar, truncated workspace name,
  hover-revealed «» collapse control. Click name → menu: workspace name, owner
  email, Log out.
- **Nav rows**: Search (opens ⌘K modal), Updates (popover), Settings & members
  (modal). Gray icons left, ~14px labels.
- **Favorites group** (only when ≥1 page starred).
- **Page tree**: rows ~27px; twisty chevron (rotates when open), page icon
  (emoji or doc glyph), name, hover-revealed ＋ (add sub-page) and •••
  (Delete, Duplicate, Copy link, Rename) on the right; active row highlighted;
  inline rename field; nesting indents.
- **"+ Add a page"** row.
- **Second group**: Create a teamspace, Templates, Import, Trash (popover:
  search field, deleted pages with restore ↩ and delete-forever 🗑 actions).
- **Footer**: pinned "New page" row with pencil-square icon.
- Collapse: «» hides sidebar (⌘\ kept); floating »-style reopen button.
- First-run tooltip next to the tree (from `7.png`): "Here are some templates
  to help you get started" with OK / Clear templates buttons. OK dismisses;
  Clear templates deletes the seeded starter pages, leaving one empty
  "Getting Started". Shown once (`ms:prefs`).

### Top bar (screens: `7.png`, `14.png`, `15.png`)

45 px: breadcrumb (workspace name → page icon + title; truncation); right side:
"Edited <relative time>", **Share** (popover), 💬 comments (right panel),
☆ star (Add to Favorites), ••• menu with exactly screenshot `14.png`'s items:
Style (Default/Serif/Mono "Ag" pickers) · Small text toggle · Full width toggle
· Move to · Customize page · Lock page (makes editor read-only) · Add to
Favorites · Copy link · Duplicate · Open in Mac app (toast) · Undo · Page
history (toast) · Page analytics (toast) · Show deleted pages (opens Trash) ·
Delete · Import · Export (downloads page as Markdown) · Connections: Add
connections (toast). Keyboard hints rendered right-aligned.

When the globe (Home) is showing: breadcrumb shows only the workspace name;
right side shows nothing page-specific.

### Page editor (screens: `7.png`, `8.png`, `13.png`)

- Hover ghost row above the title: Add icon · Add cover · Add comment.
- Title: ~40px bold contenteditable, placeholder "Untitled".
- Cover: full-width ~280px; hover buttons Change cover / Reposition (drag
  vertical offset) / Remove. Picker restyled to `13.png`.
- Icon: 78px, overlaps cover midline. Picker: tabs **Emojis | Icons | Custom**
  + right-aligned Remove; Custom tab: "Paste link to an image…" input + blue
  Submit, "Upload file" button, "Recommended size is 280 × 280 pixels", "The
  maximum size per file is 5 MB" + PLUS PLANS badge (visual).
- **New-page state** (`8.png`): under the title — "Empty page" (highlighted),
  "Start writing with AI"; "Add new" label; Import, Templates, Table, Board,
  Timeline, Calendar, ••• More. Empty page → editor; AI → AI bar; Table/Board/
  Timeline/Calendar → database block in that view (board/timeline/calendar
  render as styled stub layouts with real data rows); Import/Templates open
  those modals.
- Body: contenteditable with markdown-ish shortcuts — `- ` bullets, `[] `
  checkboxes (clickable), `# `/`## ` headings, `> ` quote, toggle blocks
  (details/summary) for seeded content. Inline code styling for seeded
  "however" chip look. Placeholder text when empty.
- Autosave (debounced 350 ms) → store; "Edited just now" updates.

## AI writing (screens: `9–12.png`)

- "Ask AI to write anything…" bar with sparkle icon; focus opens **Draft with
  AI** dropdown: Brainstorm ideas…, Blog post…, Outline…, Social media post…,
  Press release…, Creative story…, Essay…, See more ›; "Insert AI blocks":
  Summary….
- Typed prompt + purple send arrow → **mock streaming**: canned,
  keyword-matched content typed word-by-word into the page; "AI is writing ⋯"
  chip with Try again ↻ / Stop esc.
- Done: generated block gets blue selection highlight; "Tell AI what to do
  next" input + disclaimer "AI responses can be inaccurate or misleading ·
  Learn more" + 👍👎; menu: ✓ Done, ✎ Continue writing, ≡ Make longer, ↻ Try
  again, ✕ Close (Escape).
- `ai.js` provider interface (`generate(prompt) → async token stream`) so a
  real LLM can replace the mock.

## Databases-lite (screens: `19.png`, `20.png`, `23.png`, `24.png`)

A `{type:'database'}` block with:

- **View tabs** (e.g. "All | Grouped by status | Books | …" / "Design System |
  List View | By Status") + "+" tab.
- **Chip bar**: filter chips (Type, Score, Status…), "+ Add filter"; chips
  open a small stub menu.
- **Table view**: columns typed text / checkbox / select (colored status
  chips: gray "Not started", blue "In progress", green "Done") / star rating /
  date / url; editable cells; "+ New" row; Calculate footer.
- **Gallery view**: cards with image strip, title, status chip; "+ New" card.
- **View options panel** (right, from `23.png`): Layout, Properties "2 shown",
  Filter, Sort, Group, Lock database, Copy link to view, Duplicate view,
  Delete view (rows render; sub-panels stubbed).
- Blue **New** button top-right.
- Seeded template data reproduces: **To-dos** table (`19.png`), **Reading
  List** page — cover, intro copy with 💡/🔥 tips, tabbed table (`24.png`),
  **Design System** gallery (`20.png`, `23.png`).

## Secondary surfaces

- **Search ⌘K** (`16.png`): centered modal over scrim; input "Search
  <workspace>…"; live results over titles + body text grouped Today / Past
  week / Older; rows: icon, title, ↵ badge on selection; ↑↓/↵/⌘↵ keyboard nav;
  footer hint bar.
- **Updates** (`17.png`): popover; tabs Inbox | Archived | All + ⓘ; original
  envelope illustration; "You're all caught up" + explainer copy; gear icon.
- **Settings** (`18.png`): ~1150×700 modal; left nav — account section (email,
  My account, My notifications & settings, My connections, Language & region)
  + Workspace section (Settings, Members, Upgrade, Billing, Security, Identity
  & provisioning, Connections). Panels: **My notifications & settings** fully
  working (toggle rows persist; **Appearance** dropdown Light/Dark/Use system
  drives the theme; Open on start; Cookie settings / view-history rows);
  **My account** (name, avatar, password — mock). Other panels are light
  stubs with headings.
- **Share** (`15.png`, `25.png`): popover under Share: header "Share <icon>
  <title>"; "Add people, groups, or emails…" + blue Invite (adds local chips);
  "Share to web" toggle → expands: fake public URL
  (`mnemosphere.site/<slug>-<id>`) + Copy web link, "Link expires · Never"
  (PLUS badge), Allow editing / Allow comments / Allow duplicate as template /
  Search engine indexing toggles, "Set a domain…" note; footer Copy link.
- **Comments panel**: right side panel; empty state "No open comments yet";
  simple composer; comments persist per page.
- **Templates** (`19.png`, `20.png`): full gallery modal; left rail: search,
  "All templates" dropdown, Suggested / Design / Life / Product management
  categories exactly as screenshotted; right: live preview built from template
  seed data; footer card: name, description, blue **Get template** (creates
  the pages for real), "Made by Mnemosphere".
- **Import** (`21.png`): modal grid of 12 source cards with simplified original
  marks (Evernote "+$5 credit" note, Trello, Asana, Confluence, Text &
  Markdown, CSV, HTML, Word, Google Docs, Dropbox Paper, Quip, Workflowy);
  Text & Markdown / CSV / HTML open a file picker and really import into new
  pages; others toast "coming soon"; "Learn about importing" top-right.
- **Teamspace** (`22.png`): modal: three ink avatars header + copy; letter
  icon chooser; Teamspace name; Description (optional); members-access row;
  "Learn about teamspaces"; Create teamspace disabled until named → adds a
  "Teamspaces" sidebar section with the new group.

## Theming

`tokens.css` custom properties, light values sampled from the screenshots,
dark from `18.png` (approx.): bg `#ffffff`/`#191919`; sidebar `#fbfbfa`/
`#202020`; text `#37352f`/`#e8e8e6` with 65%/45% secondary opacities; blue
accent `#2383e2`; salmon CTA bg/text; borders `rgba(55,53,47,0.09)`; hover
`rgba(0,0,0,0.04)`; shadows for popovers/modals. `data-theme` attribute on
`<html>`; "Use system" follows `prefers-color-scheme` live. The globe canvas
stays deep-space dark (`#060310`) in both themes. Exact values are sampled
from the PNGs during implementation.

## Globe as Home

- After login, content area = globe; sidebar + top bar frame it.
- Globe reads hubs/leaves/branches from the store and updates live on
  add/delete/restore (existing rebuild functions, re-pointed at store events).
- Clicking a dot or sidebar row opens the page view over the globe and focuses
  its hub; Esc / breadcrumb-workspace click closes back to the globe.
- All existing physics, hub drag, intro reveal, and reduced-motion behavior
  kept.

## Error handling

- localStorage try/catch + in-memory fallback; quota-safe (covers/icons as
  data URLs are size-capped ~1 MB with a friendly toast).
- Clipboard API guarded with fallback (`document.execCommand`).
- Popovers clamp to viewport (existing pattern), close on outside
  click/Escape.
- `prefers-reduced-motion` disables auto-rotate/streaming-typewriter effects.

## Verification

- Dev server + browser automation: capture each surface and compare
  side-by-side with the matching `inspired design/*.png`; iterate spacing/
  colors until they match.
- Manual click-through: signup → code → welcome → use-case → about → getting
  ready → workspace → every modal/popover → log out → log in.
- Reload persistence checks (pages, theme, session, favorites, trash).
