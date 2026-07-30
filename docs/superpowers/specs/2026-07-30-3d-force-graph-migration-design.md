# Replace the bespoke globe with 3D Force-Directed Graph — Design

**Date:** 2026-07-30
**Status:** Design (approved 2026-07-30; implementation not started).

## Goal

Replace Mnemosphere's hand-written three.js globe with
[`3d-force-graph`](https://github.com/vasturiano/3d-force-graph) as the rendering engine for
**both** 3D surfaces — the Knowledge globe (personal pages) and the Developer sphere (a canopy
hub) — while preserving every interaction the app already depends on.

The visual metaphor changes deliberately: from a *sphere* (hubs placed on a seeded fibonacci
shell, leaves on spring offsets) to a **stock free force-directed graph**, where `d3-force-3d`
decides positions. This is a product decision, not an incidental side effect of the swap.

## Scope boundary

- **IN:** a new `src/graph/` module (renderer + pure data builder); both modes migrated; the full
  page tree rendered at any depth; deletion of `src/globe/`; ported and new tests.
- **OUT:** any change to canopy (the Worker, its API, its schema). `3d-force-graph` is a
  **client-side renderer only** — it has no server, storage, or API component, so there is no
  "backend functionality" to adopt from it. The backend remains canopy, unchanged.
- **OUT:** changes to the sidebar, topbar, editor, comments, hub picker or dev-sidebar. The
  renderer contract is preserved precisely so these stay untouched.

## Key decisions

### 1. New module, same contract (approach B)

`initGraph(container, hooks, provider)` returns the **identical** shape `initGlobe` did:

```js
{ focusPage(id), clearFocus(), setVisible(bool), dispose(), refresh() }
```

and accepts the **identical** hooks: `onOpenPage(pageId)`, `onHubFocus(pageId|null)`.

Rejected alternatives:

- **In-place swap** (gut `globe.js`, keep the name): leaves a module called "globe" rendering no
  globe, and `globe-data.js` naming math that no longer exists. Misleading names are how the next
  bug gets written.
- **Redesign the contract too:** would rewrite `app.js` mode-mounting, both sidebars and the hub
  picker with their tests, for no user-visible gain.

The contract survives because it is genuinely well-shaped for this: `onOpenPage` / `onHubFocus`
are exactly the two events a force graph needs to emit, and `focusPage` / `clearFocus` map
cleanly onto camera focus.

### 2. Both modes convert together, for free

Developer mode has no renderer of its own. `dev-graph.js` fabricates five synthetic category
pages plus one child page per canopy item and feeds them to the **same** builder the Knowledge
side uses. It therefore converts by repointing one import; its own logic is unchanged.

This shared seam is why replacing both surfaces costs barely more than replacing one, and why
leaving them split (two 3D renderers to maintain) was rejected.

### 3. Full-depth tree

`buildGraphFromPages` currently caps the hierarchy at three levels — hub, leaf, branch — with
`// deeper descendants are intentionally ignored`. That cap exists **only** because the sphere
layout had no way to place arbitrary depth.

The new builder emits one node per non-deleted page and one link per parent→child edge, at any
depth. This fixes a real but quiet bug: pages nested four or more levels deep are currently
invisible in the globe entirely.

### 4. Determinism is preserved by seeding, not by fixed placement

This is the subtle one.

`d3-force-3d` is itself deterministic, but it seeds initial positions from each node's **array
index**. The store's page order is not stable, so index-seeding would let the layout shuffle
whenever page order changed — precisely the failure `tests/globe-data.test.js` ("layout is keyed
by page id hash, not call order") exists to prevent.

So `graph-data.js` assigns every node an initial `x/y/z` derived from
`mulberry32(hashId(page.id))` before handing it to the simulation. Identical page set →
identical starting state → identical settled layout, independent of ordering.

`mulberry32`, `hashId` and `PALETTE` are therefore **salvaged** from `globe-data.js` rather than
deleted with it.

**Accepted limitation:** adding or removing a page still perturbs its neighbours. That is
inherent to force-directed layout and was accepted when choosing the stock look. What the seeding
buys is that a reload, a re-render, or a store reorder does **not** move anything.

## Data model

One shape, emitted by both modes, so the renderer never learns which mode it is in:

```js
// node
{ id, kind: 'hub' | 'leaf', page, label, color, val, x, y, z }
// link
{ source: parentId, target: id }
```

`x/y/z` are the seeded initial positions from §4.

`kind` is derived from one rule — **`hub` means `parentId == null`** — and is what lets the
renderer route a click to `onHubFocus` versus `onOpenPage`. This unifies the two modes cleanly:
in Developer mode the top-level pages *are* the five synthetic categories, and in Knowledge mode
they are the user's top-level pages, so the same rule produces the right behaviour on both sides
without the renderer knowing which mode it is in.

One nuance carried over from today: a Knowledge-mode hub is a real page, so it is both focusable
and openable. Current behaviour is that clicking a hub focuses it (`onHubFocus`) rather than
opening it, and that is preserved — `kind` decides the click route, not whether a page exists
behind the node.

Developer-mode nodes additionally carry the existing `devKind` / `devRef` on `page`, untouched.

## Feature parity

| Today (`globe.js`) | New (`graph.js`) |
| --- | --- |
| click leaf → `onOpenPage(id)` | `onNodeClick`, node `kind: 'leaf'` |
| click hub → `onHubFocus(id)` | `onNodeClick`, node `kind: 'hub'` |
| `focusPage(id)` | camera fly-to node + highlight |
| `clearFocus()` | reset camera + clear highlight |
| `setVisible(bool)` | container show/hide (page slide-over) |
| `dispose()` | `_destructor()`, drop canvas, unsubscribe store |
| `refresh()` | re-run provider → `graphData()` |
| store `'pages'` subscription | unchanged — rebuild `graphData` |
| theme repaint (light/dark) | `backgroundColor` + node/link colors on theme change |

Theme awareness is explicitly retained; dropping it would be a visible regression in light mode.

## What is deleted

| File | Lines |
| --- | --- |
| `src/globe/globe.js` | 1004 |
| `src/globe/globe-data.js` | 138 |
| `src/globe/nodes.js` | 91 |
| **Total** | **1233** |

