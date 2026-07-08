// @vitest-environment node
//
// Pure node-env tests for buildGraphFromPages — no DOM, no storage, no three.js
// (so Node 25's native localStorage quirks can never touch this file).
import { test, expect } from 'vitest';
import { buildGraphFromPages, PALETTE, GLOBE_R } from '../src/globe/globe-data.js';

// Minimal page records (only the fields the helper reads).
let seq = 0;
function mkPage(id, parentId = null, extra = {}) {
  return { id, title: `Page ${++seq}`, parentId, deleted: false, ...extra };
}

// A small tree: two hubs; hub A has two children, one grandchild, and one
// great-grandchild (which must be ignored).
function fixture() {
  return [
    mkPage('hub-a'),
    mkPage('leaf-a1', 'hub-a'),
    mkPage('leaf-a2', 'hub-a'),
    mkPage('branch-a1x', 'leaf-a1'),
    mkPage('too-deep', 'branch-a1x'),
    mkPage('hub-b'),
    mkPage('leaf-b1', 'hub-b'),
  ];
}

const len = (v) => Math.hypot(v[0], v[1], v[2]);

test('top-level pages become hubs; children leaves; grandchildren branches; deeper ignored', () => {
  const { hubs } = buildGraphFromPages(fixture());
  expect(hubs.map((h) => h.page.id)).toEqual(['hub-a', 'hub-b']);

  const a = hubs[0];
  const ids = a.leaves.map((l) => l.page.id);
  expect(ids).toContain('leaf-a1');
  expect(ids).toContain('leaf-a2');
  expect(ids).toContain('branch-a1x');
  expect(ids).not.toContain('too-deep');
  expect(ids).not.toContain('hub-b');

  // direct children anchor to the hub (parentIdx -1); grandchildren point at
  // their parent leaf's index within the same array.
  const leafA1 = a.leaves.findIndex((l) => l.page.id === 'leaf-a1');
  const leafA2 = a.leaves.find((l) => l.page.id === 'leaf-a2');
  const branch = a.leaves.find((l) => l.page.id === 'branch-a1x');
  expect(a.leaves[leafA1].parentIdx).toBe(-1);
  expect(leafA2.parentIdx).toBe(-1);
  expect(branch.parentIdx).toBe(leafA1);

  expect(hubs[1].leaves.map((l) => l.page.id)).toEqual(['leaf-b1']);
});

test('hub placement stays on the seeded fibonacci sphere envelope', () => {
  const pages = Array.from({ length: 12 }, (_, i) => mkPage(`hub-${i}`));
  const { hubs } = buildGraphFromPages(pages);
  expect(hubs).toHaveLength(12);
  for (const h of hubs) {
    expect(len(h.dir)).toBeCloseTo(1, 6); // unit direction
    expect(h.dist).toBeGreaterThanOrEqual(GLOBE_R * 0.4);
    expect(h.dist).toBeLessThan(GLOBE_R * 0.7);
    expect(h.scale).toBeGreaterThanOrEqual(0.8);
    expect(h.scale).toBeLessThan(1.7);
  }
  // fibonacci placement spreads hubs — no two directions collapse together
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const d = hubs[i].dir, e = hubs[j].dir;
      const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
      expect(dot).toBeLessThan(0.99);
    }
  }
});

test('accent cycles the palette by hub index', () => {
  const pages = Array.from({ length: PALETTE.length + 3 }, (_, i) => mkPage(`hub-${i}`));
  const { hubs } = buildGraphFromPages(pages);
  hubs.forEach((h, i) => expect(h.accent).toBe(PALETTE[i % PALETTE.length]));
});

test('same input produces identical output (deterministic rebuild)', () => {
  const pages = fixture();
  const g1 = buildGraphFromPages(pages);
  const g2 = buildGraphFromPages(pages);
  expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
});

test('layout is keyed by page id hash, not call order', () => {
  const pages = fixture();
  const before = buildGraphFromPages(pages);
  // Mutating an unrelated hub's subtree must not shift hub A's randomness.
  const withExtra = [...pages, mkPage('leaf-b2', 'hub-b'), mkPage('branch-b1x', 'leaf-b1')];
  const after = buildGraphFromPages(withExtra);
  expect(JSON.stringify(after.hubs[0])).toBe(JSON.stringify(before.hubs[0]));
  // And a hub keeps its own id-seeded dist/scale even when the hub count
  // changes (only the fibonacci base direction may redistribute).
  const alone = buildGraphFromPages([pages[0]]);
  expect(alone.hubs[0].dist).toBe(before.hubs[0].dist);
  expect(alone.hubs[0].scale).toBe(before.hubs[0].scale);
});

test('deleted pages are excluded at every level', () => {
  const pages = fixture();
  pages.find((p) => p.id === 'leaf-a2').deleted = true;
  pages.find((p) => p.id === 'hub-b').deleted = true;
  const { hubs } = buildGraphFromPages(pages);
  expect(hubs.map((h) => h.page.id)).toEqual(['hub-a']);
  expect(hubs[0].leaves.map((l) => l.page.id)).not.toContain('leaf-a2');
});

test('leaf offsets stay inside the hub budget so nodes cannot leave the globe', () => {
  const pages = [
    mkPage('hub-a'),
    ...Array.from({ length: 24 }, (_, i) => mkPage(`leaf-${i}`, 'hub-a')),
  ];
  const { hubs } = buildGraphFromPages(pages);
  const budget = GLOBE_R * 0.94 - hubs[0].dist;
  for (const l of hubs[0].leaves) {
    expect(len(l.rest)).toBeLessThanOrEqual(budget + 1e-9);
  }
});
