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

