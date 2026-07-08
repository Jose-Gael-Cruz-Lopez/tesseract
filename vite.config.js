import { defineConfig } from 'vite';

// resolve.dedupe is insurance against ever bundling two copies of three:
// 3d-force-graph and its sub-packages must share the single pinned instance.
export default defineConfig({
  resolve: {
    dedupe: ['three'],
  },
  // Vitest reads the `test` key from this same config (no separate
  // vitest.config.js).
  test: {
    // Node 22+ ships an experimental global `localStorage` that shadows the
    // one happy-dom/jsdom would otherwise install for DOM tests, and Node's
    // stub throws on every call unless `--localstorage-file` is set. Disable
    // it in the worker processes so vitest's DOM environments can install
    // their own working Storage implementation instead.
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--no-experimental-webstorage'],
      },
    },
  },
});
