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
  }

  // 12 meridian circles.
  for (let m = 0; m < 12; m++) {
    group.add(new THREE.LineLoop(meridianGeometry((m / 12) * Math.PI, 128), wireMat));
  }

  // One bright equator at 160 segments.
  group.add(new THREE.LineLoop(circleGeometry(R, 160), equatorMat));

  // Radial fan: 144 spokes at y = 0 from r = 65 to r = 300, single draw call.
  const spokes = 144;
  const fanPositions = new Float32Array(spokes * 2 * 3);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    fanPositions.set([cos * 65, 0, sin * 65, cos * R, 0, sin * R], i * 6);
  }
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(fanPositions, 3));
  group.add(new THREE.LineSegments(fanGeo, fanMat));
}

function buildRings() {
  // Thin crimson tori around the nucleus (DESIGN_SPEC · ORBITAL RINGS).
  const rings = new THREE.Group();
  rings.name = 'rings';

  const radii = [115, 150, 205, 250];
  const tubes = [1.2, 1.0, 0.9, 0.8];
  const colors = [0xe0356b, 0xc22f5f, 0x93264a, 0x6e1f3d];
  const opacities = [0.75, 0.5, 0.4, 0.3];
  const tiltX = [0.16, -0.1, 0.24, -0.3];
  const rotY = [0.4, -0.7, 1.4, 2.3];

  radii.forEach((radius, i) => {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tubes[i], 8, 96),
      new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: opacities[i],
        depthWrite: false,
      })
    );
    torus.rotation.x = Math.PI / 2 + tiltX[i];
    torus.rotation.y = rotY[i];
    rings.add(torus);
  });

  return rings;
}

function randomDirection(rand) {
  const u = rand() * 2 - 1;
  const phi = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(phi), u, s * Math.sin(phi)];
}

function buildPointsCloud({ count, minR, maxR, size, dimFactor, opacity, rand }) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const [dx, dy, dz] = randomDirection(rand);
    const r = minR + rand() * (maxR - minR);
    positions.set([dx * r, dy * r, dz * r], i * 3);
    color.set(NODE_PALETTE[Math.floor(rand() * NODE_PALETTE.length)]);
    color.multiplyScalar(dimFactor);
    colors.set([color.r, color.g, color.b], i * 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geo, mat);
}

function buildStream(fromDir, toDir, rand) {
  // 46 warm dots scattered along a bezier arc hugging the shell at ~0.82 R.
  const shellR = 0.82 * R;
  const count = 46;

  const from = new THREE.Vector3(...fromDir).normalize().multiplyScalar(shellR);
  const to = new THREE.Vector3(...toDir).normalize().multiplyScalar(shellR);
  const mid1 = from.clone().lerp(to, 0.33).normalize().multiplyScalar(shellR * 1.06);
  const mid2 = from.clone().lerp(to, 0.66).normalize().multiplyScalar(shellR * 1.06);
  const curve = new THREE.CubicBezierCurve3(from, mid1, mid2, to);
  const samples = curve.getPoints(count - 1);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warm = [new THREE.Color('#ffb454'), new THREE.Color('#ffd166')];

  samples.forEach((p, i) => {
    positions.set(
      [
        p.x + (rand() - 0.5) * 9,
        p.y + (rand() - 0.5) * 9,
        p.z + (rand() - 0.5) * 9,
      ],
      i * 3
    );
    const c = warm[Math.floor(rand() * warm.length)];
    colors.set([c.r, c.g, c.b], i * 3);
