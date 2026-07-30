# 3D Force-Directed Graph Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mnemosphere's bespoke three.js globe with `3d-force-graph` as the renderer for both the Knowledge globe and the Developer canopy sphere, preserving every interaction the app depends on.

**Architecture:** A new `src/graph/` module exposes `initGraph(container, hooks, provider)` with the **identical** contract `initGlobe` had (same hooks `onOpenPage`/`onHubFocus`, same five methods `focusPage`/`clearFocus`/`setVisible`/`dispose`/`refresh`). Because the contract is unchanged, `app.js` changes by two imports and two call sites, and the sidebar, topbar, editor, hub picker and dev-sidebar are untouched. `src/globe/` is then deleted.

**Tech Stack:** Vanilla JS (ES modules), Vite 7, Vitest + happy-dom, `3d-force-graph@^1.80.0`, `three@0.185.1` (pinned).

**Design spec:** `docs/superpowers/specs/2026-07-30-3d-force-graph-migration-design.md`

## Global Constraints

- **Do not modify `canopy/`.** `3d-force-graph` is a client-side renderer with no backend; the backend stays canopy, unchanged.
- **Do not change the renderer contract.** `initGraph` must accept `{onOpenPage, onHubFocus}` and return `{focusPage, clearFocus, setVisible, dispose, refresh}`. Consumers depend on these exact names.
- **three.js stays pinned at `0.185.1`.** Do not bump it. `3d-force-graph@1.80.0` takes `three: ">=0.179 <1"` as a regular dependency, which `0.185.1` satisfies.
- **The library is constructed with `new`:** `new ForceGraph3D(element)`. The older `ForceGraph3D()(element)` call form is **wrong** for 1.80.0 and will throw.
- **Theme event:** the app dispatches `document` event `'mnemosphere:themechange'` with `e.detail.theme` of `'dark' | 'light'`. Read the current value from `document.documentElement.dataset.theme`.
- **Run tests from the repo root** (`npm test`), not from `canopy/`. The root suite is Vitest over `tests/**`.
- **TDD is mandatory.** Every task writes a failing test first and watches it fail before implementing.

---

### Task 1: Add the dependency and prove there is only one three.js

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `3d-force-graph` importable as a default export; `three` still resolving to exactly one copy.

- [ ] **Step 1: Install the dependency**

```bash
npm install 3d-force-graph@^1.80.0
```

- [ ] **Step 2: Prove there is exactly one copy of three**

```bash
npm ls three
```

Expected: `three@0.185.1` appears **once**, deduped to the root. If you see a second nested `three@…` under `3d-force-graph`, STOP and report it — do not proceed, and do not "fix" it by bumping three. `vite.config.js` already sets `resolve.dedupe: ['three']`, which covers bundling, but a nested install would still signal a version conflict worth understanding first.

- [ ] **Step 3: Confirm the existing suite is still green**

```bash
npm test
```

Expected: 27 files / 448 tests passing. Adding a dependency must change nothing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add 3d-force-graph (three stays pinned at 0.185.1)"
```

---

### Task 2: The pure data builder

**Files:**
- Create: `src/graph/graph-data.js`
- Test: `tests/graph-data.test.js`

**Interfaces:**
- Consumes: nothing (pure module — no DOM, no storage, no three.js).
- Produces:
  - `buildGraphFromPages(pages) → { nodes, links }`
  - `nodes[i]` = `{ id, kind: 'hub'|'leaf', page, label, color, val, x, y, z }`
  - `links[i]` = `{ source: parentId, target: childId }`
  - `mulberry32(seed) → () => number`
  - `hashId(str) → uint32`
  - `PALETTE` — array of 7 hex color strings

Task 3 and Task 4 both import `buildGraphFromPages` from this module.

**Key rule (do not deviate):** a node is a `hub` when it has no *reachable* parent — that is, `parentId == null` **or** the parent is not among the live pages. This is what prevents orphan links when a parent is deleted but a child is not, and it means every node is either a hub or has exactly one link to a live parent.

- [ ] **Step 1: Write the failing tests**

Create `tests/graph-data.test.js`:

```js
// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { buildGraphFromPages, hashId, mulberry32, PALETTE } from '../src/graph/graph-data.js';

const P = (id, parentId = null, extra = {}) => ({ id, parentId, title: id, ...extra });

test('every non-deleted page becomes exactly one node', () => {
  const { nodes } = buildGraphFromPages([P('a'), P('b'), P('c', 'a')]);
  expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
});

test('parent -> child edges become links', () => {
  const { links } = buildGraphFromPages([P('a'), P('c', 'a')]);
  expect(links).toEqual([{ source: 'a', target: 'c' }]);
});

// The old sphere builder capped the tree at 3 levels; anything deeper was
// invisible. The force layout has no such limit, so depth 4+ must render.
test('the full tree renders at any depth (no 3-level cap)', () => {
  const pages = [P('l1'), P('l2', 'l1'), P('l3', 'l2'), P('l4', 'l3'), P('l5', 'l4')];
  const { nodes, links } = buildGraphFromPages(pages);
  expect(nodes).toHaveLength(5);
  expect(links).toHaveLength(4);
  expect(links).toContainEqual({ source: 'l4', target: 'l5' });
});

test('top-level pages are hubs, everything else is a leaf', () => {
  const { nodes } = buildGraphFromPages([P('a'), P('c', 'a')]);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId.a.kind).toBe('hub');
  expect(byId.c.kind).toBe('leaf');
});

// Orphan protection: a live child of a DELETED parent must not emit a link to a
// node that does not exist, or the force engine will throw on an unresolvable
// link target.
test('a child of a deleted parent becomes a hub, with no dangling link', () => {
  const { nodes, links } = buildGraphFromPages([
    P('gone', null, { deleted: true }),
    P('orphan', 'gone'),
  ]);
  expect(nodes.map((n) => n.id)).toEqual(['orphan']);
  expect(nodes[0].kind).toBe('hub');
  expect(links).toEqual([]);
});

test('link integrity: every source and target resolves to a real node', () => {
  const pages = [P('a'), P('b', 'a'), P('c', 'b'), P('d')];
  const { nodes, links } = buildGraphFromPages(pages);
  const ids = new Set(nodes.map((n) => n.id));
  for (const l of links) {
    expect(ids.has(l.source)).toBe(true);
    expect(ids.has(l.target)).toBe(true);
  }
});

test('deleted pages are excluded at every level', () => {
  const pages = [P('a'), P('b', 'a', { deleted: true }), P('c', 'a')];
  const { nodes } = buildGraphFromPages(pages);
  expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
});

test('same input produces identical output (deterministic rebuild)', () => {
  const pages = [P('a'), P('b'), P('c', 'a')];
  expect(buildGraphFromPages(pages)).toEqual(buildGraphFromPages(pages));
});

// THE LOAD-BEARING ONE. d3-force-3d seeds initial positions from ARRAY INDEX,
// and the store's page order is not stable — so seeding must be keyed by page
// id, not by position in the list, or the layout shuffles on reorder.
test('positions are keyed by page id hash, not call order', () => {
  const a = buildGraphFromPages([P('one'), P('two'), P('three')]);
  const b = buildGraphFromPages([P('three'), P('one'), P('two')]);
  const pos = (g, id) => {
    const n = g.nodes.find((x) => x.id === id);
    return [n.x, n.y, n.z];
  };
  for (const id of ['one', 'two', 'three']) {
    expect(pos(a, id)).toEqual(pos(b, id));
  }
});

test('every node gets finite seeded coordinates', () => {
  const { nodes } = buildGraphFromPages([P('a'), P('b', 'a')]);
  for (const n of nodes) {
    for (const c of [n.x, n.y, n.z]) expect(Number.isFinite(c)).toBe(true);
  }
});

test('empty / missing input does not throw', () => {
  expect(buildGraphFromPages([])).toEqual({ nodes: [], links: [] });
  expect(buildGraphFromPages(undefined)).toEqual({ nodes: [], links: [] });
});

test('hashId and mulberry32 are stable helpers', () => {
  expect(hashId('a')).toBe(hashId('a'));
  expect(hashId('a')).not.toBe(hashId('b'));
  const r = mulberry32(42);
  const first = [r(), r(), r()];
  const r2 = mulberry32(42);
  expect([r2(), r2(), r2()]).toEqual(first);
  expect(PALETTE.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run tests/graph-data.test.js
```

Expected: FAIL — `Failed to resolve import "../src/graph/graph-data.js"`. That is the correct failure: the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/graph/graph-data.js`:

```js
// Pure graph data for the 3D force layout — no DOM, no storage, no three.js.
//
// buildGraphFromPages(pages) turns the store's flat page list into the
// {nodes, links} shape 3d-force-graph consumes: one node per live page, one
// link per parent->child edge, at ANY depth (the old sphere builder capped at
// three levels because it could not place deeper nodes).
//
// Initial x/y/z are seeded from the page id, NOT the array index. d3-force-3d
// seeds from index by default, and the store's page order is not stable, so
// index-seeding would reshuffle the whole layout whenever page order changed.
// Seeding by id means the same page set always settles the same way.

export const PALETTE = [
  '#ffd166', '#ffb454', '#ff5d8f', '#ff2d55', '#c8b6ff', '#e8ecff', '#86d1ff',
];

// Deterministic PRNG, carried over from the retired globe-data.js.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash -> 32-bit seed for a page id.
export function hashId(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Radius of the shell the simulation starts from. Not a constraint — the force
// layout is free to move nodes anywhere from here.
const SEED_RADIUS = 120;

/**
 * @param {Array} pages flat page records ({id, parentId, deleted, title, ...})
 * @returns {{nodes: Array, links: Array}}
 */
export function buildGraphFromPages(pages) {
  const alive = (pages || []).filter((p) => p && !p.deleted);
  const liveIds = new Set(alive.map((p) => p.id));

  // A page is a hub when it has no REACHABLE parent: either genuinely
  // top-level, or its parent was deleted. Without the second case a live child
  // of a deleted parent would emit a link to a node that does not exist.
  const isHub = (p) => p.parentId == null || !liveIds.has(p.parentId);

  const nodes = alive.map((page) => {
    const seed = hashId(page.id);
    const rng = mulberry32(seed);
    // Uniform point on a sphere, consumed in a fixed order so the mapping from
    // id -> position is total and stable.
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const hub = isHub(page);
    return {
      id: page.id,
      kind: hub ? 'hub' : 'leaf',
      page,
      label: page.title || '(untitled)',
      color: PALETTE[seed % PALETTE.length],
      val: hub ? 8 : 3,
      x: Math.cos(theta) * r * SEED_RADIUS,
      y: u * SEED_RADIUS,
      z: Math.sin(theta) * r * SEED_RADIUS,
    };
  });

  const links = [];
  for (const page of alive) {
    if (!isHub(page)) links.push({ source: page.parentId, target: page.id });
  }

  return { nodes, links };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run tests/graph-data.test.js
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/graph-data.js tests/graph-data.test.js
git commit -m "feat(graph): pure {nodes, links} builder with id-seeded positions"
```

---

### Task 3: Repoint the Developer-mode builder

**Files:**
- Modify: `src/dev/dev-graph.js` (change the import and the return contract usage)
- Test: `tests/dev-graph.test.js` (rewrite assertions against `{nodes, links}`)

**Interfaces:**
- Consumes: `buildGraphFromPages` from `src/graph/graph-data.js` (Task 2).
- Produces: `buildDevGraph({docs, roadmap, feed, triage, dashboard}) → {nodes, links}`; `CATEGORIES` unchanged.

`dev-graph.js`'s own logic — five synthetic category pages plus one child page per canopy item, each carrying `devKind` / `devRef` — does **not** change. Only the import path changes, because the builder it delegates to now returns a different shape. This is the whole reason Developer mode converts nearly for free.

- [ ] **Step 1: Rewrite the failing tests**

Replace the body of `tests/dev-graph.test.js` (keep its existing imports of `buildDevGraph`/`CATEGORIES` and any fixtures it already has at the top):

```js
// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { buildDevGraph, CATEGORIES } from '../src/dev/dev-graph.js';

const hubs = (g) => g.nodes.filter((n) => n.kind === 'hub');
const childrenOf = (g, id) => g.links.filter((l) => l.source === id).map((l) => l.target);

test('produces exactly the five category hubs in order', () => {
  const g = buildDevGraph({});
  expect(hubs(g).map((n) => n.id)).toEqual(CATEGORIES.map((c) => c.id));
});

test('item counts match the source data', () => {
  const g = buildDevGraph({
    docs: { docs: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] },
    roadmap: { milestones: [{ id: 1, title: 'M' }] },
  });
  expect(childrenOf(g, 'cat:docs')).toHaveLength(2);
  expect(childrenOf(g, 'cat:roadmap')).toHaveLength(1);
  expect(childrenOf(g, 'cat:feed')).toHaveLength(0);
});

test('item nodes carry devKind + devRef for the viewer', () => {
  const g = buildDevGraph({ docs: { docs: [{ slug: 'a', title: 'A' }] } });
  const node = g.nodes.find((n) => n.id === 'doc:a');
  expect(node.page.devKind).toBe('doc');
  expect(node.page.devRef).toBe('a');
  expect(node.kind).toBe('leaf');
});

test('deterministic: same input yields the same positions', () => {
  const input = { docs: { docs: [{ slug: 'a', title: 'A' }] } };
  expect(buildDevGraph(input)).toEqual(buildDevGraph(input));
});

test('empty / missing sections yield hubs with zero items (no crash)', () => {
  const g = buildDevGraph({});
  expect(hubs(g)).toHaveLength(5);
  expect(g.links).toEqual([]);
});

test('every link resolves to a real node', () => {
  const g = buildDevGraph({ docs: { docs: [{ slug: 'a', title: 'A' }] } });
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const l of g.links) {
    expect(ids.has(l.source)).toBe(true);
    expect(ids.has(l.target)).toBe(true);
  }
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run tests/dev-graph.test.js
```

Expected: FAIL — `g.nodes is undefined` (the builder still returns `{hubs}`).

- [ ] **Step 3: Change the import**

In `src/dev/dev-graph.js`, change line 7 from:

```js
import { buildGraphFromPages } from '../globe/globe-data.js';
```

to:

```js
import { buildGraphFromPages } from '../graph/graph-data.js';
```

Also update the module's header comment: it currently says the dev sphere "reuses the exact knowledge-globe builder" and that "the globe engine renders this graph unchanged" — replace "globe" with "graph" in both places so the comment matches reality.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run tests/dev-graph.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/dev/dev-graph.js tests/dev-graph.test.js
git commit -m "feat(dev): build the dev sphere from the force-graph builder"
```

---

### Task 4: The renderer

**Files:**
- Create: `src/graph/graph.js`
- Create: `src/styles/graph.css`
- Test: `tests/graph-module.test.js`

**Interfaces:**
- Consumes: `buildGraphFromPages` (Task 2); `getPages`, `onStore`, `offStore` from `src/data/store.js`.
- Produces: `initGraph(container, hooks, provider) → { focusPage, clearFocus, setVisible, dispose, refresh }`, and a re-export of `buildGraphFromPages`.

**Library API — verified against `3d-force-graph@1.80.0` type definitions. Do not substitute from memory:**

```js
new ForceGraph3D(element)        // CONSTRUCTOR. ForceGraph3D()(el) is the OLD api and throws.
  .graphData({nodes, links})     // .nodeId('id') .nodeVal(fn) .nodeColor(fn) .nodeLabel(fn)
  .linkColor(fn) .backgroundColor(str) .width(n) .height(n)
  .onNodeClick(cb) .cameraPosition(pos, lookAt, ms)
  .pauseAnimation() .resumeAnimation() .zoomToFit(ms, padding)
  ._destructor()
```

The renderer itself is **not** unit-testable here — it needs WebGL and this repo has no renderer harness (`globe.js` was untested for the same reason). Task 4's test therefore covers only what can be checked without a GPU: that the module's contract is intact. Real verification is Task 6.

- [ ] **Step 1: Write the failing contract test**

Create `tests/graph-module.test.js`:

```js
// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import * as graph from '../src/graph/graph.js';

// initGraph itself needs WebGL, so this pins the module's shape only — the
// behaviour is verified in a real browser (see the plan's Task 6).
test('exposes initGraph and re-exports the builder', () => {
  expect(typeof graph.initGraph).toBe('function');
  expect(typeof graph.buildGraphFromPages).toBe('function');
});

test('initGraph takes (container, hooks, provider)', () => {
  expect(graph.initGraph.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/graph-module.test.js
```

Expected: FAIL — `Failed to resolve import "../src/graph/graph.js"`.

- [ ] **Step 3: Write the renderer**

Create `src/graph/graph.js`:

```js
// The Mnemosphere graph: a 3D force-directed view of the workspace, rendered by
// 3d-force-graph (three.js + d3-force-3d) instead of the hand-written globe
// scene it replaces.
//
// Two modes share this one engine. Knowledge mode reads the page store and
// subscribes to 'pages' events; Developer mode is handed a `provider` whose
// getGraph() returns the same {nodes, links} shape from canopy. The engine
// never learns which mode it is in — a node's `kind` ('hub' | 'leaf') is all it
// needs to route a click.

import ForceGraph3D from '3d-force-graph';
import { buildGraphFromPages } from './graph-data.js';
import { getPages, onStore, offStore } from '../data/store.js';

export { buildGraphFromPages };

const THEMES = {
  dark: { bg: '#05060a', link: 'rgba(200,210,255,0.22)' },
  light: { bg: '#f7f7f5', link: 'rgba(40,50,80,0.25)' },
};

const readTheme = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark')
    ? 'dark' : 'light';

/**
 * @param {HTMLElement} container renders into this element
 * @param {{onOpenPage?(pageId), onHubFocus?(pageId|null)}} hooks
 * @param {{getGraph(): Promise<{nodes,links}>}|null} provider developer mode source
 * @returns {{focusPage(id), clearFocus(), setVisible(bool), dispose(), refresh()}}
 */
export function initGraph(container, hooks = {}, provider = null) {
  const onOpenPage = hooks.onOpenPage || (() => {});
  const onHubFocus = hooks.onHubFocus || (() => {});

  container.classList.add('graph-stage');
  let theme = readTheme();
  container.classList.toggle('graph-light', theme === 'light');

  const graph = new ForceGraph3D(container)
    .nodeId('id')
    .nodeLabel((n) => n.label)
    .nodeVal((n) => n.val)
    .nodeColor((n) => n.color)
    .linkColor(() => THEMES[theme].link)
    .backgroundColor(THEMES[theme].bg)
    .showNavInfo(false)
    .width(container.clientWidth || 800)
    .height(container.clientHeight || 600)
    .onNodeClick((node) => {
      if (!node) return;
      focusNode(node);
      // A hub is focused, not opened — matching the globe's behaviour, where a
      // top-level page is a focus target even though a page exists behind it.
      if (node.kind === 'hub') onHubFocus(node.id);
      else onOpenPage(node.id);
    });

  let selected = null;

  function focusNode(node) {
    selected = node;
    const dist = 90;
