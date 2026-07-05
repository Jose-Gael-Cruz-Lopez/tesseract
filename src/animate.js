// One requestAnimationFrame loop for all continuous motion (DESIGN_SPEC ·
// MOTION RULES). Runs independently of the force simulation: the sim freezes
// after cooldown, this loop never stops.
//
// This module is also the shared-state hub (registry + focusState) so that
// graph.js, nodes.js and interactions.js can communicate without import cycles.

