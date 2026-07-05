// One requestAnimationFrame loop for all continuous motion (DESIGN_SPEC ·
// MOTION RULES). Runs independently of the force simulation: the sim freezes
// after cooldown, this loop never stops.
//
// This module is also the shared-state hub (registry + focusState) so that
// graph.js, nodes.js and interactions.js can communicate without import cycles.

export const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rotation speeds multiply by 0.25 under reduced motion (DESIGN_SPEC · MOTION RULES).
const SPEED_MULTIPLIER = REDUCED_MOTION ? 0.25 : 1;

export const registry = {
  spinners: [], // { obj, speed: {x, y, z} } — tesseract parts, rad/s from the spec
  coreGlow: null, // SpriteMaterial of the core glow (pulsed each frame)
  tesseractParts: [], // { mat, base } — for focus dimming, floor 0.4
  hubs: new Map(), // node.id -> hub node (each carries node.__ball refs)
  rings: null, // THREE.Group of the 4 crimson tori
};

// Focus mode state, mutated by interactions.js, read by accessors + this loop.
export const focusState = { cluster: null, hub: null };

let started = false;

export function startAnimation() {
  if (started) return;
  started = true;

  // Delta comes from the rAF timestamp rather than THREE.Clock, which is
  // deprecated in the pinned three r185 and warns on every load. Same behavior
  // (dt clamped to 0.05, per DESIGN_SPEC · MOTION RULES), no console noise.
  let last = null;
  let t = 0; // motion-time: already scaled by the reduced-motion multiplier
  let tesseractDim = 1;

  function frame(now) {
    requestAnimationFrame(frame);

    if (last === null) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const mdt = dt * SPEED_MULTIPLIER;
    t += mdt;

    for (const s of registry.spinners) {
      s.obj.rotation.x += s.speed.x * mdt;
      s.obj.rotation.y += s.speed.y * mdt;
      s.obj.rotation.z += s.speed.z * mdt;
    }

    if (registry.rings) registry.rings.rotation.y += 0.06 * mdt;

    // Focus dimming for the nucleus: never below ~40% so the center survives.
    const dimTarget = focusState.cluster ? 0.4 : 1;
    tesseractDim += (dimTarget - tesseractDim) * Math.min(1, dt * 6);
    for (const part of registry.tesseractParts) {
      part.mat.opacity = part.base * tesseractDim;
    }
    if (registry.coreGlow) {
      registry.coreGlow.opacity = (0.36 + 0.12 * Math.sin(1.7 * t)) * tesseractDim;
    }

    for (const node of registry.hubs.values()) {
      const b = node.__ball;
      if (!b) continue;

      // Hover/focus swell is lerped toward its target, never snapped.
      b.hoverCurrent += (b.hoverTarget - b.hoverCurrent) * Math.min(1, dt * 8);

      const inFocus = !focusState.cluster || node.cluster === focusState.cluster;
      const dimTargetHub = inFocus ? 1 : 0.1;
      b.dim += (dimTargetHub - b.dim) * Math.min(1, dt * 6);
      b.mat.opacity = b.dim;
      b.haloMat.opacity = 0.55 * b.dim;

      const breath = 1 + 0.06 * Math.sin(2 * t + b.phase);
      b.group.scale.setScalar(breath * b.hoverCurrent);
    }
  }

  requestAnimationFrame(frame);
}
