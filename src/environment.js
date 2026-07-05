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
    const t = (i / segments) * Math.PI * 2;
    const r = Math.sin(t) * R;
    positions[i * 3] = r * Math.cos(phi);
    positions[i * 3 + 1] = Math.cos(t) * R;
    positions[i * 3 + 2] = r * Math.sin(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

function buildWireGlobe(group) {
  // One shared material per opacity tier keeps materials countable.
  const wireMat = new THREE.LineBasicMaterial({
    color: 0xa9b0d6,
    transparent: true,
    opacity: 0.14,
  });
  const equatorMat = new THREE.LineBasicMaterial({
    color: 0xdfe4ff,
    transparent: true,
    opacity: 0.5,
  });
  const fanMat = new THREE.LineBasicMaterial({
    color: 0x9aa0c8,
    transparent: true,
    opacity: 0.06,
  });

  // Latitude circles every 15° from -75 to +75, 128 segments each.
  for (let lat = -75; lat <= 75; lat += 15) {
    const rad = (lat * Math.PI) / 180;
    const loop = new THREE.LineLoop(
      circleGeometry(Math.cos(rad) * R, 128, Math.sin(rad) * R),
      wireMat
    );
    group.add(loop);
