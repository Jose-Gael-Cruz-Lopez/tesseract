// Environment layers (DESIGN_SPEC · ENVIRONMENT): wireframe globe, radial fan,
// crimson rings, dust, stars, streams and the year label. Everything hangs off
// one "environment" group added to graph.scene(); nothing here raycasts.

import * as THREE from 'three';
import { GLOBE_RADIUS, NODE_PALETTE } from './data/generateBrain.js';
import { makeGlowTexture } from './nodes.js';

const R = GLOBE_RADIUS;
