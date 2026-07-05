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
    .backgroundColor('#060310')
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
    .nodeRelSize(4)
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
