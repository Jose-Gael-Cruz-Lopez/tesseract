// Pure globe layout data — no DOM, no storage, no three.js.
//
// buildGraphFromPages(pages) turns the store's flat page list into the graph
// the globe renders: every non-deleted top-level page is a hub placed on a
// seeded fibonacci sphere (the placement math ported from the old main.js),
// its children are leaves, its grandchildren are branches hanging off their
// leaf, and anything deeper is ignored. All randomness (direction jitter,
// distance, scale, leaf offsets, colors) comes from an RNG seeded by the
// page's id hash — NOT from a shared sequential stream — so the same input
// always produces the same layout and rebuilds never shuffle the globe.

export const GLOBE_R = 11; // globe radius (world units)

// Warm node palette, shared with the renderer. Hub `accent` cycles this by
// hub index (as the old clusters did).
export const PALETTE = [
  '#ffd166', '#ffb454', '#ff5d8f', '#ff2d55', '#c8b6ff', '#e8ecff', '#86d1ff',
];
