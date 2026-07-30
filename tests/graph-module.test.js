// @vitest-environment happy-dom
import { test, expect, vi } from 'vitest';

// initGraph constructs a WebGL renderer, which happy-dom cannot provide, so the
// engine's visual behaviour is verified in a real browser. What IS testable here
// is the contract every consumer depends on: app.js calls exactly these five
// methods, and drift in any of them breaks the app with nothing else noticing.
//
// The original version of this file asserted only `typeof initGraph === 'function'`,
// which stayed green against an initGraph gutted to return a single method. This
// enumerates the contract and exercises the disposal path instead.

const REQUIRED = ['focusPage', 'clearFocus', 'setVisible', 'dispose', 'refresh'];

// A chainable stand-in for the 3d-force-graph instance: every configuration call
// returns itself, graphData() answers with an empty graph, and the teardown and
// animation hooks record that they were called.
function makeStub() {
  const calls = { destructor: 0, pause: 0, resume: 0 };
  const inst = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'graphData') return () => ({ nodes: [], links: [] });
      if (prop === '_destructor') return () => { calls.destructor++; };
      if (prop === 'pauseAnimation') return () => { calls.pause++; return inst; };
      if (prop === 'resumeAnimation') return () => { calls.resume++; return inst; };
      return () => inst;
    },
  });
  return { inst, calls };
}

test('exposes initGraph and re-exports the builder', async () => {
  const graph = await import('../src/graph/graph.js');
  expect(typeof graph.initGraph).toBe('function');
  expect(typeof graph.buildGraphFromPages).toBe('function');
});

// `hooks` and `provider` are optional (they carry defaults, so Function.length
// is 1 — asserting on that would test JS semantics, not our contract). What
// matters is that a container-only call still yields a working handle, since
