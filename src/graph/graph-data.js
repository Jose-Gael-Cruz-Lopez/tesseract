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
