// Force graph creation + config (DESIGN_SPEC · WORLD, GRAPH DATA, TETHERS).

import ForceGraph3D from '3d-force-graph';
import { focusState, REDUCED_MOTION } from './animate.js';
import { buildTesseract, buildHubBall } from './nodes.js';
import { GLOBE_RADIUS } from './data/generateBrain.js';

export const CAMERA_HOME = { x: 0, y: 150, z: 780 };

// Keep every unpinned node inside the globe: a d3-force that clamps each
// node's distance from origin to <= maxR every tick, so no dot (and therefore
// no link between dots) ever pokes through the wireframe shell.
function radialBound(maxR) {
  let nodes = [];
  const force = () => {
    for (const n of nodes) {
      if (n.fx != null) continue; // core + hubs are pinned and already inside
      const d = Math.hypot(n.x || 0, n.y || 0, n.z || 0);
      if (d > maxR) {
        const s = maxR / d;
        n.x *= s;
        n.y *= s;
        n.z *= s;
        // bleed off the outward velocity so it settles against the shell
        if (n.vx != null) {
          n.vx *= 0.4;
          n.vy *= 0.4;
          n.vz *= 0.4;
        }
      }
    }
  };
  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

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

export function linkColorOf(link) {
  if (!focusState.cluster) return LINK_COLORS[link.kind];
  if (link.cluster !== focusState.cluster) {
    return link.kind === 'tether' ? DIMMED_TETHER : DIMMED_LINK;
  }
  return link.kind === 'tether' ? FOCUSED_TETHER : LINK_COLORS[link.kind];
}

export function particleCountOf(link) {
  if (REDUCED_MOTION || link.kind !== 'tether') return 0;
  return link.cluster === focusState.cluster ? 4 : 2;
}

export function particleSpeedOf(link) {
  if (REDUCED_MOTION) return 0;
  return (link.particleSpeed || 0) * (link.cluster === focusState.cluster ? 2.2 : 1);
}

export function createGraph(container, data) {
  const graph = new ForceGraph3D(container, { controlType: 'orbit' })
    .backgroundColor('#000000')
    .showNavInfo(false)
    .enableNodeDrag(false)
    // Nodes: custom objects for core + hubs, library-default spheres for the rest.
    .nodeThreeObject((node) =>
      node.type === 'core'
        ? buildTesseract()
        : node.type === 'hub'
          ? buildHubBall(node)
          : undefined
    )
    .nodeVal('val')
    .nodeColor(nodeColorOf)
    .nodeOpacity(0.9)
    // 3.55 matches the reference minor-leaf size: val 1 -> radius 3.55,
    // val 7 -> ~6.82 (leaf radius = cbrt(val) * nodeRelSize).
    .nodeRelSize(3.55)
    .nodeResolution(12)
    // The core never shows a tooltip; everything else gets a styled chip.
    .nodeLabel((node) =>
      node.type === 'core' ? null : `<div class="node-chip">${node.label}</div>`
    )
    // Links: rgba alpha carries the transparency (verified: the library
    // multiplies linkOpacity by the color's alpha channel).
    .linkColor(linkColorOf)
    .linkOpacity(1)
    .linkWidth(0)
    .linkCurvature((link) => (link.kind === 'tether' ? 0.18 : 0))
    .linkCurveRotation((link) => link.curveRotation || 0)
    // Energy pulses along the tethers, all values precomputed in the data.
    .linkDirectionalParticles(particleCountOf)
    .linkDirectionalParticleWidth(3.5)
    .linkDirectionalParticleColor(() => '#ffc2cf')
    .linkDirectionalParticleSpeed(particleSpeedOf)
    .linkDirectionalParticleOffset((link) => link.particleOffset || 0)
    .d3VelocityDecay(0.4)
    .warmupTicks(80)
    .cooldownTime(6000);

  // Forces — configured BEFORE data lands so the warmup ticks use them.
  // No centering force: core + hubs are pinned; a center force would drag
  // every leaf toward the origin and crush the dandelion clusters.
  graph.d3Force('center', null);
  graph.d3Force('link').distance((link) => link.distance);
  graph
    .d3Force('charge')
    .strength((node) =>
      node.type === 'leaf' || node.type === 'branch' ? -35 : -160
    );
  // Everything stays inside the shell (0.95 R leaves a hair of margin).
  graph.d3Force('bound', radialBound(GLOBE_RADIUS * 0.95));

  graph.graphData(data);

  graph.cameraPosition(CAMERA_HOME, { x: 0, y: 0, z: 0 });

  const controls = graph.controls();
  controls.autoRotate = !REDUCED_MOTION;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 260;
  controls.maxDistance = 1500;

  return graph;
}
