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

