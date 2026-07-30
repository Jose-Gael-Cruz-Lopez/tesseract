// The Mnemosphere graph: a 3D force-directed view of the workspace, rendered by
// 3d-force-graph (three.js + d3-force-3d) instead of the hand-written globe
// scene it replaces.
//
// Two modes share this one engine. Knowledge mode reads the page store and
// subscribes to 'pages' events; Developer mode is handed a `provider` whose
// getGraph() returns the same {nodes, links} shape from canopy. The engine
// never learns which mode it is in — a node's `kind` ('hub' | 'leaf') is all it
// needs to route a click.

import ForceGraph3D from '3d-force-graph';
import { buildGraphFromPages, escapeHtml } from './graph-data.js';
import { getPages, onStore, offStore } from '../data/store.js';

export { buildGraphFromPages };

const THEMES = {
  dark: { bg: '#05060a', link: 'rgba(200,210,255,0.22)' },
  light: { bg: '#f7f7f5', link: 'rgba(40,50,80,0.25)' },
};
