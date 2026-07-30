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
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';

  const vignette = mkDiv('gl-vignette');
  const tooltip = mkDiv('gl-tooltip');
  const hint = mkDiv('gl-hint', 'drag to rotate · scroll to zoom · click a hub or a dot');

  const universe = new THREE.Group();
  scene.add(universe);

  // Lights for the lit tesseract cube (everything else is MeshBasic / points /
  // sprites / lines and ignores them).
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
  keyLight.position.set(1, 1.2, 1);
  scene.add(keyLight);

  const dotTex = makeDotTexture();

  function randDir() {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (v.lengthSq() < 1e-4) v.set(1, 0, 0);
    return v.normalize();
  }

  function makePoints(positions, colors, size, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size, map: dotTex, vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: palette().blending, sizeAttenuation: true,
    });
    return new THREE.Points(geo, mat);
  }

  /* ---------- globe wireframe ---------- */
  const thinLine = new THREE.LineBasicMaterial({ color: palette().thin, transparent: true, opacity: palette().thinOp });

  function latCircleGeo(radius, y, segments) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const phi = (lat * Math.PI) / 180;
    universe.add(new THREE.LineLoop(latCircleGeo(R * Math.cos(phi), R * Math.sin(phi), 128), thinLine));
  }
  function meridianGeo(segments) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }
  for (let i = 0; i < 12; i++) {
    const m = new THREE.LineLoop(meridianGeo(128), thinLine);
    m.rotation.y = (i * Math.PI) / 12;
    universe.add(m);
  }
  /* bright equator ring */
  const equatorMat = new THREE.LineBasicMaterial({ color: palette().equator, transparent: true, opacity: palette().equatorOp });
  universe.add(new THREE.LineLoop(latCircleGeo(R, 0, 160), equatorMat));
  /* dense radial fan disc at the equator plane */
  const fanPts = [];
  for (let a = 0; a < 360; a += 2.5) {
    const r = (a * Math.PI) / 180;
    fanPts.push(
      new THREE.Vector3(Math.cos(r) * 2.4, 0, Math.sin(r) * 2.4),
      new THREE.Vector3(Math.cos(r) * R, 0, Math.sin(r) * R)
    );
  }
  const fanMat = new THREE.LineBasicMaterial({ color: palette().fan, transparent: true, opacity: palette().fanOp });
  universe.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fanPts), fanMat));

  /* ---------- tesseract core ---------- */
  const core = new THREE.Group();
  universe.add(core);
  const tesseract = buildTesseract();
  core.add(tesseract.group);

  /* ---------- crimson orbital rings ---------- */
  const ringGroup = new THREE.Group();
  universe.add(ringGroup);
  function makeRing(radius, color, op, tiltX, tiltY, tube) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 8, 220),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op })
    );
    m.rotation.set(Math.PI / 2 + tiltX, tiltY, 0);
    return m;
  }
  ringGroup.add(makeRing(4.3, 0xe0356b, 0.75, 0.16, 0.4, 0.028));
  ringGroup.add(makeRing(5.6, 0xc22f5f, 0.5, -0.1, -0.7, 0.022));
  ringGroup.add(makeRing(7.6, 0x93264a, 0.4, 0.24, 1.4, 0.02));
  ringGroup.add(makeRing(9.4, 0x6e1f3d, 0.3, -0.3, 2.3, 0.018));

  /* ---------- clusters (store-driven) ---------- */
  const clusters = [];
  const hubSprites = [];
  const threads = [];
  const title = (p) => (p && p.title) || 'Untitled';

  // Session-continuity caches so a rebuild never snaps a dragged hub back or
  // makes settled leaves jump: positions/velocities survive by page id.
  const hubPosCache = new Map(); // pageId -> Vector3
  const nodeCache = new Map();   // pageId -> {pos: Vector3, vel: Vector3}

  // (Re)build a tether's curve + geometry from its hub's current position, so
  // the tether follows when the hub is dragged around.
  function retetherThread(thread) {
    const end = thread.cluster.group.position;
    const c = thread.curve;
    c.v0.copy(end).normalize().multiplyScalar(2.1);
    c.v1.copy(end).multiplyScalar(0.5).addScaledVector(thread.jitterDir, end.length() * 0.14);
    c.v2.copy(end).multiplyScalar(0.965);
    thread.line.geometry.setFromPoints(c.getPoints(48));
  }

  // Spring particles from a hub spec's leaves: pos/vel integrated each frame,
  // rest is the offset from the anchor (hub for leaves, parent leaf for
  // branches). Cached positions win so rebuilds don't pop.
  function buildNodes(spec, hubPos) {
    let maxOff = 0;
    const pnodes = spec.leaves.map((l) => {
      const rest = new THREE.Vector3().fromArray(l.rest);
      const abs = l.parentIdx < 0
        ? rest.clone()
        : new THREE.Vector3().fromArray(spec.leaves[l.parentIdx].rest).add(rest);
      maxOff = Math.max(maxOff, abs.length());
      const cached = nodeCache.get(l.page.id);
      return {
        pos: cached ? cached.pos.clone() : hubPos.clone().add(abs),
        vel: cached ? cached.vel.clone() : new THREE.Vector3(),
        rest, parent: l.parentIdx, col: l.col, major: l.major,
