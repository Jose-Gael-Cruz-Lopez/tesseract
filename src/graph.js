// Force graph creation + config (DESIGN_SPEC · WORLD, GRAPH DATA, TETHERS).

import ForceGraph3D from '3d-force-graph';
import { focusState, REDUCED_MOTION } from './animate.js';
import { buildTesseract, buildHubBall } from './nodes.js';

export const CAMERA_HOME = { x: 0, y: 150, z: 780 };

const LINK_COLORS = {
  tether: 'rgba(255,109,138,0.35)',
  spoke: 'rgba(214,219,245,0.40)',
  branch: 'rgba(214,219,245,0.30)',
};
const DIMMED_LINK = 'rgba(214,219,245,0.04)';
const DIMMED_TETHER = 'rgba(255,109,138,0.05)';
const FOCUSED_TETHER = 'rgba(255,109,138,0.85)';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Focus-aware accessors. Exported so interactions.js can re-apply them when
// focusState changes (fresh function identity forces the library to digest).
export function nodeColorOf(node) {
  if (!focusState.cluster || node.cluster === focusState.cluster) return node.color;
  return hexToRgba(node.color, 0.1);
}
