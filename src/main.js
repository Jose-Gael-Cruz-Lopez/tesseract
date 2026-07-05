import './styles.css';

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { generateBrain } from './data/generateBrain.js';
import { createGraph } from './graph.js';
import { buildEnvironment } from './environment.js';
import { registry, focusState, startAnimation } from './animate.js';
import { setupInteractions } from './interactions.js';

const container = document.getElementById('app');
const data = generateBrain(42);
const graph = createGraph(container, data);

// Environment: wireframe globe, rings, fan, dust, stars, streams, year label.
const { group: environment, rings } = buildEnvironment();
graph.scene().add(environment);
registry.rings = rings;

// Bloom (DESIGN_SPEC · BLOOM): the red core, hub balls, particles and dust
