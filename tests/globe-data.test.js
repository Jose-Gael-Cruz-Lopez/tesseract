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
