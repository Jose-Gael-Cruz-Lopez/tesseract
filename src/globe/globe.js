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
    return d;
  };

  /* ---------- renderer / scene ---------- */
  const width = () => container.clientWidth || window.innerWidth;
  const height = () => container.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width() / height(), 0.1, 400);
  const camDir = new THREE.Vector3(0, 0.18, 1).normalize();
  let camDist = 30, curDist = 30;
  camera.position.copy(camDir).multiplyScalar(curDist);
  camera.lookAt(0, 0, 0);

  // Theme-aware palette. The globe isn't styled by CSS tokens, so it repaints
  // itself in sync with the app theme: light mode gets a light background,
  // normal-blended dots (additive glow is invisible on light) and darker
  // structure lines; dark mode keeps the original deep-space look.
  const GLOBE_THEMES = {
    dark: {
      clear: 0x060310, blending: THREE.AdditiveBlending,
      thin: 0xa9b0d6, thinOp: 0.14, equator: 0xdfe4ff, equatorOp: 0.5,
      fan: 0x9aa0c8, fanOp: 0.06, clusterLine: 0xd6dbf5, hub: 0xfff3dd,
    },
    light: {
      clear: 0xedeef5, blending: THREE.NormalBlending,
      thin: 0x8087b0, thinOp: 0.55, equator: 0x515da6, equatorOp: 0.6,
      fan: 0x8087b0, fanOp: 0.2, clusterLine: 0x8e95c6, hub: 0x474459,
    },
  };
  let currentTheme = (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') ? 'dark' : 'light';
  const palette = () => GLOBE_THEMES[currentTheme];
  container.classList.toggle('gl-light', currentTheme === 'light');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // raw output, like r128
  renderer.setClearColor(palette().clear, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width(), height());
  container.appendChild(renderer.domElement);
