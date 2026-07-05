import './styles.css';

import * as THREE from 'three';

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

// No post-processing: the scene renders straight to the canvas so nothing
// blooms or glows. Black background, solid nodes, plain wireframe.
const renderer = graph.renderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

window.addEventListener('resize', () => {
  graph.width(window.innerWidth).height(window.innerHeight);
});

// Resilience: a lost WebGL context gets a friendly reload message instead of
// a frozen black canvas.
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  document.getElementById('gl-lost').classList.add('visible');
});

setupInteractions(graph, data, container);
startAnimation();

// Diagnostics: single three copy + draw call budget (target < 150).
console.log(
  `[second-brain-globe] three r${THREE.REVISION}, ` +
    `${data.nodes.length} nodes / ${data.links.length} links`
);

// Accumulate over 10 frames and report the per-frame average.
function reportDrawCalls(tag) {
  const info = renderer.info;
  info.autoReset = false;
  info.reset();
  let frames = 0;
  (function count() {
    if (++frames <= 10) return requestAnimationFrame(count);
    console.log(
      `[second-brain-globe] ${tag} draw calls/frame:`,
      Math.round(info.render.calls / 10)
    );
    info.autoReset = true;
  })();
}

requestAnimationFrame(() => reportDrawCalls('first paint'));
graph.onEngineStop(() => console.log('[second-brain-globe] simulation frozen'));

// Dev handle for inspecting the scene from the console.
window.__SBG__ = { graph, renderer, focusState };
