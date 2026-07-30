// Pure graph data for the 3D force layout — no DOM, no storage, no three.js.
//
// buildGraphFromPages(pages) turns the store's flat page list into the
// {nodes, links} shape 3d-force-graph consumes: one node per live page, one
// link per parent->child edge, at ANY depth (the old sphere builder capped at
// three levels because it could not place deeper nodes).
//
// Initial x/y/z are seeded from the page id, NOT the array index. d3-force-3d
// seeds from index by default, and the store's page order is not stable, so
// index-seeding would reshuffle the whole layout whenever page order changed.
// Seeding by id means the same page set always settles the same way.

export const PALETTE = [
  '#ffd166', '#ffb454', '#ff5d8f', '#ff2d55', '#c8b6ff', '#e8ecff', '#86d1ff',
];

// Deterministic PRNG, carried over from the retired globe-data.js.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash -> 32-bit seed for a page id.
export function hashId(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Radius of the shell the simulation starts from. Not a constraint — the force
// layout is free to move nodes anywhere from here.
const SEED_RADIUS = 120;

/**
 * @param {Array} pages flat page records ({id, parentId, deleted, title, ...})
 * @returns {{nodes: Array, links: Array}}
 */
export function buildGraphFromPages(pages) {
  const alive = (pages || []).filter((p) => p && !p.deleted);
  const liveIds = new Set(alive.map((p) => p.id));

  // A page is a hub when it has no REACHABLE parent: either genuinely
  // top-level, or its parent was deleted. Without the second case a live child
  // of a deleted parent would emit a link to a node that does not exist.
  const isHub = (p) => p.parentId == null || !liveIds.has(p.parentId);

  const nodes = alive.map((page) => {
    const seed = hashId(page.id);
    const rng = mulberry32(seed);
    // Uniform point on a sphere, consumed in a fixed order so the mapping from
    // id -> position is total and stable.
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const hub = isHub(page);
    return {
      id: page.id,
      kind: hub ? 'hub' : 'leaf',
      page,
      label: page.title || '(untitled)',
      color: PALETTE[seed % PALETTE.length],
      val: hub ? 8 : 3,
      x: Math.cos(theta) * r * SEED_RADIUS,
      y: u * SEED_RADIUS,
      z: Math.sin(theta) * r * SEED_RADIUS,
    };
  });

  const links = [];
  for (const page of alive) {
    if (!isHub(page)) links.push({ source: page.parentId, target: page.id });
