// Custom nodeThreeObject factories (DESIGN_SPEC · TESSERACT NUCLEUS, HUB BALLS).

import * as THREE from 'three';
import { registry } from './animate.js';

let glowTexture = null;

// 64px soft radial gradient, built once and shared by every glow sprite,
// the dust clouds and the streams.
export function makeGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

export function buildTesseract() {
  const group = new THREE.Group();

  // Rebuild-safe: nodeThreeObject can be re-invoked; never double-register.
  registry.spinners = registry.spinners.filter((s) => s.tag !== 'tesseract');
  registry.tesseractParts = [];

  const solidMat = new THREE.MeshLambertMaterial({
    color: 0xff3355,
    transparent: true, // so focus mode can dim it
    opacity: 1,
  });
  const solid = new THREE.Mesh(new THREE.BoxGeometry(26, 26, 26), solidMat);

  const wireAMat = new THREE.LineBasicMaterial({
    color: 0xffc9d4,
    transparent: true,
    opacity: 0.7,
  });
  const wireA = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(40, 40, 40)),
    wireAMat
  );

  const wireBMat = new THREE.LineBasicMaterial({
    color: 0xffdbe3,
    transparent: true,
    opacity: 0.35,
  });
  const wireB = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(56, 56, 56)),
    wireBMat
  );

  // Frosted shells 48 / 68 / 90 — outermost is 0.30 R, the hard size cap.
  const shellSizes = [48, 68, 90];
  const shellOpacities = [0.1, 0.07, 0.045];
  const shells = shellSizes.map((side, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcabfd6,
      side: THREE.DoubleSide,
      depthWrite: false,
      transparent: true,
      opacity: shellOpacities[i],
    });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), mat);
    shell.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    return shell;
  });

  // No glow sprite: the nucleus is a solid + wireframe tesseract, no bloom.
  group.add(solid, wireA, wireB, ...shells);

  // Continuous rotation speeds in rad/s. The whole group also spins as one
  // about the sphere's center, so every cube ("square") rotates together on
  // top of its own motion.
  registry.spinners.push(
    { tag: 'tesseract', obj: group, speed: { x: 0.03, y: 0.09, z: 0.02 } },
    { tag: 'tesseract', obj: solid, speed: { x: 0.35, y: 0.5, z: 0 } },
    { tag: 'tesseract', obj: wireA, speed: { x: -0.22, y: 0, z: 0.3 } },
    { tag: 'tesseract', obj: wireB, speed: { x: 0.1, y: 0.16, z: 0 } },
    { tag: 'tesseract', obj: shells[0], speed: { x: 0.05, y: 0.12, z: 0 } },
    { tag: 'tesseract', obj: shells[1], speed: { x: 0, y: -0.05, z: -0.08 } },
    { tag: 'tesseract', obj: shells[2], speed: { x: 0.04, y: 0, z: 0.03 } }
  );

  registry.tesseractParts = [
    { mat: solidMat, base: 1 },
    { mat: wireAMat, base: 0.7 },
    { mat: wireBMat, base: 0.35 },
    { mat: shells[0].material, base: 0.1 },
    { mat: shells[1].material, base: 0.07 },
    { mat: shells[2].material, base: 0.045 },
  ];

  return group;
}

const IVORY = new THREE.Color('#fff3dd');

export function buildHubBall(node) {
  const group = new THREE.Group();
  // 11.6 * weight matches the reference hub footprint: its sprite nominal
  // size (0.85 * scale on globe R = 11) treated as a sphere diameter, scaled
  // to R = 300. weight 0.8..1.7 -> radius ~9.3..19.7.
  const radius = 11.6 * node.weight;
  // Solid 3D sphere, lightly lifted toward ivory so the cluster color still
  // reads. No halo, no bloom: a shaded sphere lit by the graph's default
  // lights, like a standard 3d-force-graph node.
  const tint = new THREE.Color(node.color).lerp(IVORY, 0.2);

  const mat = new THREE.MeshLambertMaterial({
    color: tint,
    transparent: true, // so focus mode can dim it
    opacity: 1,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 24), mat);
  group.add(ball);

  // Refs for the animation loop and interactions: no scene traversal needed.
  node.__ball = {
    group,
    mat,
    radius,
    hoverTarget: 1,
    hoverCurrent: 1,
    dim: 1,
    phase: node.breathePhase ?? 0,
  };
  registry.hubs.set(node.id, node);

  return group;
}
