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
