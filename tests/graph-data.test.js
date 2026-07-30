// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { buildGraphFromPages, hashId, mulberry32, PALETTE, hubGroups, escapeHtml } from '../src/graph/graph-data.js';

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

// ── Hardening, added after review found the originals too weak ──────────────

// The original determinism test compared two orderings and would have stayed
// green against an implementation that set every position to 0. Distinctness is
// what actually pins the seeding.
test('distinct ids get distinct seeded positions (not all-zero)', () => {
  const { nodes } = buildGraphFromPages([P('a'), P('b'), P('c')]);
  const keys = nodes.map((n) => `${n.x},${n.y},${n.z}`);
  expect(new Set(keys).size).toBe(3);
  expect(keys.every((k) => k === '0,0,0')).toBe(false);
});

// The original link-integrity test only ever saw a happy-path fixture, so it
// could not fail for the case it is named after.
test('link integrity holds when a mid-tree parent is deleted', () => {
  const pages = [P('a'), P('mid', 'a', { deleted: true }), P('deep', 'mid')];
  const { nodes, links } = buildGraphFromPages(pages);
  const ids = new Set(nodes.map((n) => n.id));
  expect(ids).toEqual(new Set(['a', 'deep']));
  for (const l of links) {
    expect(ids.has(l.source)).toBe(true);
    expect(ids.has(l.target)).toBe(true);
  }
});

test('nodes carry the label, color and val the renderer binds', () => {
  const { nodes } = buildGraphFromPages([P('a', null, { title: 'Alpha' }), P('b', 'a', { title: 'Beta' })]);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId.a.label).toBe('Alpha');
  expect(byId.b.label).toBe('Beta');
  expect(byId.a.color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(byId.a.val).toBeGreaterThan(byId.b.val); // hubs render larger than leaves
});

test('an untitled page still gets a label', () => {
  const { nodes } = buildGraphFromPages([{ id: 'x', parentId: null }]);
  expect(nodes[0].label).toBe('(untitled)');
});

// ── hubGroups: what the dev sidebar renders from ───────────────────────────

test('hubGroups returns each hub with its direct children', () => {
  const g = buildGraphFromPages([P('h1'), P('h2'), P('c1', 'h1'), P('c2', 'h1')]);
  const groups = hubGroups(g);
  expect(groups.map((x) => x.page.id)).toEqual(['h1', 'h2']);
  expect(groups[0].leaves.map((l) => l.page.id)).toEqual(['c1', 'c2']);
  expect(groups[1].leaves).toEqual([]);
});

test('hubGroups exposes the original page objects, so icon/title/devKind survive', () => {
  const g = buildGraphFromPages([
    P('cat:docs', null, { icon: '📄', title: 'Docs' }),
    P('doc:a', 'cat:docs', { title: 'A', devKind: 'doc', devRef: 'a' }),
  ]);
  const [group] = hubGroups(g);
  expect(group.page.icon).toBe('📄');
  expect(group.leaves[0].page.devKind).toBe('doc');
  expect(group.leaves[0].page.devRef).toBe('a');
});

test('hubGroups tolerates an empty graph', () => {
  expect(hubGroups({ nodes: [], links: [] })).toEqual([]);
  expect(hubGroups(undefined)).toEqual([]);
});

// ── escapeHtml: 3d-force-graph renders nodeLabel as HTML ───────────────────

test('escapeHtml neutralises markup in a page title', () => {
  expect(escapeHtml('<img src=x onerror=alert(1)>'))
    .toBe('&lt;img src=x onerror=alert(1)&gt;');
  expect(escapeHtml('a & b')).toBe('a &amp; b');
  expect(escapeHtml('"q"')).toBe('&quot;q&quot;');
  expect(escapeHtml(null)).toBe('');
});
