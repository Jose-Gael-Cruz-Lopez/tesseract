// Force graph creation + config (DESIGN_SPEC · WORLD, GRAPH DATA, TETHERS).

import ForceGraph3D from '3d-force-graph';
import { focusState, REDUCED_MOTION } from './animate.js';
import { buildTesseract, buildHubBall } from './nodes.js';

export const CAMERA_HOME = { x: 0, y: 150, z: 780 };
