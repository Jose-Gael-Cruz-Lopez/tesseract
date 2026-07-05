// Environment layers (DESIGN_SPEC · ENVIRONMENT): wireframe globe, radial fan,
// crimson rings, dust, stars, streams and the year label. Everything hangs off
// one "environment" group added to graph.scene(); nothing here raycasts.

import * as THREE from 'three';
import { GLOBE_RADIUS, NODE_PALETTE } from './data/generateBrain.js';
import { makeGlowTexture } from './nodes.js';

const R = GLOBE_RADIUS;

function circleGeometry(radius, segments, y = 0) {
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

function meridianGeometry(phi, segments) {
  // Full vertical circle through the poles, rotated phi around Y.
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
