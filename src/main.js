import './styles.css';

import * as THREE from 'three';
import { makeDotTexture, buildTesseract } from './nodes.js';

// Match the reference's r128 color look: no sRGB<->linear conversion, raw
// output. (three r152+ enables color management by default.)
THREE.ColorManagement.enabled = false;

// Seeded RNG so the layout is reproducible (the reference used Math.random).
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const titleRand = mulberry32(1234); // separate stream so titles don't shift the layout

/* ---------- renderer / scene ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
const camDir = new THREE.Vector3(0, 0.18, 1).normalize();
let camDist = 30, curDist = 30;
camera.position.copy(camDir).multiplyScalar(curDist);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // raw output, like r128
renderer.setClearColor(0x060310, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const el = renderer.domElement;
el.style.touchAction = 'none';
el.style.cursor = 'grab';

const universe = new THREE.Group();
scene.add(universe);
const R = 11; /* globe radius */

// Lights for our lit tesseract cube (everything else is MeshBasic / points /
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
    size: size, map: dotTex, vertexColors: true, transparent: true, opacity: opacity,
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

/* ---------- tesseract core (kept from our build) ---------- */
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
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: op })
  );
  m.rotation.set(Math.PI / 2 + tiltX, tiltY, 0);
  return m;
}
ringGroup.add(makeRing(4.3, 0xe0356b, 0.75, 0.16, 0.4, 0.028));
ringGroup.add(makeRing(5.6, 0xc22f5f, 0.5, -0.1, -0.7, 0.022));
ringGroup.add(makeRing(7.6, 0x93264a, 0.4, 0.24, 1.4, 0.02));
ringGroup.add(makeRing(9.4, 0x6e1f3d, 0.3, -0.3, 2.3, 0.018));

/* ---------- node clusters (dandelion webs) + tethers to core ---------- */
const paletteHex = [0xffd166, 0xffb454, 0xff5d8f, 0xff2d55, 0xc8b6ff, 0xe8ecff, 0x86d1ff];
const clusterNames = ['Projects', 'People', 'Ideas', 'Research', 'Content', 'Code', 'Reading', 'Health', 'Finance', 'Travel', 'Journal', 'Learning'];
// Placeholder page titles for the nodes (swap in real notes/pages later).
const PAGE_TITLES = [
  'Morning pages', 'Reading list', 'Idea backlog', 'Weekly review', 'Book notes',
  'Project brief', 'Meeting notes', 'Trip itinerary', 'Budget tracker', 'Habit log',
  'Recipe box', 'Workout plan', 'Gift ideas', 'Bucket list', 'Learning log',
  'Favorite quotes', 'Dream journal', 'Goals 2026', 'Reflections', 'Research dump',
  'Draft outline', 'Interview prep', 'Highlights', 'Side project', 'Newsletter drafts',
  'Wishlist', 'People to meet', 'Health metrics', 'Investment notes', 'Travel hacks',
  'Language study', 'Podcast queue', 'Movie watchlist', 'Design inspiration', 'Code snippets',
  'Career map', 'Networking', 'Daily journal', 'Mind map', 'Sketchbook',
  'Voice memos', 'Someday maybe', 'Inbox', 'Field notes', 'Scratchpad',
  'Cheat sheet', 'Manifesto', 'Playbook', 'Rabbit holes', 'Open questions',
];
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clusters = [];
const hubs = [];
const threads = [];
const golden = Math.PI * (3 - Math.sqrt(5));

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

for (let i = 0; i < clusterNames.length; i++) {
  const n = clusterNames.length;
  const yy = 1 - ((i + 0.5) * 2) / n;
  const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
  const th = golden * i;
  const dir = new THREE.Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr);
  dir.add(randDir().multiplyScalar(0.22)).normalize();

  // Hubs sit inward enough that every leaf fits between the hub and the shell.
  const dist = R * (0.4 + rand() * 0.3);
  const scale = 0.8 + rand() * 0.9;
  // Radial room from this hub out to (just inside) the globe surface. Every
  // leaf/branch offset is capped to this, so no node can leave the globe --
  // even as the cluster slowly spins (rotation preserves offset length, and
  // |hubPos + offset| <= dist + |offset| <= dist + budget = 0.94 R < R).
  const budget = R * 0.94 - dist;

  const g = new THREE.Group();
  g.position.copy(dir).multiplyScalar(dist);

  const hubMat = new THREE.SpriteMaterial({
    map: dotTex, color: 0xfff3dd, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const hub = new THREE.Sprite(hubMat);
  const hubBase = 0.85 * scale;
  hub.scale.set(hubBase, hubBase, 1);
  g.add(hub);

  // Leaves + branches are spring particles in universe space, so dragging the
  // hub pulls them with real physics instead of moving the cluster rigidly.
  // Each particle springs toward an anchor: leaves -> hub, branches -> parent
  // leaf. pos/vel are integrated each frame; rest is the offset from the anchor.
  const hubPos = g.position; // universe-local hub position (updated by drag)
  const pnodes = [];
  const majIdx = [], minIdx = [], majCol = [], minCol = [];
  const count = 16 + Math.floor(rand() * 14);
  let maxOff = 0; // farthest node offset from the hub (for drag bounds)
  for (let k = 0; k < count; k++) {
    const p = randDir().multiplyScalar((0.7 + rand() * 1.8) * scale);
    if (p.length() > budget) p.setLength(budget); // keep the leaf inside the shell
    maxOff = Math.max(maxOff, p.length());
    const col = new THREE.Color(paletteHex[Math.floor(rand() * paletteHex.length)]);
    const leafIdx = pnodes.length;
    // col/major are stamped on the node too, so a cluster's geometry can be
    // rebuilt from pnodes alone after a node is added or removed.
    const isMaj = rand() < 0.3;
    pnodes.push({ pos: hubPos.clone().add(p), vel: new THREE.Vector3(), rest: p.clone(), parent: -1, col: [col.r, col.g, col.b], major: isMaj });
    if (isMaj) { majIdx.push(leafIdx); majCol.push(col.r, col.g, col.b); }
    else { minIdx.push(leafIdx); minCol.push(col.r, col.g, col.b); }
    /* occasional two-hop branch, like the reference */
    if (rand() < 0.28) {
      const bAbs = p.clone().add(randDir().multiplyScalar(0.55 * scale));
      if (bAbs.length() > budget) bAbs.setLength(budget); // keep the branch inside too
      maxOff = Math.max(maxOff, bAbs.length());
      const col2 = new THREE.Color(paletteHex[Math.floor(rand() * paletteHex.length)]);
      pnodes.push({ pos: hubPos.clone().add(bAbs), vel: new THREE.Vector3(), rest: bAbs.clone().sub(p), parent: leafIdx, col: [col2.r, col2.g, col2.b], major: false });
      minIdx.push(pnodes.length - 1); minCol.push(col2.r, col2.g, col2.b);
    }
  }
  // Give every node a page title (unique within the cluster) and a URL.
  const titlePool = PAGE_TITLES.slice();
  for (let a = titlePool.length - 1; a > 0; a--) { const b = Math.floor(titleRand() * (a + 1)); const tmp = titlePool[a]; titlePool[a] = titlePool[b]; titlePool[b] = tmp; }
  const clusterSlug = slugify(clusterNames[i]);
  pnodes.forEach((n, k) => {
    n.title = titlePool[k % titlePool.length];
    n.url = '#/' + clusterSlug + '/' + slugify(n.title); // swap for a real page URL
  });

  const flat = (idxs) => { const a = []; idxs.forEach((ix) => { const q = pnodes[ix].pos; a.push(q.x, q.y, q.z); }); return a; };
  const major = makePoints(flat(majIdx), majCol, 0.5, 0.95);
  const minor = makePoints(flat(minIdx), minCol, 0.26, 0.9);
  universe.add(major, minor);

  const linePts = new Float32Array(pnodes.length * 6);
  pnodes.forEach((n, k) => {
    const from = n.parent < 0 ? hubPos : pnodes[n.parent].pos;
    linePts.set([from.x, from.y, from.z, n.pos.x, n.pos.y, n.pos.z], k * 6);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePts, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xd6dbf5, transparent: true, opacity: 0.34 });
  const lineSeg = new THREE.LineSegments(lineGeo, lineMat);
  universe.add(lineSeg);
  universe.add(g);

  const cluster = {
    name: clusterNames[i], group: g, hub, hubMat, hubBase,
    lineMat, majorMat: major.material, minorMat: minor.material,
    major, minor, lineSeg, pnodes, majIdx, minIdx, majCol, minCol,
    baseLineOp: 0.34, baseMajOp: 0.95, baseMinOp: 0.9, hubBaseOp: 0.95,
    nodeCount: count,
    maxOffset: maxOff,
    scale, dist, budget,
    accentIdx: i % paletteHex.length,
    accent: '#' + paletteHex[i % paletteHex.length].toString(16).padStart(6, '0'),
    phase: rand() * Math.PI * 2,
  };
  hub.userData.cluster = cluster;
  pnodes.forEach((n) => { n.cluster = cluster; }); // each page maps to its central topic
  clusters.push(cluster);
  hubs.push(hub);

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
  cluster.thread = thread;
  threads.push(thread);
  retetherThread(thread); // build the curve from the hub's current position
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
  x.fillText(text.split('').join('  '), 256, 64);
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

// Base (un-revealed) opacities the loop lerps; the reveal factor multiplies them.
clusters.forEach((c) => {
  c._lineOp = c.baseLineOp; c._majOp = c.baseMajOp; c._minOp = c.baseMinOp; c._hubOp = c.hubBaseOp;
  c.revealFactor = 1;
});
threads.forEach((th) => { th._op = th.baseOp; });

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
const mouse = new THREE.Vector2(-2, -2);
const tooltip = document.getElementById('tooltip');
const sidebarEl = document.getElementById('sidebar');

/* ---------- Notion-style page view (opens when a node's page is clicked) ---------- */
const pageEl = document.getElementById('page');
const pgCover = document.getElementById('pg-cover');
const pgCluster = document.getElementById('pg-cluster');
const pgPtitle = document.getElementById('pg-ptitle');
const pgTitle = document.getElementById('pg-title');
const pgContent = document.getElementById('pg-content');
const pgConnected = document.getElementById('pg-connected');
const pgEdited = document.getElementById('pg-edited');
const pgDoc = document.getElementById('pg-doc');
const pgMenu = document.getElementById('pg-menu');
let currentNode = null;
let activeSub = null;

const pageKey = (node) => 'mnemo:page:' + node.url;
const loadPage = (node) => { try { return JSON.parse(localStorage.getItem(pageKey(node))) || {}; } catch (e) { return {}; } };
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
function relTime(ts) {
  if (!ts) return 'just now';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

let saveTimer = 0;
function persistPage() {
  if (!currentNode) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const title = pgTitle.textContent.trim() || currentNode.title;
    const data = { title, body: pgContent.innerHTML, edited: Date.now() };
    localStorage.setItem(pageKey(currentNode), JSON.stringify(data));
    pgEdited.textContent = 'Edited ' + relTime(data.edited);
    pgPtitle.textContent = title;
    if (currentNode.subEl) currentNode.subEl.querySelector('.sb-label').textContent = title;
  }, 350);
}

// Every page IS one of the globe's nodes; opening it shows a Notion-style doc.
function openNode(node) {
  currentNode = node;
  const c = node.cluster;
  const saved = loadPage(node);
  const title = saved.title || node.title;
  pgCluster.textContent = c.name;
  pgPtitle.textContent = title;
  pgTitle.textContent = title;
  pgContent.innerHTML = saved.body || '';
  pgEdited.textContent = 'Edited ' + relTime(saved.edited);
  pgCover.style.background = `linear-gradient(115deg, ${hexA(c.accent, 0.5)}, ${hexA(c.accent, 0.12)})`;
  pgConnected.innerHTML = `<span class="dot" style="background:${c.accent}"></span>Part of&nbsp;<strong style="color:#e8e8ea;font-weight:600">${c.name}</strong>&nbsp;· a node on the globe`;
  setExpanded(c, true);
  if (activeSub) activeSub.classList.remove('active');
  activeSub = node.subEl || null;
  if (activeSub) { activeSub.classList.add('active'); activeSub.scrollIntoView({ block: 'nearest' }); }
  pageEl.querySelector('.pg-scroll').scrollTop = 0;
  pgMenu.classList.remove('show');
  pageEl.classList.add('show');
  pageEl.setAttribute('aria-hidden', 'false');
  window.location.hash = node.url;
}

function closePage() {
  if (!pageEl.classList.contains('show')) return;
  pageEl.classList.remove('show');
  pageEl.setAttribute('aria-hidden', 'true');
  pgMenu.classList.remove('show');
  if (activeSub) { activeSub.classList.remove('active'); activeSub = null; }
  currentNode = null;
  history.replaceState(null, '', location.pathname + location.search);
}

// Breadcrumb / "Part of" -> back to the globe, focused on this cluster.
function gotoCluster() {
  const cl = currentNode && currentNode.cluster;
  closePage();
  if (cl && selected !== cl) select(cl);
}

function buildPageChrome() {
  ['Ask AI', 'AI Meeting Notes', 'Database', 'Form', 'Templates'].forEach((t) =>
    document.getElementById('pg-gs').appendChild(elh('button', null, t))
  );

  const fonts = elh('div', 'pg-fonts');
  const fontBtns = [];
  [['Default', 'default'], ['Serif', 'serif'], ['Mono', 'mono']].forEach(([lbl, cls]) => {
    const b = elh('button', 'pg-font' + (cls === 'default' ? ' active' : ''), `<span class="big">Ag</span><span class="lbl">${lbl}</span>`);
    b.addEventListener('click', () => {
      pgDoc.classList.remove('serif', 'mono');
      if (cls !== 'default') pgDoc.classList.add(cls);
      fontBtns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    fontBtns.push(b); fonts.appendChild(b);
  });
  pgMenu.appendChild(fonts);
  pgMenu.appendChild(elh('div', 'pg-msep'));
  const row = (label, opts = {}) => {
    const r = elh('div', 'pg-mrow', `<span>${label}</span>` + (opts.key ? `<span class="mkey">${opts.key}</span>` : '') + (opts.toggle ? '<span class="pg-switch"></span>' : ''));
    if (opts.toggle) r.addEventListener('click', () => { r.classList.toggle('on'); opts.toggle(r.classList.contains('on')); });
    else if (opts.onClick) r.addEventListener('click', opts.onClick);
    pgMenu.appendChild(r);
  };
  row('Copy link', { key: '⌘L', onClick: () => { if (navigator.clipboard) navigator.clipboard.writeText(location.href); pgMenu.classList.remove('show'); } });
  row('Duplicate', { key: '⌘D' });
  row('Move to Trash', { onClick: () => { if (currentNode) localStorage.removeItem(pageKey(currentNode)); closePage(); } });
  pgMenu.appendChild(elh('div', 'pg-msep'));
  row('Small text', { toggle: (on) => pgDoc.classList.toggle('small', on) });
  row('Full width', { toggle: (on) => pgDoc.classList.toggle('wide', on) });
  pgMenu.appendChild(elh('div', 'pg-msep'));
  row('Export');
  row('Version history');

  pgTitle.addEventListener('input', persistPage);
  pgContent.addEventListener('input', persistPage);
  pgCluster.addEventListener('click', gotoCluster);
  pgConnected.addEventListener('click', gotoCluster);
  document.getElementById('pg-close').addEventListener('click', closePage);
  document.getElementById('pg-more').addEventListener('click', (e) => { e.stopPropagation(); pgMenu.classList.toggle('show'); });
  document.querySelector('.pg-share').addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(location.href); });
  document.addEventListener('click', (e) => {
    if (pgMenu.classList.contains('show') && !pgMenu.contains(e.target) && e.target.id !== 'pg-more') pgMenu.classList.remove('show');
  });
}

const ICON = {
  chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  page: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg>',
  home: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  pencil: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  collapse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
  expand: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>',
};
const elh = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const labelSpan = (text) => { const s = elh('span', 'sb-label'); s.textContent = text; return s; };

// Expand/collapse a cluster's page list.
function setExpanded(c, open) {
  c.expandedState = open;
  c.childrenEl.style.display = open ? 'block' : 'none';
  c.itemEl.classList.toggle('open', open);
}

// Retract / restore the sidebar and remember the choice across reloads.
const SIDEBAR_KEY = 'mnemo.sidebarCollapsed';
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
}

/* ---------- live-create: new clusters (hubs) + sub-files (nodes) ---------- */
let sbScroll = null; // the scrollable cluster list; set in buildSidebar()

// Build one sidebar row for a page node under its cluster.
function createNodeRow(c, node) {
  const sub = elh('div', 'sb-sub');
  const moreBtn = elh('button', 'sb-more', ICON.more);
  moreBtn.setAttribute('aria-label', 'Page options');
  moreBtn.title = 'Delete this page';
  sub.append(elh('span', 'sb-icon', ICON.page), labelSpan(node.title), moreBtn);
  sub.title = node.title;
  sub.addEventListener('click', (e) => { e.stopPropagation(); openNode(node); });
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openNodeMenu(moreBtn, c, node); });
  c.childrenEl.appendChild(sub);
  c.subEls.push(sub);
  node.subEl = sub;
  return sub;
}

// Build one sidebar row for a cluster (with a hover ＋ to add sub-pages) and
// rows for any pages it already has.
function createClusterRow(c) {
  const item = elh('div', 'sb-item');
  const tw = elh('span', 'sb-twisty', ICON.chevron);
  const addBtn = elh('button', 'sb-add', ICON.plus);
  addBtn.setAttribute('aria-label', 'Add a sub-page');
  addBtn.title = 'Add a sub-page';
  const moreBtn = elh('button', 'sb-more', ICON.more);
  moreBtn.setAttribute('aria-label', 'Cluster options');
  moreBtn.title = 'Delete this cluster';
  item.append(tw, elh('span', 'sb-icon', ICON.page), labelSpan(c.name), addBtn, moreBtn);
  tw.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(c, !c.expandedState); });
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); promptNewSub(c); });
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openClusterMenu(moreBtn, c); });
  item.addEventListener('click', () => select(c));

  const children = elh('div', 'sb-children');
  children.style.display = 'none';

  c.itemEl = item;
  c.childrenEl = children;
  c.subEls = [];
  c.expandedState = false;

  sbScroll.append(item, children);
  c.pnodes.forEach((node) => createNodeRow(c, node));
  return item;
}

// A unique page URL within a cluster (so localStorage page keys don't collide).
function uniqueUrl(cluster, title) {
  const base = '#/' + slugify(cluster.name) + '/' + (slugify(title) || 'untitled');
  const used = new Set(clusters.flatMap((c) => c.pnodes.map((n) => n.url)));
  let url = base, i = 2;
  while (used.has(url)) url = base + '-' + (i++);
  return url;
}

// Rebuild a cluster's point clouds + connector lines from its current pnodes.
// Called after a node is added or removed, since the buffers are fixed-size.
// The major/minor split and colors are derived from the nodes themselves.
function rebuildClusterGeometry(c) {
  const majIdx = [], minIdx = [], majCol = [], minCol = [];
  c.pnodes.forEach((n, k) => {
    const col = n.col || [1, 1, 1];
    if (n.major) { majIdx.push(k); majCol.push(col[0], col[1], col[2]); }
    else { minIdx.push(k); minCol.push(col[0], col[1], col[2]); }
  });
  c.majIdx = majIdx; c.minIdx = minIdx; c.majCol = majCol; c.minCol = minCol;
  const flat = (idxs) => { const a = []; idxs.forEach((ix) => { const q = c.pnodes[ix].pos; a.push(q.x, q.y, q.z); }); return a; };
  universe.remove(c.major, c.minor, c.lineSeg);
  c.major.geometry.dispose(); c.major.material.dispose();
  c.minor.geometry.dispose(); c.minor.material.dispose();
  c.lineSeg.geometry.dispose(); c.lineSeg.material.dispose();

  const major = makePoints(flat(c.majIdx), c.majCol, 0.5, 0.95);
  const minor = makePoints(flat(c.minIdx), c.minCol, 0.26, 0.9);
  const linePts = new Float32Array(c.pnodes.length * 6);
  c.pnodes.forEach((n, k) => {
    const from = n.parent < 0 ? c.group.position : c.pnodes[n.parent].pos;
    linePts.set([from.x, from.y, from.z, n.pos.x, n.pos.y, n.pos.z], k * 6);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePts, 3));
  const lineSeg = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xd6dbf5, transparent: true, opacity: c.baseLineOp }));
  universe.add(major, minor, lineSeg);

  c.major = major; c.minor = minor; c.lineSeg = lineSeg;
  c.majorMat = major.material; c.minorMat = minor.material; c.lineMat = lineSeg.material;
  // Keep the currently-eased opacity so nothing pops when we swap geometry.
  const rv = c.revealFactor ?? 1;
  c.majorMat.opacity = (c._majOp ?? c.baseMajOp) * rv;
  c.minorMat.opacity = (c._minOp ?? c.baseMinOp) * rv;
  c.lineMat.opacity = (c._lineOp ?? c.baseLineOp) * rv;
}

// Spawn a brand-new cluster (a hub tethered to the core), starting empty.
function createCluster(name, opts = {}) {
  const dir = opts.dir ? new THREE.Vector3().fromArray(opts.dir).normalize() : randDir();
  const dist = opts.dist != null ? opts.dist : R * (0.4 + rand() * 0.3);
  const scale = opts.scale != null ? opts.scale : 0.8 + rand() * 0.9;
  const accentIdx = opts.accentIdx != null ? opts.accentIdx : clusters.length % paletteHex.length;

  const g = new THREE.Group();
  g.position.copy(dir).multiplyScalar(dist);
  const hubMat = new THREE.SpriteMaterial({ map: dotTex, color: 0xfff3dd, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const hub = new THREE.Sprite(hubMat);
  const hubBase = 0.85 * scale;
  hub.scale.set(hubBase, hubBase, 1);
  g.add(hub);
  universe.add(g);

  const major = makePoints([], [], 0.5, 0.95);
  const minor = makePoints([], [], 0.26, 0.9);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  const lineSeg = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xd6dbf5, transparent: true, opacity: 0.34 }));
  universe.add(major, minor, lineSeg);

  const cluster = {
    name, group: g, hub, hubMat, hubBase,
    lineMat: lineSeg.material, majorMat: major.material, minorMat: minor.material,
    major, minor, lineSeg, pnodes: [], majIdx: [], minIdx: [], majCol: [], minCol: [],
    baseLineOp: 0.34, baseMajOp: 0.95, baseMinOp: 0.9, hubBaseOp: 0.95,
    nodeCount: 0, maxOffset: 0,
    scale, dist, budget: R * 0.94 - dist,
    accentIdx, accent: '#' + paletteHex[accentIdx].toString(16).padStart(6, '0'),
    phase: rand() * Math.PI * 2,
    userCreated: true,
  };
  hub.userData.cluster = cluster;
  // Reveal/opacity state so the render loop shows it immediately (post-intro).
  cluster._lineOp = cluster.baseLineOp; cluster._majOp = cluster.baseMajOp;
  cluster._minOp = cluster.baseMinOp; cluster._hubOp = cluster.hubBaseOp;
  cluster.revealFactor = 1;
  clusters.push(cluster);
  hubs.push(hub);

  // Tether the hub to the core, matching the procedural clusters.
  const jitterDir = randDir();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const tMat = new THREE.LineBasicMaterial({ color: 0xff6d8a, transparent: true, opacity: 0.26 });
  const tLine = new THREE.Line(new THREE.BufferGeometry(), tMat);
  universe.add(tLine);
  const pulseMat = new THREE.SpriteMaterial({ map: dotTex, color: 0xffc2cf, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const pulse = new THREE.Sprite(pulseMat);
  pulse.scale.set(0.34, 0.34, 1);
  universe.add(pulse);
  const thread = { curve, line: tLine, jitterDir, mat: tMat, baseOp: 0.26, pulse, pulseMat, t: rand(), speed: 0.1 + rand() * 0.16, cluster };
  thread._op = thread.baseOp;
  cluster.thread = thread;
  threads.push(thread);
  retetherThread(thread);

  if (sbScroll) createClusterRow(cluster);
  return cluster;
}

// Notion-style sidebar: workspace header, nav + search, cluster list, footer.
function buildSidebar() {
  const header = elh('div', 'sb-header', '<div class="sb-avatar">M</div><div class="sb-space">Mnemosphere</div>');

  const nav = elh('div', 'sb-nav');
  const home = elh('button', 'sb-home', ICON.home + '<span>Home</span>');
  home.addEventListener('click', () => select(null));
  const searchBtn = elh('button', 'sb-iconbtn', ICON.search);
  nav.append(home, searchBtn);

  const searchWrap = elh('div', 'sb-search');
  const searchInput = elh('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search pages…';
  searchWrap.appendChild(searchInput);
  searchBtn.addEventListener('click', () => searchInput.focus());

  const scroll = elh('div', 'sb-scroll');
  scroll.appendChild(elh('div', 'sb-section', 'Clusters'));
  clusters.forEach((c) => {
    const item = elh('div', 'sb-item');
    const tw = elh('span', 'sb-twisty', ICON.chevron);
    item.append(tw, elh('span', 'sb-icon', ICON.page), labelSpan(c.name));
    tw.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(c, !c.expandedState); });
    item.addEventListener('click', () => select(c));

    const children = elh('div', 'sb-children');
    children.style.display = 'none';
    c.subEls = [];
    c.pnodes.forEach((node) => {
      const sub = elh('div', 'sb-sub');
      sub.append(elh('span', 'sb-icon', ICON.page), labelSpan(node.title));
      sub.title = node.title;
      sub.addEventListener('click', (e) => { e.stopPropagation(); openNode(node); });
      children.appendChild(sub);
      c.subEls.push(sub);
      node.subEl = sub;
    });
    scroll.append(item, children);
    c.itemEl = item;
    c.childrenEl = children;
    c.expandedState = false;
  });

  const footer = elh('div', 'sb-footer');
  footer.appendChild(elh('button', 'sb-new', ICON.pencil + '<span>New</span>'));

  sidebarEl.append(header, nav, searchWrap, scroll, footer);

  // Live filter as you type (Notion-style search).
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    clusters.forEach((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      let anyPage = false;
      c.subEls.forEach((sub, k) => {
        const m = !q || nameMatch || c.pnodes[k].title.toLowerCase().includes(q);
        sub.style.display = m ? '' : 'none';
        if (q && m) anyPage = true;
      });
      const show = !q || nameMatch || anyPage;
      c.itemEl.style.display = show ? '' : 'none';
      const open = q ? show && (anyPage || nameMatch) : c.expandedState;
      c.childrenEl.style.display = open ? 'block' : 'none';
      c.itemEl.classList.toggle('open', open);
    });
  });
}

buildSidebar();
buildPageChrome();

let dragging = false, lastX = 0, lastY = 0, velX = 0, velY = 0, moved = 0;
let tooltipXY = [0, 0], hoverCluster = null, selected = null;
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
  mouse.x = (cx / window.innerWidth) * 2 - 1;
  mouse.y = -(cy / window.innerHeight) * 2 + 1;
}
function maybeGrabHub() {
  if (selected) return; // no dragging while focused
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(hubs)[0];
  if (!hit) return;
  draggedHub = hit.object.userData.cluster;
  camera.getWorldDirection(dragNormal);
  dragPlane.setFromNormalAndCoplanarPoint(dragNormal, draggedHub.hub.getWorldPosition(new THREE.Vector3()));
  el.style.cursor = 'grabbing';
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

function onDown(x, y) { dragging = true; lastX = x; lastY = y; moved = 0; el.style.cursor = 'grabbing'; }
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
function onUp() { dragging = false; draggedHub = null; el.style.cursor = 'grab'; }

el.addEventListener('mousedown', (e) => { updateMouse(e.clientX, e.clientY); maybeGrabHub(); onDown(e.clientX, e.clientY); });
window.addEventListener('mousemove', (e) => {
  updateMouse(e.clientX, e.clientY);
  tooltipXY = [e.clientX, e.clientY];
  onMove(e.clientX, e.clientY);
});
window.addEventListener('mouseup', onUp);
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = THREE.MathUtils.clamp(camDist * (1 + e.deltaY * 0.0012), 10, 55);
}, { passive: false });

function touchDist(e) {
  const a = e.touches[0], b = e.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
el.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    updateMouse(e.touches[0].clientX, e.touches[0].clientY);
    maybeGrabHub();
    onDown(e.touches[0].clientX, e.touches[0].clientY);
  } else if (e.touches.length === 2) {
    pinchStart = touchDist(e); pinchBaseDist = camDist; dragging = false; draggedHub = null;
  }
}, { passive: false });
el.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    updateMouse(e.touches[0].clientX, e.touches[0].clientY);
    onMove(e.touches[0].clientX, e.touches[0].clientY);
  } else if (e.touches.length === 2 && pinchStart > 0) {
    camDist = THREE.MathUtils.clamp((pinchBaseDist * pinchStart) / touchDist(e), 10, 55);
  }
}, { passive: false });
el.addEventListener('touchend', () => { onUp(); pinchStart = 0; });

function select(c) {
  closePage(); // a sidebar/globe selection returns from any open page
  const wasFocused = !!selected;
  selected = selected === c ? null : c;
  if (selected) {
    if (!wasFocused) preFocusDist = camDist; // remember the free-look zoom
    camDist = FOCUS_DIST; // fly the camera in to the hub
    clusters.forEach((cl) => cl.itemEl.classList.toggle('selected', cl === selected));
    setExpanded(selected, true); // expand this cluster's pages
    selected.itemEl.scrollIntoView({ block: 'nearest' });
  } else {
    if (wasFocused) camDist = preFocusDist; // restore the previous zoom
    clusters.forEach((cl) => cl.itemEl.classList.remove('selected'));
  }
}
el.addEventListener('click', () => {
  if (moved > 6) return;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(hubs);
  select(hits.length ? hits[0].object.userData.cluster : null);
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (pageEl.classList.contains('show')) closePage();
  else if (selected) select(selected);
});

function updateHover() {
  if (dragging) { hoverCluster = null; tooltip.style.display = 'none'; return; }
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(hubs);
  if (hits.length) {
    hoverCluster = hits[0].object.userData.cluster;
    tooltip.textContent = hoverCluster.name;
    tooltip.style.display = 'block';
    tooltip.style.left = tooltipXY[0] + 'px';
    tooltip.style.top = tooltipXY[1] + 'px';
    el.style.cursor = 'pointer';
  } else {
    hoverCluster = null;
    tooltip.style.display = 'none';
    el.style.cursor = 'grab';
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

function animate() {
  requestAnimationFrame(animate);
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

  // Focus: ease the look-at toward the selected hub's world position (its
  // "white orbit"), or back to the globe center when released.
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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Dev handle for inspecting the scene from the console.
window.__SBG__ = {
  scene, camera, renderer, universe, clusters, hubs, yearLabel, raycaster, mouse,
  grabbed: () => draggedHub && draggedHub.name,
  select: (name) => select(clusters.find((c) => c.name === name)),
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
    const c = clusters.find((x) => x.name === name);
    draggedHub = c;
    const target = c.group.position.clone().setLength(Math.max(0.01, reqRadius));
    const rMax = Math.max(CUBE_RADIUS, GLOBE_INNER - c.maxOffset);
    target.setLength(THREE.MathUtils.clamp(target.length(), CUBE_RADIUS, rMax));
    c.group.position.copy(target);
    retetherThread(c.thread);
    draggedHub = null;
    // farthest node from center after the move (must stay < R)
    let worst = c.group.position.length() + c.maxOffset;
    return { reqRadius, hubRadius: +c.group.position.length().toFixed(2), rMax: +rMax.toFixed(2),
      cubeRadius: CUBE_RADIUS, farthestNode: +worst.toFixed(2), globeR: R };
  },
};
