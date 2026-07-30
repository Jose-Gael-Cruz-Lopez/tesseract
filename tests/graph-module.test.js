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
