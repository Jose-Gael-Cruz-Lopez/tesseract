// Map canopy's read DTOs onto the force graph. The developer sphere reuses the
// exact knowledge-graph builder (buildGraphFromPages) by handing it synthetic
// "pages": five top-level category pages (→ hubs) and one child page per canopy
// item (→ orbiting leaves). Each item page carries { devKind, devRef } so a
// click knows what to open. The graph engine renders this graph unchanged.

import { buildGraphFromPages } from '../graph/graph-data.js';

const CATEGORIES = [
  { id: 'cat:docs', title: 'Docs', icon: '📄' },
  { id: 'cat:roadmap', title: 'Roadmap', icon: '🗺️' },
  { id: 'cat:feed', title: 'Feed', icon: '📣' },
  { id: 'cat:triage', title: 'Triage', icon: '🧹' },
  { id: 'cat:mywork', title: 'My Work', icon: '✅' },
];

// Accepts the canopy read DTOs (the `data` of each canopy-api call), any of
// which may be missing. Robust to either the wrapped ({docs:[…]}) or bare-array
// forms.
export function buildDevGraph({ docs, roadmap, feed, triage, dashboard } = {}) {
