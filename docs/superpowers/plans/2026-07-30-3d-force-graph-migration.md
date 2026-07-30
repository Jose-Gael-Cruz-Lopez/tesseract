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
