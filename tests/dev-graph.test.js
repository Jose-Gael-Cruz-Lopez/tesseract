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
