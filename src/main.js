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
// glow; threshold keeps the faint wireframe below the bloom cutoff.
// Tuned from the spec's starting point (1.1 / 0.5 / 0.15): at that strength
// every leaf saturated to white and the nucleus drowned in its own glow.
// 0.75 / 0.5 / 0.25 keeps the core, hub balls, particles and dust glowing
// while the wireframe globe and palette colors stay readable.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.75, // strength
  0.5, // radius
  0.25 // threshold
);
graph.postProcessingComposer().addPass(bloomPass);

const renderer = graph.renderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  graph.width(w).height(h);
  graph.postProcessingComposer().setSize(w, h);
