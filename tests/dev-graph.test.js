import { test, expect } from 'vitest';
import { buildDevGraph } from '../src/dev/dev-graph.js';

const fixture = {
  docs: { docs: [{ slug: 'a', title: 'Arch' }, { slug: 'b', title: 'Auth' }] },
  roadmap: { narrative: 'x', milestones: [{ id: 1, title: 'v1' }, { id: 2, title: 'v2' }, { id: 3, title: 'v3' }] },
  feed: { feed: [{ summary: 'merged PR #1' }] },
  triage: { items: [{ raw: 'weird tag', reason: 'oov' }] },
  dashboard: { previousActivity: [{ number: 10, title: 'PR ten' }], todo: [{ number: 20, title: 'do this' }, { number: 21, title: 'and that' }] },
};

test('produces exactly the five category hubs in order', () => {
  const { hubs } = buildDevGraph(fixture);
  expect(hubs.map((h) => h.page.title)).toEqual(['Docs', 'Roadmap', 'Feed', 'Triage', 'My Work']);
});

test('hub leaf counts match the source data', () => {
  const { hubs } = buildDevGraph(fixture);
  const byTitle = Object.fromEntries(hubs.map((h) => [h.page.title, h]));
  expect(byTitle.Docs.leaves.length).toBe(2);
  expect(byTitle.Roadmap.leaves.length).toBe(3);
  expect(byTitle.Feed.leaves.length).toBe(1);
  expect(byTitle.Triage.leaves.length).toBe(1);
  expect(byTitle['My Work'].leaves.length).toBe(3); // 1 PR + 2 todos
});

test('leaf nodes carry devKind + devRef for the viewer', () => {
  const { hubs } = buildDevGraph(fixture);
  const roadmap = hubs.find((h) => h.page.title === 'Roadmap');
  expect(roadmap.leaves[0].page.devKind).toBe('milestone');
  expect(roadmap.leaves[0].page.devRef).toBe(1);
  const docs = hubs.find((h) => h.page.title === 'Docs');
  expect(docs.leaves[0].page.devKind).toBe('doc');
  expect(docs.leaves[0].page.devRef).toBe('a');
});

test('deterministic: same input yields the same hub directions', () => {
  const a = buildDevGraph(fixture);
  const b = buildDevGraph(fixture);
  expect(a.hubs.map((h) => h.dir)).toEqual(b.hubs.map((h) => h.dir));
});

test('empty / missing sections yield hubs with zero leaves (no crash)', () => {
  const { hubs } = buildDevGraph({});
  expect(hubs.length).toBe(5);
  expect(hubs.every((h) => h.leaves.length === 0)).toBe(true);
});
