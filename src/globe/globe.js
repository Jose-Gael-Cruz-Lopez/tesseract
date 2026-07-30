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
    const lineSeg = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: palette().clusterLine, transparent: true, opacity: c.baseLineOp }));
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
      map: dotTex, color: palette().hub, transparent: true, opacity: 0.95,
      depthWrite: false, blending: palette().blending,
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
      depthWrite: false, blending: palette().blending,
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

  // Where the graph comes from. Default (knowledge globe) is the page store —
  // synchronous, so timing is identical to before. A developer provider returns
  // a Promise (a canopy fetch); `withGraph` handles both without making the
  // knowledge path async.
  const getGraph = provider && provider.getGraph
    ? () => provider.getGraph()
    : () => buildGraphFromPages(getPages());

  function withGraph(fn) {
    const g = getGraph();
    if (g && typeof g.then === 'function') g.then((graph) => { if (!disposed) fn(graph); });
    else fn(g);
  }

  // Tear down every cluster and rebuild the whole graph from the provider.
  function rebuildAll() {
    const focusedId = selected ? selected.page.id : null;
    for (const c of clusters) { cacheCluster(c); disposeCluster(c); }
    clusters.length = 0;
    hubSprites.length = 0;
    withGraph((graph) => {
      for (const spec of graph.hubs) makeCluster(spec);
      if (focusedId) {
        const again = clusters.find((c) => c.page.id === focusedId);
        if (again) selected = again;
        else { selected = null; camDist = preFocusDist; onHubFocus(null); }
      }
      hoverNode = null; hoverCluster = null;
    });
  }

  // Rebuild just one hub's nodes (children/grandchildren changed). Store-only
  // (the developer provider never calls this — it has no per-hub events).
  function rebuildHub(cluster) {
    withGraph((graph) => {
      const spec = graph.hubs.find((h) => h.page.id === cluster.page.id);
      if (!spec) { rebuildAll(); return; }
      cacheCluster(cluster);
      const { pnodes, maxOff } = buildNodes(spec, cluster.group.position);
      cluster.pnodes = pnodes;
      cluster.maxOffset = maxOff;
      rebuildClusterGeometry(cluster);
      if (hoverNode && hoverNode.cluster === cluster) hoverNode = null;
    });
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
  // Only the store-backed (knowledge) globe subscribes to page events; the
  // developer globe refreshes on demand via the returned handle's refresh().
  let unsubscribeStore = null;
  if (!provider) {
    onStore('pages', onPagesEvent);
    unsubscribeStore = () => offStore('pages', onPagesEvent);
  }

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
