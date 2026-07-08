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
export function initGlobe(container, hooks = {}) {
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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // raw output, like r128
  renderer.setClearColor(0x060310, 1);
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
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    return new THREE.Points(geo, mat);
  }

  /* ---------- globe wireframe ---------- */
  const thinLine = new THREE.LineBasicMaterial({ color: 0xa9b0d6, transparent: true, opacity: 0.14 });

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
  const equatorMat = new THREE.LineBasicMaterial({ color: 0xdfe4ff, transparent: true, opacity: 0.5 });
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
  const fanMat = new THREE.LineBasicMaterial({ color: 0x9aa0c8, transparent: true, opacity: 0.06 });
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
        page: l.page, parentPageId: l.page.parentId,
      };
    });
    return { pnodes, maxOff };
  }

  // Rebuild a cluster's point clouds + connector lines from its current pnodes.
  // The buffers are fixed-size, so this runs after any node add/remove; the
  // major/minor split and colors are derived from the nodes themselves.
  function rebuildClusterGeometry(c) {
    const majIdx = [], minIdx = [], majCol = [], minCol = [];
    c.pnodes.forEach((n, k) => {
      const col = n.col || [1, 1, 1];
      if (n.major) { majIdx.push(k); majCol.push(col[0], col[1], col[2]); }
      else { minIdx.push(k); minCol.push(col[0], col[1], col[2]); }
    });
    c.majIdx = majIdx; c.minIdx = minIdx; c.majCol = majCol; c.minCol = minCol;
    const flat = (idxs) => { const a = []; idxs.forEach((ix) => { const q = c.pnodes[ix].pos; a.push(q.x, q.y, q.z); }); return a; };
    if (c.major) {
      universe.remove(c.major, c.minor, c.lineSeg);
      c.major.geometry.dispose(); c.major.material.dispose();
      c.minor.geometry.dispose(); c.minor.material.dispose();
      c.lineSeg.geometry.dispose(); c.lineSeg.material.dispose();
    }

    const major = makePoints(flat(majIdx), majCol, 0.5, 0.95);
    const minor = makePoints(flat(minIdx), minCol, 0.26, 0.9);
    const linePts = new Float32Array(c.pnodes.length * 6);
    c.pnodes.forEach((n, k) => {
      const from = n.parent < 0 ? c.group.position : c.pnodes[n.parent].pos;
      linePts.set([from.x, from.y, from.z, n.pos.x, n.pos.y, n.pos.z], k * 6);
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePts, 3));
    const lineSeg = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xd6dbf5, transparent: true, opacity: c.baseLineOp }));
    universe.add(major, minor, lineSeg);
    // Back-links so a Points raycast hit can be mapped to a page.
    major.userData = { cluster: c, kind: 'maj' };
    minor.userData = { cluster: c, kind: 'min' };

    c.major = major; c.minor = minor; c.lineSeg = lineSeg;
    c.majorMat = major.material; c.minorMat = minor.material; c.lineMat = lineSeg.material;
    // Keep the currently-eased opacity so nothing pops when geometry swaps.
    const rv = c.revealFactor ?? 1;
    c.majorMat.opacity = (c._majOp ?? c.baseMajOp) * rv;
    c.minorMat.opacity = (c._minOp ?? c.baseMinOp) * rv;
    c.lineMat.opacity = (c._lineOp ?? c.baseLineOp) * rv;
  }

  // Build one cluster (hub sprite + spring nodes + tether) from a graph spec.
  function makeCluster(spec) {
    const g = new THREE.Group();
    const cachedPos = hubPosCache.get(spec.page.id);
    if (cachedPos) g.position.copy(cachedPos);
    else g.position.set(spec.dir[0], spec.dir[1], spec.dir[2]).multiplyScalar(spec.dist);

    const hubMat = new THREE.SpriteMaterial({
      map: dotTex, color: 0xfff3dd, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const hub = new THREE.Sprite(hubMat);
    const hubBase = 0.85 * spec.scale;
    hub.scale.set(hubBase, hubBase, 1);
    g.add(hub);
    universe.add(g);

    const { pnodes, maxOff } = buildNodes(spec, g.position);

    const cluster = {
      page: spec.page, group: g, hub, hubMat, hubBase,
      major: null, minor: null, lineSeg: null,
      majorMat: null, minorMat: null, lineMat: null,
      pnodes, majIdx: [], minIdx: [], majCol: [], minCol: [],
      baseLineOp: 0.34, baseMajOp: 0.95, baseMinOp: 0.9, hubBaseOp: 0.95,
      maxOffset: maxOff,
      scale: spec.scale, dist: spec.dist, budget: R * 0.94 - spec.dist,
      accent: spec.accent,
      phase: rand() * Math.PI * 2,
    };
    hub.userData.cluster = cluster;
    // Reveal/opacity state; the intro (if still running) re-drives revealFactor.
    cluster._lineOp = cluster.baseLineOp; cluster._majOp = cluster.baseMajOp;
    cluster._minOp = cluster.baseMinOp; cluster._hubOp = cluster.hubBaseOp;
    cluster.revealFactor = introDone ? 1 : 0;
    rebuildClusterGeometry(cluster);
    clusters.push(cluster);
    hubSprites.push(hub);

    /* tether: curved thread from the core out to this hub */
    const jitterDir = randDir();
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
    );
    const tMat = new THREE.LineBasicMaterial({ color: 0xff6d8a, transparent: true, opacity: 0.26 });
    const tLine = new THREE.Line(new THREE.BufferGeometry(), tMat);
    universe.add(tLine);

    const pulseMat = new THREE.SpriteMaterial({
      map: dotTex, color: 0xffc2cf, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pulse = new THREE.Sprite(pulseMat);
    pulse.scale.set(0.34, 0.34, 1);
    universe.add(pulse);

    const thread = {
      curve, line: tLine, jitterDir, mat: tMat, baseOp: 0.26,
      pulse, pulseMat, t: rand(), speed: 0.1 + rand() * 0.16, cluster,
    };
    thread._op = introDone ? thread.baseOp : 0;
    if (!introDone) { thread.mat.opacity = 0; thread.pulseMat.opacity = 0; }
    cluster.thread = thread;
    threads.push(thread);
    retetherThread(thread);
    return cluster;
  }

  function cacheCluster(c) {
    hubPosCache.set(c.page.id, c.group.position.clone());
    for (const n of c.pnodes) nodeCache.set(n.page.id, { pos: n.pos.clone(), vel: n.vel.clone() });
  }

  function disposeCluster(c) {
    universe.remove(c.group, c.major, c.minor, c.lineSeg);
    c.major.geometry.dispose(); c.major.material.dispose();
    c.minor.geometry.dispose(); c.minor.material.dispose();
    c.lineSeg.geometry.dispose(); c.lineSeg.material.dispose();
    c.hubMat.dispose();
    const th = c.thread;
    if (th) {
      universe.remove(th.line, th.pulse);
      th.line.geometry.dispose(); th.mat.dispose(); th.pulseMat.dispose();
      const ti = threads.indexOf(th);
      if (ti >= 0) threads.splice(ti, 1);
    }
  }

  // Tear down every cluster and rebuild the whole graph from the store.
  function rebuildAll() {
    const focusedId = selected ? selected.page.id : null;
    for (const c of clusters) { cacheCluster(c); disposeCluster(c); }
    clusters.length = 0;
    hubSprites.length = 0;
    for (const spec of buildGraphFromPages(getPages()).hubs) makeCluster(spec);
    if (focusedId) {
      const again = clusters.find((c) => c.page.id === focusedId);
      if (again) selected = again;
      else { selected = null; camDist = preFocusDist; onHubFocus(null); }
    }
    hoverNode = null; hoverCluster = null;
  }

  // Rebuild just one hub's nodes (children/grandchildren changed).
  function rebuildHub(cluster) {
    const spec = buildGraphFromPages(getPages()).hubs.find((h) => h.page.id === cluster.page.id);
    if (!spec) { rebuildAll(); return; }
    cacheCluster(cluster);
    const { pnodes, maxOff } = buildNodes(spec, cluster.group.position);
    cluster.pnodes = pnodes;
    cluster.maxOffset = maxOff;
    rebuildClusterGeometry(cluster);
    if (hoverNode && hoverNode.cluster === cluster) hoverNode = null;
  }

  // Walk parentId links up to the top-level ancestor (the hub page).
  function topAncestor(page) {
    let p = page, guard = 0;
    while (p && p.parentId != null && guard++ < 100) p = getPage(p.parentId);
    return p || null;
  }

  function findClusterForPage(id) {
    return (
      clusters.find((c) => c.page.id === id) ||
      clusters.find((c) => c.pnodes.some((n) => n.page.id === id)) ||
      null
    );
  }

  // Store subscription: content edits are free (pnodes hold live page records,
  // so titles refresh on the next tooltip); structural changes rebuild the
  // affected hub, and top-level changes rebuild the whole graph.
  function onPagesEvent(detail) {
    if (disposed) return;
    const page = detail && detail.page;
    if (!page) { rebuildAll(); return; }
    if (page.parentId == null) {
      if (detail.type === 'update' && clusters.some((c) => c.page.id === page.id)) return;
      rebuildAll();
      return;
    }
    if (detail.type === 'update') {
      const holder = findClusterForPage(page.id);
      const node = holder && holder.pnodes.find((n) => n.page.id === page.id);
      if (node && node.parentPageId === page.parentId) return; // content-only edit
      rebuildAll(); // re-parented (or previously unknown) page
      return;
    }
    const hubPage = topAncestor(page);
    const cluster = hubPage && clusters.find((c) => c.page.id === hubPage.id);
    if (cluster) rebuildHub(cluster);
    else rebuildAll();
  }
  onStore('pages', onPagesEvent);

  /* ---------- warm dotted streams along arcs ---------- */
  const streamMats = [];
  function makeStream() {
    const a = randDir().multiplyScalar(R * 0.82);
    const b = randDir().multiplyScalar(R * 0.82);
    const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(R * 0.9);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const pos = [], col = [];
    const N = 46;
    for (let i = 0; i < N; i++) {
      const p = curve.getPoint(i / (N - 1)).add(randDir().multiplyScalar(0.35));
      pos.push(p.x, p.y, p.z);
      const c = new THREE.Color(rand() < 0.7 ? 0xffb454 : 0xffd166);
      col.push(c.r, c.g, c.b);
    }
    const pts = makePoints(pos, col, 0.34, 0.9);
    universe.add(pts);
    streamMats.push(pts.material);
  }
  makeStream();
  makeStream();

  /* ---------- ambient particles + background stars ---------- */
  function scatter(count, rMin, rMax, size, opacity, dim) {
    const pos = [], col = [];
    for (let i = 0; i < count; i++) {
      const p = randDir().multiplyScalar(rMin + rand() * (rMax - rMin));
      pos.push(p.x, p.y, p.z);
      const c = new THREE.Color(paletteHex[Math.floor(rand() * paletteHex.length)]);
      c.multiplyScalar(dim);
      col.push(c.r, c.g, c.b);
    }
    return makePoints(pos, col, size, opacity);
  }
  const ambientParticles = scatter(420, 3, R * 0.98, 0.16, 0.75, 0.8);
  universe.add(ambientParticles);
  const bgStars = scatter(260, R * 1.3, R * 3.2, 0.2, 0.5, 0.55);
  scene.add(bgStars);

  /* ---------- floating year label ---------- */
  function textSprite(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.font = '600 58px "Segoe UI", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(232,236,255,0.92)';
    x.fillText(text.split('').join('  '), 256, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
    }));
    s.scale.set(5.2, 1.3, 1);
    return s;
  }
  const yearLabel = textSprite('2026');
  yearLabel.position.set(0, R + 1.7, 0);
  universe.add(yearLabel);

  /* ---------- intro reveal (staggered load-in) ----------
     Groups appear one at a time: squares -> globe (+rings) -> nodes (clusters
     pop in one by one) -> ambiance (streams, dust, stars, label). Static
     materials fade via a per-group factor; clusters/tethers fade + pop via a
     per-cluster reveal factor read in the animation loop. */
  const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const revealStatics = [];
  const reg = (mat, group) => revealStatics.push({ mat, target: mat.opacity, group });
  reg(thinLine, 'globe');
  reg(equatorMat, 'globe');
  reg(fanMat, 'globe');
  ringGroup.traverse((o) => { if (o.material) reg(o.material, 'globe'); });
  streamMats.forEach((m) => reg(m, 'ambiance'));
  reg(ambientParticles.material, 'ambiance');
  reg(bgStars.material, 'ambiance');
  reg(yearLabel.material, 'ambiance');

  // The squares (tesseract cubes) appear one by one, inside-out.
  const SQUARES_START = 0.3, SQUARES_STAGGER = 0.26, SQUARES_PART_DUR = 0.55;
  const cubeParts = tesseract.parts.map((obj, i) => ({
    obj, mat: obj.material, target: obj.material.opacity,
    start: SQUARES_START + i * SQUARES_STAGGER,
  }));
  const SQUARES_END = SQUARES_START + (tesseract.parts.length - 1) * SQUARES_STAGGER + SQUARES_PART_DUR;

  const BEATS = {
    globe: { start: SQUARES_END - 0.1, dur: 1.9 },
    ambiance: { start: 4.9, dur: 2.2 },
  };
  const NODE_START = 4.0, NODE_STAGGER = 0.16, NODE_DUR = 1.0;
  const INTRO_END = 7.3;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeOutBack = (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  let introElapsed = 0;
  let introDone = prefersReduced;

  // Build the initial graph from the store (after introDone exists — cluster
  // reveal state depends on it).
  for (const spec of buildGraphFromPages(getPages()).hubs) makeCluster(spec);

  if (!introDone) {
    revealStatics.forEach((s) => { s.mat.opacity = 0; });
    cubeParts.forEach((p) => { p.mat.opacity = 0; p.obj.scale.setScalar(0.0001); });
    clusters.forEach((c) => { c.revealFactor = 0; c.hub.scale.set(0.0001, 0.0001, 1); });
    threads.forEach((th) => { th.mat.opacity = 0; th.pulseMat.opacity = 0; });
  }

  function applyReveal(tt) {
    const gf = {
      globe: easeOutCubic(clamp01((tt - BEATS.globe.start) / BEATS.globe.dur)),
      ambiance: easeOutCubic(clamp01((tt - BEATS.ambiance.start) / BEATS.ambiance.dur)),
    };
    revealStatics.forEach((s) => { s.mat.opacity = s.target * gf[s.group]; });
    // Squares: each cube fades + pops in on its own stagger, one by one.
    cubeParts.forEach((p) => {
      const raw = clamp01((tt - p.start) / SQUARES_PART_DUR);
      p.mat.opacity = p.target * easeOutCubic(raw);
      p.obj.scale.setScalar(easeOutBack(raw));
    });
    clusters.forEach((c, i) => {
      c.revealFactor = easeOutCubic(clamp01((tt - (NODE_START + i * NODE_STAGGER)) / NODE_DUR));
    });
  }

  function updateReveal(dt) {
    if (introDone) return;
    introElapsed += dt;
    applyReveal(introElapsed);
    if (introElapsed >= INTRO_END) {
      introDone = true;
      revealStatics.forEach((s) => { s.mat.opacity = s.target; });
      cubeParts.forEach((p) => { p.mat.opacity = p.target; p.obj.scale.setScalar(1); });
      clusters.forEach((c) => { c.revealFactor = 1; });
    }
  }

  /* ---------- interaction: drag, zoom, hover, click-to-focus ---------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.3 };
  const mouse = new THREE.Vector2(-2, -2);

  let dragging = false, lastX = 0, lastY = 0, velX = 0, velY = 0, moved = 0;
  let tooltipXY = [0, 0], hoverCluster = null, hoverNode = null, selected = null;
  let pinchStart = 0, pinchBaseDist = 0;

  // Camera focus: clicking a hub flies the look-at + distance to it.
  const FOCUS_DIST = 13;
  const lookTarget = new THREE.Vector3(0, 0, 0);
  const lookGoal = new THREE.Vector3(0, 0, 0);
  let preFocusDist = camDist;

  // Hub dragging: grab a glowing hub and slide its whole cluster around inside
  // the globe. The hub can't cross into the central cubes or leave the shell.
  let draggedHub = null;
  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  const dragNormal = new THREE.Vector3();
  const CUBE_RADIUS = 3.6; // hub can't get closer than this (blocked by the cubes)
  const GLOBE_INNER = R * 0.97; // the cluster's farthest node stays inside the shell

  function updateMouse(cx, cy) {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((cx - r.left) / (r.width || 1)) * 2 - 1;
    mouse.y = -((cy - r.top) / (r.height || 1)) * 2 + 1;
    tooltipXY = [cx - r.left, cy - r.top];
  }
  function maybeGrabHub() {
    if (selected) return; // no dragging while focused
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(hubSprites)[0];
    if (!hit) return;
    draggedHub = hit.object.userData.cluster;
    camera.getWorldDirection(dragNormal);
    dragPlane.setFromNormalAndCoplanarPoint(dragNormal, draggedHub.hub.getWorldPosition(new THREE.Vector3()));
    canvas.style.cursor = 'grabbing';
  }
  function moveHub() {
    raycaster.setFromCamera(mouse, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragHit)) return;
    universe.worldToLocal(dragHit);
    if (dragHit.lengthSq() < 1e-6) return;
    // Keep the hub between the cubes and the shell so its leaves stay inside.
    const rMax = Math.max(CUBE_RADIUS, GLOBE_INNER - draggedHub.maxOffset);
    dragHit.setLength(THREE.MathUtils.clamp(dragHit.length(), CUBE_RADIUS, rMax));
    draggedHub.group.position.copy(dragHit);
    retetherThread(draggedHub.thread);
  }

  function onDown(x, y) { dragging = true; lastX = x; lastY = y; moved = 0; canvas.style.cursor = 'grabbing'; }
  function onMove(x, y) {
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = x; lastY = y;
    if (draggedHub) { moveHub(); return; } // sliding a hub around
    if (selected) return; // view is locked on the focused hub; release to rotate
    velY = dx * 0.0035; velX = dy * 0.0035;
    universe.rotation.y += velY;
    universe.rotation.x = THREE.MathUtils.clamp(universe.rotation.x + velX, -0.85, 0.85);
  }
  function onUp() { dragging = false; draggedHub = null; canvas.style.cursor = 'grab'; }

  const onCanvasDown = (e) => { updateMouse(e.clientX, e.clientY); maybeGrabHub(); onDown(e.clientX, e.clientY); };
  const onWinMove = (e) => { updateMouse(e.clientX, e.clientY); onMove(e.clientX, e.clientY); };
  const onWheel = (e) => {
    e.preventDefault();
    camDist = THREE.MathUtils.clamp(camDist * (1 + e.deltaY * 0.0012), 10, 55);
  };
  canvas.addEventListener('mousedown', onCanvasDown);
  window.addEventListener('mousemove', onWinMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function touchDist(e) {
    const a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      updateMouse(e.touches[0].clientX, e.touches[0].clientY);
      maybeGrabHub();
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      pinchStart = touchDist(e); pinchBaseDist = camDist; dragging = false; draggedHub = null;
    }
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      updateMouse(e.touches[0].clientX, e.touches[0].clientY);
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && pinchStart > 0) {
      camDist = THREE.MathUtils.clamp((pinchBaseDist * pinchStart) / touchDist(e), 10, 55);
    }
  };
  const onTouchEnd = () => { onUp(); pinchStart = 0; };
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  // Toggle-select a hub cluster (null clears). Fires onHubFocus only when the
  // focus actually changes and only for user-driven calls.
  function select(c, fire = true) {
    const prev = selected;
    const wasFocused = !!selected;
    selected = selected === c ? null : c;
    if (selected) {
      if (!wasFocused) preFocusDist = camDist; // remember the free-look zoom
      camDist = FOCUS_DIST; // fly the camera in to the hub
    } else if (wasFocused) {
      camDist = preFocusDist; // restore the previous zoom
    }
    if (fire && selected !== prev) onHubFocus(selected ? selected.page.id : null);
  }

  // Raycast helpers: hubs win over dots.
  function pickHub() {
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(hubSprites)[0];
    return hit ? hit.object.userData.cluster : null;
  }
  function pickDot() {
    raycaster.setFromCamera(mouse, camera);
    const targets = [];
    for (const c of clusters) { targets.push(c.major, c.minor); }
    const hit = raycaster.intersectObjects(targets)[0];
    if (!hit) return null;
    const { cluster, kind } = hit.object.userData;
    const idxs = kind === 'maj' ? cluster.majIdx : cluster.minIdx;
    const node = cluster.pnodes[idxs[hit.index]];
    return node ? { cluster, node } : null;
  }

  const onClick = () => {
    if (moved > 6) return;
    const hub = pickHub();
    if (hub) { select(hub); return; }
    const dot = pickDot();
    if (dot) { onOpenPage(dot.node.page.id); return; }
    select(null); // empty space clears focus
  };
  canvas.addEventListener('click', onClick);

  const onKey = (e) => {
    if (e.key !== 'Escape' || disposed || !visible) return;
    if (selected) select(selected); // toggle off -> fires onHubFocus(null)
  };
  window.addEventListener('keydown', onKey);

  function updateHover() {
    if (dragging) { hoverCluster = null; hoverNode = null; tooltip.style.display = 'none'; return; }
    const hub = pickHub();
    const dot = hub ? null : pickDot();
    hoverCluster = hub;
    hoverNode = dot ? dot.node : null;
    if (hub || dot) {
      tooltip.textContent = title(hub ? hub.page : dot.node.page);
      tooltip.style.display = 'block';
      tooltip.style.left = tooltipXY[0] + 'px';
      tooltip.style.top = tooltipXY[1] + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'grab';
    }
  }

  /* ---------- animation loop ---------- */
  // Leaf/branch spring physics.
  const SPRING_K = 42;      // stiffness (how hard nodes are pulled to their anchor)
  const SPRING_DAMP = 7.5;  // velocity damping (higher = less bounce)
  const NODE_BOUND = R * 0.985;
  const NODE_BOUND_SQ = NODE_BOUND * NODE_BOUND;
  const _anchor = new THREE.Vector3();
  const _force = new THREE.Vector3();

  // Integrate one physics step for every cluster and push the results into the
  // point/line geometry buffers. Called each frame; also used to step + verify.
  function simulateClusters(dt) {
    clusters.forEach((c) => {
      const hubPos = c.group.position;
      for (const n of c.pnodes) {
        const base = n.parent < 0 ? hubPos : c.pnodes[n.parent].pos;
        _anchor.copy(base).add(n.rest);
        _force.copy(_anchor).sub(n.pos).multiplyScalar(SPRING_K * dt);
        n.vel.add(_force).multiplyScalar(Math.max(0, 1 - SPRING_DAMP * dt));
        n.pos.addScaledVector(n.vel, dt);
        const r2 = n.pos.lengthSq(); // never let a node leave the globe
        if (r2 > NODE_BOUND_SQ) { n.pos.multiplyScalar(NODE_BOUND / Math.sqrt(r2)); n.vel.multiplyScalar(0.4); }
      }
      const ma = c.major.geometry.attributes.position.array;
      for (let j = 0; j < c.majIdx.length; j++) { const p = c.pnodes[c.majIdx[j]].pos; ma[j * 3] = p.x; ma[j * 3 + 1] = p.y; ma[j * 3 + 2] = p.z; }
      c.major.geometry.attributes.position.needsUpdate = true;
      const mi = c.minor.geometry.attributes.position.array;
      for (let j = 0; j < c.minIdx.length; j++) { const p = c.pnodes[c.minIdx[j]].pos; mi[j * 3] = p.x; mi[j * 3 + 1] = p.y; mi[j * 3 + 2] = p.z; }
      c.minor.geometry.attributes.position.needsUpdate = true;
      const la = c.lineSeg.geometry.attributes.position.array;
      for (let k = 0; k < c.pnodes.length; k++) {
        const n = c.pnodes[k];
        const from = n.parent < 0 ? hubPos : c.pnodes[n.parent].pos;
        la[k * 6] = from.x; la[k * 6 + 1] = from.y; la[k * 6 + 2] = from.z;
        la[k * 6 + 3] = n.pos.x; la[k * 6 + 4] = n.pos.y; la[k * 6 + 5] = n.pos.z;
      }
      c.lineSeg.geometry.attributes.position.needsUpdate = true;
    });
  }

  const clock = new THREE.Clock();
  let t = 0;
  let rafId = 0;
  let visible = true;
  let disposed = false;

  function animate() {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;

    updateReveal(dt);

    if (!dragging) {
      // Auto-rotate only when nothing is focused, so the hub stays put in view.
      if (!selected) {
        universe.rotation.y += velY + 0.0009;
        universe.rotation.x = THREE.MathUtils.clamp(universe.rotation.x + velX, -0.85, 0.85);
      }
      velY *= 0.94; velX *= 0.94;
    }

    // Focus: ease the look-at toward the selected hub's world position, or
    // back to the globe center when released.
    if (selected) selected.hub.getWorldPosition(lookGoal);
    else lookGoal.set(0, 0, 0);
    lookTarget.lerp(lookGoal, 0.08);

    curDist += (camDist - curDist) * 0.07;
    camera.position.copy(camDir).multiplyScalar(curDist).add(lookTarget);
    camera.lookAt(lookTarget);

    tesseract.tick(dt);
    ringGroup.rotation.y += 0.06 * dt;

    simulateClusters(dt);

    clusters.forEach((c) => {
      // --- opacity / reveal / hub scale ---
      const f = selected ? (c === selected ? 1 : 0.1) : 1;
      const rv = c.revealFactor;
      c._lineOp += (c.baseLineOp * f - c._lineOp) * 0.08;
      c._majOp += (c.baseMajOp * f - c._majOp) * 0.08;
      c._minOp += (c.baseMinOp * f - c._minOp) * 0.08;
      c._hubOp += (c.hubBaseOp * Math.min(f * 1.1, 1) - c._hubOp) * 0.08;
      c.lineMat.opacity = c._lineOp * rv;
      c.majorMat.opacity = c._majOp * rv;
      c.minorMat.opacity = c._minOp * rv;
      c.hubMat.opacity = c._hubOp * rv;
      const active = c === hoverCluster || c === selected;
      const target = c.hubBase * (1 + 0.09 * Math.sin(t * 2 + c.phase)) * (active ? 1.5 : 1) * rv;
      c.hub.scale.x += (target - c.hub.scale.x) * 0.15;
      c.hub.scale.y = c.hub.scale.x;
    });

    threads.forEach((th) => {
      const f = selected ? (th.cluster === selected ? 2.6 : 0.25) : 1;
      const rv = th.cluster.revealFactor;
      th._op += (Math.min(th.baseOp * f, 0.85) - th._op) * 0.08;
      th.mat.opacity = th._op * rv;
      th.t = (th.t + th.speed * dt * (th.cluster === selected ? 2.2 : 1)) % 1;
      th.pulse.position.copy(th.curve.getPoint(th.t));
      const pulseOp = selected && th.cluster !== selected ? 0.1 : 0.55 + 0.45 * Math.sin(th.t * Math.PI);
      th.pulseMat.opacity = pulseOp * rv;
    });

    updateHover();
    renderer.render(scene, camera);
  }
  animate();

  /* ---------- sizing ---------- */
  function resize() {
    const w = width(), h = height();
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  }
  window.addEventListener('resize', resize);

  /* ---------- public handle ---------- */
  function focusPage(id) {
    const c = findClusterForPage(id);
    if (c && c !== selected) select(c, false);
  }
  function clearFocus() {
    if (selected) select(selected, false);
  }
  function setVisible(v) {
    v = !!v;
    if (v === visible) return;
    visible = v;
    if (v) {
      clock.getDelta(); // swallow the paused time so physics doesn't jump
      if (!rafId) animate();
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    offStore('pages', onPagesEvent);
    if (ro) ro.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onWinMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    renderer.dispose();
    canvas.remove(); vignette.remove(); tooltip.remove(); hint.remove();
    container.classList.remove('gl-stage');
    if (window.__SBG__ === devHandle) delete window.__SBG__;
  }

  // Dev handle for inspecting the scene from the console.
  const devHandle = {
    scene, camera, renderer, universe, clusters, hubs: hubSprites, yearLabel, raycaster, mouse,
    grabbed: () => draggedHub && title(draggedHub.page),
    select: (name) => select(clusters.find((c) => c.page.id === name || title(c.page) === name)),
    rebuild: rebuildAll,
    // Scrub the intro reveal to an absolute time (seconds), freeze it there,
    // and render one frame (so the running loop won't advance past it).
    scrub: (tt) => { introElapsed = tt; applyReveal(tt); introDone = true; renderer.render(scene, camera); },
    // Dev: step the leaf physics n times at a fixed dt and render (for testing).
    stepPhysics: (n = 1, dt = 0.016) => { for (let s = 0; s < n; s++) simulateClusters(dt); renderer.render(scene, camera); },
    // Snap the focus camera to its converged position and render (skips the ease).
    snapFocus: () => {
      if (selected) selected.hub.getWorldPosition(lookGoal); else lookGoal.set(0, 0, 0);
      lookTarget.copy(lookGoal); curDist = camDist;
      camera.position.copy(camDir).multiplyScalar(curDist).add(lookTarget);
      camera.lookAt(lookTarget); renderer.render(scene, camera);
    },
    // Dev: drive the real drag clamp toward a requested radius; returns the result.
    dragTest: (name, reqRadius) => {
      const c = clusters.find((x) => x.page.id === name || title(x.page) === name);
      if (!c) return null;
      draggedHub = c;
      const target = c.group.position.clone().setLength(Math.max(0.01, reqRadius));
      const rMax = Math.max(CUBE_RADIUS, GLOBE_INNER - c.maxOffset);
      target.setLength(THREE.MathUtils.clamp(target.length(), CUBE_RADIUS, rMax));
      c.group.position.copy(target);
      retetherThread(c.thread);
      draggedHub = null;
      // farthest node from center after the move (must stay < R)
      const worst = c.group.position.length() + c.maxOffset;
      return { reqRadius, hubRadius: +c.group.position.length().toFixed(2), rMax: +rMax.toFixed(2),
        cubeRadius: CUBE_RADIUS, farthestNode: +worst.toFixed(2), globeR: R };
    },
  };
  window.__SBG__ = devHandle;

  return { focusPage, clearFocus, setVisible, dispose };
}
