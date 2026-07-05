// Hover, click-to-focus, focus panel and keyboard release (DESIGN_SPEC · UI CHROME).

import { focusState, REDUCED_MOTION } from './animate.js';
import {
  CAMERA_HOME,
  nodeColorOf,
  linkColorOf,
  particleCountOf,
  particleSpeedOf,
} from './graph.js';
import { GLOBE_RADIUS } from './data/generateBrain.js';

const FLY_IN_MS = 1200;
const FLY_HOME_MS = 1000;
const FOCUS_DISTANCE = 190;

