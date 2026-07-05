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
