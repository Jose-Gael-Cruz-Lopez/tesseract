// Seeded graph data per DESIGN_SPEC.md · GRAPH DATA.
// Every random value a rendering accessor needs (distances, curve rotations,
// particle speeds/offsets) is precomputed here so later phases are pure lookups.

export const GLOBE_RADIUS = 300;

export const NODE_PALETTE = [
  '#ffd166',
  '#ffb454',
  '#ff5d8f',
  '#ff2d55',
  '#c8b6ff',
  '#e8ecff',
  '#86d1ff',
];

export const CLUSTER_NAMES = [
  'Projects',
  'People',
  'Ideas',
  'Research',
  'Content',
  'Code',
  'Reading',
  'Health',
  'Finance',
  'Travel',
  'Journal',
  'Learning',
];

// mulberry32: tiny, fast, good-enough seeded PRNG (no dependency).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateBrain(seed = 42) {
  const rand = mulberry32(seed);
  const range = (min, max) => min + rand() * (max - min);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const R = GLOBE_RADIUS;
  const nodes = [];
  const links = [];

  nodes.push({
    id: 'core',
    type: 'core',
    cluster: null,
    label: 'Core',
    val: 20,
    color: '#ff3355',
    fx: 0,
    fy: 0,
    fz: 0,
  });

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  CLUSTER_NAMES.forEach((name, i) => {
    // Fibonacci-sphere direction with jitter 0.22, renormalized.
    const fy = 1 - (i + 0.5) * (2 / CLUSTER_NAMES.length);
    const fr = Math.sqrt(Math.max(0, 1 - fy * fy));
    const theta = GOLDEN_ANGLE * i;
    let dir = [
      Math.cos(theta) * fr + range(-0.22, 0.22),
      fy + range(-0.22, 0.22),
      Math.sin(theta) * fr + range(-0.22, 0.22),
    ];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = dir.map((c) => c / len);

    const radius = range(0.55 * R, 0.9 * R);
    const [hx, hy, hz] = dir.map((c) => c * radius);
    const hubId = `hub-${i}`;
    const clusterColor = NODE_PALETTE[i % NODE_PALETTE.length];

    nodes.push({
      id: hubId,
      type: 'hub',
      cluster: name,
      label: name,
      val: 10,
      color: clusterColor,
      weight: range(0.9, 1.3),
      breathePhase: rand() * Math.PI * 2,
      fx: hx,
      fy: hy,
      fz: hz,
    });

    // Tether: both endpoints are fixed, so distance = actual geometric distance.
    links.push({
      source: 'core',
      target: hubId,
      kind: 'tether',
      cluster: name,
      distance: radius,
      curveRotation: rand() * Math.PI * 2,
      particleSpeed: range(0.004, 0.008),
      particleOffset: rand(),
    });

    const leafCount = 16 + Math.floor(rand() * 15); // 16..30
    for (let j = 0; j < leafCount; j++) {
      const leafId = `${hubId}-leaf-${j}`;
      const roll = rand();
      const val = roll < 0.7 ? 1 : roll < 0.9 ? 2 : 5;
      const num = String(j + 1).padStart(2, '0');

      nodes.push({
        id: leafId,
        type: 'leaf',
        cluster: name,
        label: `${name} · node ${num}`,
        val,
        color: pick(NODE_PALETTE),
        // Unpinned, but seeded near the hub so the layout settles quickly
        // into the dandelion shape instead of migrating from the origin.
        x: hx + range(-35, 35),
        y: hy + range(-35, 35),
        z: hz + range(-35, 35),
      });

      links.push({
        source: hubId,
        target: leafId,
        kind: 'spoke',
        cluster: name,
        distance: range(25, 65),
      });

      if (rand() < 0.25) {
        const branchId = `${leafId}-b`;
