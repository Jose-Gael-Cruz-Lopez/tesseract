// Shared dot texture (from the reference) + our tesseract nucleus (kept).

import * as THREE from 'three';

// Soft radial dot texture, shared by every sprite and points cloud.
let dotTexture = null;
export function makeDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

// The tesseract nucleus, kept from our own build (NOT the reference's cubes):
// a solid lit red cube inside counter-rotating wire cubes and frosted shells,
// no glow. Our R=300 proportions scaled to the reference globe R=11 so it keeps
// the same look relative to the sphere. Returns the group plus a tick(dt) that
// applies the whole-group spin and each cube's own rotation.
export function buildTesseract() {
  const group = new THREE.Group();

  const solidMat = new THREE.MeshLambertMaterial({
    color: 0xff3355,
    transparent: true,
    opacity: 1,
  });
  const solid = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), solidMat);

  const wireA = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.47, 1.47, 1.47)),
    new THREE.LineBasicMaterial({ color: 0xffc9d4, transparent: true, opacity: 0.7 })
  );
  const wireB = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.05, 2.05, 2.05)),
    new THREE.LineBasicMaterial({ color: 0xffdbe3, transparent: true, opacity: 0.35 })
  );

  const shellSizes = [1.76, 2.49, 3.3];
  const shellOps = [0.1, 0.07, 0.045];
  const shells = shellSizes.map((s, i) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshBasicMaterial({
        color: 0xcabfd6,
        transparent: true,
        opacity: shellOps[i],
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    m.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    return m;
  });

  group.add(solid, wireA, wireB, ...shells);

  function tick(dt) {
    // whole group spins about the sphere center
    group.rotation.x += 0.03 * dt;
    group.rotation.y += 0.09 * dt;
    group.rotation.z += 0.02 * dt;
    // each cube counter-rotates at its own pace
    solid.rotation.x += 0.35 * dt;
    solid.rotation.y += 0.5 * dt;
    wireA.rotation.x -= 0.22 * dt;
    wireA.rotation.z += 0.3 * dt;
    wireB.rotation.y += 0.16 * dt;
    wireB.rotation.x += 0.1 * dt;
    shells[0].rotation.y += 0.12 * dt;
    shells[0].rotation.x += 0.05 * dt;
    shells[1].rotation.z -= 0.08 * dt;
    shells[1].rotation.y -= 0.05 * dt;
    shells[2].rotation.x += 0.04 * dt;
    shells[2].rotation.z += 0.03 * dt;
  }

  // parts ordered inside-out by size, for a one-by-one intro reveal.
  return { group, tick, parts: [solid, wireA, shells[0], wireB, shells[1], shells[2]] };
}
