# Canopy Sub-project C — Developer Mode + Dev Sphere — Design Spec

**Date:** 2026-07-09
**Parent design:** `docs/superpowers/specs/2026-07-09-canopy-developer-mode-design.md`
**Depends on:** sub-project A (canopy in `canopy/`, deployable). Folds in
sub-project **D** (the auth bridge).

## Goal

A **developer mode** in Mnemosphere: a second "developer sphere" (distinct from
the knowledge globe) that visualizes a repo's canopy context — Docs, Roadmap,
Feed, Triage, My Work — read live from canopy. **Read-only** this cycle.

## Decisions (settled with the user)

1. **Globe mapping — categories as hubs.** Core = the repo. Hubs = **Docs ·
   Roadmap · Feed · Triage · My Work**. Each hub's orbiting dots = the items in
   it (each doc, each milestone, each feed entry, each triage item, each My-Work
   item). Click a dot → that item's read-only dev page.
2. **Mode switch — sidebar workspace switcher.** The sidebar workspace-header
   menu gains "Knowledge / Developer" (active one checked); switching swaps the
   globe *and* the sidebar.
3. **Scope — read-only first.** The dev sphere only READs canopy (only `GET`s).
   No promote/triage write-back (a later cycle). Identity stays split:
   Google/Supabase for Mnemosphere, a canopy token for the dev data.

## Two halves

### Half 1 — Canopy auth bridge (in `canopy/`)

The read routes (`GET /docs`, `/doc/:slug`, `/feed`, `/roadmap`,
`/me/dashboard`, `/needs-triage`, `/search`) are session-cookie gated with no
CORS; canopy's bearer tokens currently authorize only `/mcp`. So a cross-origin
dev sphere can't read them yet. The bridge:

1. **CORS** for allowed origins via a new `CORS_ORIGINS` env var (comma-separated;
   e.g. `http://localhost:5173,https://<mnemosphere-prod>`). Emit
   `Access-Control-Allow-Origin` (echo the matching origin),
   `Access-Control-Allow-Headers: authorization,content-type`,
   `Access-Control-Allow-Methods: GET,OPTIONS`, and answer `OPTIONS` preflight
   `204`. **Only `GET`/`OPTIONS` are allowed cross-origin** — the browser blocks
   any cross-origin write, keeping read-only enforced at the boundary without
   changing the write routes' own auth.
2. **Bearer on reads:** in `sessionGate`, when there is no valid session cookie
   (and no `DEV_LOGIN`), fall back to `resolveBearerPrincipal(request, env)` (a
   `canopy_mcp_` token) before returning 401. A valid bearer becomes the
   principal, so the read routes work with `Authorization: Bearer <token>`.
3. **Tests** (canopy vitest): an `OPTIONS` preflight from an allowed origin
   returns the CORS headers; a disallowed origin gets none; a bearer token
   authorizes `GET /docs` (200) while a bad/absent one 401s.

`CORS_ORIGINS` is added to `Env` and documented in `canopy/SETUP.md` (+ the
`POST /auth/mcp-token` "mint a token" step).

### Half 2 — Mnemosphere developer mode

**Mode state.** `mode: 'knowledge' | 'developer'` in `ms:prefs` (default
`knowledge`). The app shell reads it at mount and on change.

**Switch UI.** The sidebar workspace-header popover (today: name, email, log out)
gains a "Switch mode" group: **Knowledge** / **Developer**, the active one
checked. Selecting a mode persists it and re-mounts the shell for that mode.

**Developer settings.** A new "Developer" panel (in the settings modal) with two
fields — **Canopy URL** and **Access token** — stored in `ms:prefs`
(`dev.canopyUrl`, `dev.canopyToken`). A "Test connection" button calls
`canopy-api.getMe()` and reports ok / unauthorized / unreachable. Switching to
Developer mode while unset opens this panel (a connect prompt).

**`src/dev/canopy-api.js`.** Thin read client. Exports:
`isConfigured()`, `getMe()`, `getDocs()`, `getDoc(slug)`, `getFeed()`,
`getRoadmap()`, `getDashboard()`, `getTriage()`, `search(q)`. Each does
`fetch(url + path, { headers: { Authorization: 'Bearer ' + token } })`, returns
parsed JSON, and normalizes failure to a typed result (`{ ok, status, data }` or
throws a tagged error) so the UI can show "not connected / unauthorized /
offline". URL + token come from prefs.

**`src/dev/dev-graph.js`.** Maps canopy DTOs → the globe graph shape (the same
`{ hubs: [{ page, dir, dist, scale, accent, leaves }] }` the knowledge builder
produces, where each `page` is a synthetic node `{ id, title, icon, devKind,
devRef }`). Builds: core = repo; hubs = the five categories; leaves = items
(`getDocs` → Docs leaves, `getRoadmap().milestones` → Roadmap leaves,
`getFeed` → Feed leaves, `getTriage` → Triage leaves, `getDashboard` → My Work
leaves). Deterministic placement seeded by category/item id (reuse the knowledge
builder's fibonacci + seeded-RNG helpers).

**Globe provider injection (the one real refactor).** `initGlobe(container,
hooks, provider)` gains a `provider = { getGraph(): Promise<Graph>,
subscribe(cb): () => void }`. The **knowledge provider** wraps the store
(`getGraph` = `buildGraphFromPages(getPages())`; `subscribe` = `onStore('pages')`)
— today's behavior, unchanged. The **developer provider** wraps `canopy-api` +
`dev-graph` (`getGraph` fetches + maps; `subscribe` is a manual refresh, no live
events). `getGraph` being async means the initial build awaits the fetch (a
loading state on the canvas until it resolves). The knowledge path must stay
behaviorally identical — its 406 tests are the guardrail.

**Dev page viewer** (`src/dev/dev-page.js`). Clicking a dev node (globe or
sidebar) opens the shell page panel as a **read-only** renderer of that canopy
item: a doc (`getDoc(slug)` → markdown body), a feed entry, a milestone, or a
triage item. Markdown → sanitized HTML via a small renderer (add `marked` +
`dompurify` as dev-only deps, or reuse a minimal renderer — decided in the plan;
both are already canopy deps). The top bar shows the item title + a "Open in
canopy" link (to the canopy URL). No editing controls.

**Sidebar in dev mode.** The same sidebar tree UI, its data source swapped to the
dev categories + items (Docs/Roadmap/Feed/Triage/My Work as groups, items as
rows). Clicking a row opens the dev page + focuses the globe hub. The knowledge
sidebar is unchanged.

## Architecture / file map

```
canopy/                             (Half 1 — bridge)
  src/cors.ts            (new)      CORS middleware + OPTIONS
  src/auth/principal.ts  (edit)     sessionGate: cookie → DEV_LOGIN → bearer → 401
  src/env.ts             (edit)     + CORS_ORIGINS
  src/index.ts / routes.ts (edit)   wire CORS
  test/cors.test.ts, test/auth-bearer-read.test.ts (new)

src/dev/                            (Half 2 — Mnemosphere)
  canopy-api.js          (new)      read client
  dev-graph.js           (new)      canopy DTOs → globe graph
  dev-page.js            (new)      read-only item viewer
  dev-sidebar.js         (new)      sidebar tree from canopy categories
src/globe/globe.js        (edit)    provider injection (knowledge path unchanged)
src/app.js                (edit)    mode branch: mount knowledge vs developer provider + sidebar
src/ui/sidebar.js         (edit)    workspace-header menu: mode switch
src/ui/settings.js        (edit)    Developer settings panel
src/data/store.js         (edit)    prefs: mode, dev.canopyUrl, dev.canopyToken
src/styles/dev.css        (new)     dev-mode chrome (loading, connect prompt, viewer)
tests/canopy-api.test.js, tests/dev-graph.test.js, tests/dev-mode.test.js (new)
```

## Data flow

Developer mode active → app mounts the developer provider → `initGlobe` awaits
`provider.getGraph()` → `canopy-api` GETs `/docs`,`/roadmap`,`/feed`,
`/needs-triage`,`/me/dashboard` (bearer + CORS) → `dev-graph` maps to hubs+leaves
→ globe renders. Clicking a node → `dev-page` GETs the item → renders markdown.
Sidebar mirrors the same categories/items.

## Error handling

- Not configured (no URL/token) → Developer mode shows the connect prompt, no
  fetches.
- 401 (bad/expired token) → "Reconnect canopy" state in the globe area + settings.
- Network/unreachable → "Can't reach canopy" with a retry; the globe area shows
  the message instead of a black canvas.
- Empty canopy (no docs/feed/etc.) → hubs render with zero leaves (a bare
  category), never an error.

## Testing / verification

- **Canopy bridge:** `cd canopy && npm test` — CORS preflight headers for an
  allowed origin; bearer authorizes `GET /docs`; disallowed origin / bad bearer
  rejected. Existing 435 stay green.
- **Mnemosphere units:** `canopy-api` (mocked `fetch`: success, 401, network),
  `dev-graph` (canopy DTO fixtures → correct hubs/leaves counts + node fields),
  mode switch (prefs persist; switching re-mounts), dev-page render (markdown
  fixture → sanitized DOM). The knowledge globe's 406 tests stay green
  (provider refactor is behavior-preserving on that path).
- **Live:** local Mnemosphere `:5173` ↔ local canopy `:8787` (cross-origin
  exercises CORS+bearer). Seed canopy, mint a token, connect in Developer
  settings, switch to Developer → the globe of the seeded canopy context; click
  nodes → dev pages. Verified in the browser.

## Out of scope (this cycle)

Multi-repo (B); write-back / curate actions (promote, triage assign); identity
merge between Mnemosphere and canopy.
