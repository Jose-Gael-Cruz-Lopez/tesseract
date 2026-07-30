// Shared dot texture (from the reference) + our tesseract nucleus (kept).

import * as THREE from 'three';

// Soft radial dot texture, shared by every sprite and points cloud.
let dotTexture = null;
export function makeDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
