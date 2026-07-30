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
