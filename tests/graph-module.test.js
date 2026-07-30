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
// that is the shape Knowledge mode uses.
test('hooks and provider are genuinely optional', async () => {
  vi.resetModules();
  const { inst } = makeStub();
  vi.doMock('3d-force-graph', () => ({ default: function () { return inst; } }));

  const { initGraph } = await import('../src/graph/graph.js');
  const el = document.createElement('div');
  document.body.appendChild(el);

  const handle = initGraph(el);
  for (const method of REQUIRED) expect(typeof handle[method]).toBe('function');
  handle.dispose();

  vi.doUnmock('3d-force-graph');
  vi.resetModules();
});

test('the handle carries all five contract methods, and disposal is safe', async () => {
  vi.resetModules();
  const { inst, calls } = makeStub();
  vi.doMock('3d-force-graph', () => ({ default: function () { return inst; } }));

  const { initGraph } = await import('../src/graph/graph.js');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = initGraph(el, {}, { getGraph: async () => ({ nodes: [], links: [] }) });

  for (const method of REQUIRED) {
    expect(typeof handle[method], `handle.${method} must be a function`).toBe('function');
  }

  // app.js disposes on mode switch AND on log out, so a double dispose is a real
  // sequence, not a hypothetical.
  expect(() => { handle.dispose(); handle.dispose(); }).not.toThrow();
  expect(calls.destructor).toBe(1); // torn down exactly once

  // After disposal the handle must be inert. Without the guard, setVisible(true)
  // restarts an animation loop on a destroyed renderer.
  expect(() => {
    handle.setVisible(true);
    handle.clearFocus();
    handle.focusPage('nope');
    handle.refresh();
  }).not.toThrow();
  expect(calls.resume).toBe(0);

  vi.doUnmock('3d-force-graph');
  vi.resetModules();
});
