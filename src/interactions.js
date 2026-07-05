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

export function setupInteractions(graph, data, container) {
  const panel = document.getElementById('focus-panel');

  // cluster -> { hub, count } (count includes the hub, its leaves and branches)
  const clusters = new Map();
  for (const node of data.nodes) {
    if (!node.cluster) continue;
    if (!clusters.has(node.cluster)) clusters.set(node.cluster, { hub: null, count: 0 });
    const entry = clusters.get(node.cluster);
    entry.count += 1;
    if (node.type === 'hub') entry.hub = node;
  }

  // Re-applying the accessors with fresh function identities makes the
  // library re-digest colors/particles without rebuilding custom objects.
  function refreshStyling() {
    graph
      .nodeColor((n) => nodeColorOf(n))
      .linkColor((l) => linkColorOf(l))
      .linkDirectionalParticles((l) => particleCountOf(l))
      .linkDirectionalParticleSpeed((l) => particleSpeedOf(l));
  }

  function showPanel(hub) {
    const entry = clusters.get(hub.cluster);
    const orbitPct = Math.round(
      (Math.hypot(hub.fx, hub.fy, hub.fz) / GLOBE_RADIUS) * 100
    );
    panel.querySelector('.panel-title').textContent = hub.cluster;
    panel.querySelector('.panel-count').textContent = `${entry.count} nodes`;
    panel.querySelector('.panel-orbit').textContent = `orbit at ${orbitPct}% radius`;
    panel.classList.add('visible');
  }

  function hidePanel() {
    panel.classList.remove('visible');
  }

  function focusHub(hub) {
    const previous = focusState.hub;
    if (previous && previous !== hub && previous.__ball) {
      previous.__ball.hoverTarget = 1;
    }

    focusState.cluster = hub.cluster;
    focusState.hub = hub;
    if (hub.__ball) hub.__ball.hoverTarget = 1.25;

    refreshStyling();
    graph.controls().autoRotate = false;

    const distance = Math.hypot(hub.x, hub.y, hub.z) || 1;
    const ratio = 1 + FOCUS_DISTANCE / distance;
    graph.cameraPosition(
      { x: hub.x * ratio, y: hub.y * ratio, z: hub.z * ratio },
      hub,
      FLY_IN_MS
    );

    showPanel(hub);
  }

  function release() {
    if (!focusState.hub) return;

    const previous = focusState.hub;
    focusState.cluster = null;
    focusState.hub = null;
    if (previous.__ball) previous.__ball.hoverTarget = 1;

    refreshStyling();
    hidePanel();
    graph.cameraPosition(CAMERA_HOME, { x: 0, y: 0, z: 0 }, FLY_HOME_MS);

    setTimeout(() => {
      // Only resume the idle orbit if the user did not re-focus mid-flight.
      if (!focusState.hub && !REDUCED_MOTION) graph.controls().autoRotate = true;
    }, FLY_HOME_MS);
  }

  let hoveredHub = null;
  graph.onNodeHover((node) => {
    if (hoveredHub && hoveredHub.__ball && hoveredHub !== focusState.hub) {
      hoveredHub.__ball.hoverTarget = 1;
    }
    hoveredHub = node && node.type === 'hub' ? node : null;
    if (hoveredHub && hoveredHub.__ball) hoveredHub.__ball.hoverTarget = 1.25;

    container.style.cursor = node && node.type !== 'core' ? 'pointer' : null;
  });

  graph.onNodeClick((node) => {
    if (!node || node.type === 'core') return;
    // Clicking a leaf or branch focuses its parent cluster, same flow.
    const hub = node.type === 'hub' ? node : clusters.get(node.cluster)?.hub;
    if (!hub) return;
    if (focusState.hub === hub) {
      release(); // clicking the focused hub again releases
    } else {
      focusHub(hub);
    }
  });

  graph.onBackgroundClick(release);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') release();
  });
}
