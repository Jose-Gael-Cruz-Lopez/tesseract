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
