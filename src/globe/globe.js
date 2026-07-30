// The Mnemosphere globe: the three.js scene extracted from the old main.js,
// now driven by the page store instead of procedural cluster data.
//
// Hubs are the store's top-level pages, leaves their children, branches their
// grandchildren (see globe-data.js for the deterministic layout). The module
// subscribes to store 'pages' events and rebuilds the affected hub — or the
// whole graph when top-level pages appear/disappear — so the globe tracks the
// workspace live. Everything scene-related stays inside initGlobe(); importing
// this module has no DOM side effects.

import * as THREE from 'three';
import { makeDotTexture, buildTesseract } from './nodes.js';
import { buildGraphFromPages, mulberry32, GLOBE_R } from './globe-data.js';
import { getPages, getPage, onStore, offStore } from '../data/store.js';

export { buildGraphFromPages };

/**
 * @param {HTMLElement} container  the canvas renders into this element
 * @param {{onOpenPage?(pageId), onHubFocus?(pageId|null)}} hooks
 * @returns {{focusPage(id), clearFocus(), setVisible(bool), dispose()}}
 */
export function initGlobe(container, hooks = {}, provider = null) {
  const onOpenPage = hooks.onOpenPage || (() => {});
  const onHubFocus = hooks.onHubFocus || (() => {});

  // Match the reference's r128 color look: no sRGB<->linear conversion, raw
  // output. (three r152+ enables color management by default.)
  THREE.ColorManagement.enabled = false;

  // Decorative-only RNG (streams, dust, stars, tether jitter, pulse phases).
  // Cluster layout randomness lives in globe-data.js, keyed by page id.
  const rand = mulberry32(42);

  const R = GLOBE_R;
  const paletteHex = [0xffd166, 0xffb454, 0xff5d8f, 0xff2d55, 0xc8b6ff, 0xe8ecff, 0x86d1ff];

  /* ---------- chrome elements inside the container ---------- */
  container.classList.add('gl-stage');
  const mkDiv = (cls, text) => {
    const d = document.createElement('div');
    d.className = cls;
    if (text) d.textContent = text;
    container.appendChild(d);
