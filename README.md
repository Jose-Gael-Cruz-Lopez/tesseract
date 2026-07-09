# Mnemosphere

A Notion-style knowledge workspace with a twist: the Home view is an
interactive 3D knowledge globe. Every top-level page is a glowing hub on the
globe; its sub-pages orbit as dots. Write in a full document editor, organize in
a sidebar, and watch your notes take shape in space — every cluster of thought,
tethered to a single core.

![Mnemosphere hero](docs/hero.png)

## Architecture

The app is a dependency-free Vite + vanilla-JS single page app. A small
**data store** (`src/data/store.js`) holds one page tree in `localStorage` and
emits change events; every surface subscribes to it, so the sidebar, editor, and
globe stay in sync from one source of truth. A **mock auth module**
(`src/auth/auth.js`, Supabase-shaped) gates first use behind a sign-up /
onboarding flow. The **app shell** (`src/app.js`) builds a single `ctx` object
and mounts each surface — sidebar, top bar, page editor, comments, and the
modals (search, settings, share, templates, import, teamspace, updates). The
**globe** (`src/globe/globe.js`) is a self-contained `three.js` scene that reads
hubs/leaves from the store and rebuilds live as pages change. Design tokens
(`src/styles/tokens.css`) drive a light/dark theme.

## Features

- **Notion-fidelity chrome.** Sign-up & onboarding flow, a 240px sidebar with a
  page tree, favorites, trash, and teamspaces, a document editor with covers,
  icons, slash-style blocks, and databases (table / gallery views).
- **Globe as Home.** Top-level pages become glowing hubs on a fibonacci sphere;
  sub-pages fan out as additive dots with the occasional two-hop branch, all
  tethered to a spinning tesseract nucleus at the core.
- **Live sync.** Create, rename, or delete a page in the sidebar and the globe
  updates immediately — same data, two views.
- **Light + dark themes.** Settings → Appearance switches Light / Dark / Use
  system; all colors flow from CSS custom properties.
- **AI writing, search, and more.** A mock streaming AI writer, ⌘K search,
  updates inbox, share popover, template gallery, and file import (Markdown /
  CSV / HTML).

## Quickstart

```bash
git clone https://github.com/Jose-Gael-Cruz-Lopez/second-brain-globe.git
cd second-brain-globe
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # production bundle in dist/
```

On first load you'll land on the sign-up flow (any email works; any code is
accepted — auth is mocked until Supabase is wired in). After onboarding, a
starter workspace is seeded and the globe appears as Home.

## Controls

| Input | Action |
| --- | --- |
| Drag the globe | Rotate |
| Scroll | Zoom |
| Click a hub / dot | Focus that cluster / open that page |
| ⌘K or `/` | Search pages |
| ⌘\\ | Collapse / expand the sidebar |
| Esc | Return from an open page to the globe |

## Deploy

**Vercel** works zero-config for Vite. **GitHub Pages** needs the base path set
in `vite.config.js` (`base: '/second-brain-globe/'`), then publish `dist/`.

## Stack and credits

- [three.js](https://threejs.org/) — the self-contained globe scene
- [Vite](https://vite.dev/) — build & dev server
- [vitest](https://vitest.dev/) + happy-dom — tests
- The dandelion-on-a-globe look is inspired by [3d-force-graph](https://github.com/vasturiano/3d-force-graph).

UI chrome is specced in
[docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md](docs/superpowers/specs/2026-07-08-notion-ui-redesign-design.md);
older globe design notes live in [DESIGN_SPEC.md](DESIGN_SPEC.md).

## License

MIT. See [LICENSE](LICENSE).
