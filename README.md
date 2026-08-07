# Mnemosphere

A Notion-style knowledge workspace with a twist: the Home view is an
interactive 3D force-directed knowledge graph. Every top-level page is a
glowing hub; its sub-pages branch out around it. Write in a full document
editor, organize in a sidebar, and watch your notes take shape in space.
Signed in with GitHub, the same shell flips into **Developer mode** — a live
graph over your [canopy](canopy/README.md) hubs (docs, roadmap, feed, triage,
My Work).

## Architecture

The app is a Vite + vanilla-JS single-page app. A small **data store**
(`src/data/store.js`) holds one page tree in `localStorage` and emits change
events; every surface subscribes to it, so the sidebar, editor, and graph stay
in sync from one source of truth. **Auth** is two real providers plus a demo
fallback: Supabase **Google** sign-in owns the Knowledge side
(`src/data/supabase.js`, compiled in when `VITE_SUPABASE_*` is set at build
time), a same-origin **canopy GitHub** session unlocks Developer mode
(`src/data/canopy-session.js`), and without either the mock email flow
(`src/auth/auth.js`) lets you demo the app. The **app shell** (`src/app.js`)
builds a single `ctx` object and mounts each surface — sidebar, top bar, page
editor, comments, and the modals. The **graph** (`src/graph/`) renders the
page tree with [3d-force-graph](https://github.com/vasturiano/3d-force-graph),
seeding deterministic layouts from page ids; the **dev sphere** (`src/dev/`)
reuses the same renderer over canopy's per-repo reads. Design tokens
(`src/styles/tokens.css`) drive the light/dark theme.

## Features

- **Notion-fidelity chrome.** Sign-in & onboarding, a 240px sidebar with a
  page tree, favorites, trash, and teamspaces, a document editor with covers,
  icons, slash-style blocks, and databases (table / gallery views).
- **Graph as Home.** Top-level pages become hubs in a 3D force layout;
  sub-pages fan out as satellites. Create, rename, or delete a page and the
  graph rebuilds live — same data, two views.
- **Your pages persist.** Export / import the whole workspace as JSON
  (Settings → Workspace), and Google-signed-in users get cloud sync — the
  workspace mirrors to Supabase (last-write-wins) and follows you across
  browsers. See `supabase/migrations/` for the one-table schema.
- **Developer mode.** Sign in with GitHub (via canopy) and the same graph
  renders your repo hubs: docs, roadmap, feed, triage, and My Work, read
  live from `/r/:owner/:repo`.
- **Light + dark themes**, ⌘K search, a mock streaming AI writer, updates
  inbox, share popover, template gallery, and file import (Markdown / CSV /
  HTML).

## Quickstart

```bash
git clone https://github.com/Jose-Gael-Cruz-Lopez/tesseract.git
cd tesseract
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # production bundle in dist/
```

Without configuration you land on the demo email flow (any email, any code).
For real Google sign-in + cloud sync, create `.env.local` with your Supabase
project's URL and publishable key, and apply the workspace-sync migration:

```bash
# .env.local
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
# then apply supabase/migrations/20260806_workspaces.sql to the project
```

The production deploy is **fused with canopy**: one Cloudflare Worker serves
this app at `/`, canopy's admin at `/admin`, and the backend routes —
see `canopy/SETUP.md` and `canopy/docs/runbooks/deploy-pipeline.md`.

## Controls

| Input | Action |
| --- | --- |
| Drag the graph | Rotate / pan |
| Scroll | Zoom |
| Click a hub / node | Focus that cluster / open that page |
| ⌘K or `/` | Search pages |
| ⌘\\ | Collapse / expand the sidebar |
| Esc | Return from an open page to the graph |

## Stack and credits

- [3d-force-graph](https://github.com/vasturiano/3d-force-graph) (+ three.js) — the Home graph
- [Supabase](https://supabase.com/) — Google auth + workspace cloud sync
- [Vite](https://vite.dev/) — build & dev server
- [vitest](https://vitest.dev/) + happy-dom — tests
- [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) — dev-doc markdown rendering

UI chrome is specced in
[docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md](docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md);
the force-graph migration design is
[docs/superpowers/specs/2026-07-30-3d-force-graph-migration-design.md](docs/superpowers/specs/2026-07-30-3d-force-graph-migration-design.md).
`DESIGN_SPEC.md` describes the pre-2026-07-30 bespoke globe and is kept as a
historical record.

## License

MIT. See [LICENSE](LICENSE).
