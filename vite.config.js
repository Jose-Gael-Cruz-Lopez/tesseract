import { defineConfig } from 'vite';

// resolve.dedupe is insurance against ever bundling two copies of three:
// 3d-force-graph and its sub-packages must share the single pinned instance.
export default defineConfig({
  resolve: {
    dedupe: ['three'],
  },
});
