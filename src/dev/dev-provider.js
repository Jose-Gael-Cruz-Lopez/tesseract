// The globe graph provider for developer mode. Fetches canopy's five read
// surfaces in parallel and maps them onto the globe graph via dev-graph. Any
// surface that fails (offline / 401) is simply omitted — its hub renders empty
// rather than breaking the whole sphere.

import { canopyApi } from './canopy-api.js';
import { buildDevGraph } from './dev-graph.js';

export function devProvider(api = canopyApi) {
  async function fetchAll() {
    const [docs, roadmap, feed, triage, dashboard] = await Promise.all([
      api.getDocs(), api.getRoadmap(), api.getFeed(), api.getTriage(), api.getDashboard(),
    ]);
    const dataOf = (r) => (r && r.ok ? r.data : undefined);
    return {
      docs: dataOf(docs), roadmap: dataOf(roadmap), feed: dataOf(feed),
      triage: dataOf(triage), dashboard: dataOf(dashboard),
    };
  }

  return {
    // The globe engine calls this; returns a Promise (handled by withGraph).
    getGraph: async () => buildDevGraph(await fetchAll()),
    // Also exposed so the sidebar can build from the same data.
    fetchAll,
  };
}
