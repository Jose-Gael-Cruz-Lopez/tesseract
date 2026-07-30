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
