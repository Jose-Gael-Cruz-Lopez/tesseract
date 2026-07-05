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
