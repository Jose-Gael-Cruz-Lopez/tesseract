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

  const solidMat = new THREE.MeshBasicMaterial({
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

  const glowMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xff4d70,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(130, 130, 1);

  group.add(solid, wireA, wireB, ...shells, glow);
