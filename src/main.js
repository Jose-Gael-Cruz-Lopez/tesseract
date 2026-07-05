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
