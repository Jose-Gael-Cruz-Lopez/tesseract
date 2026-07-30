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

// Deterministic PRNG (same generator the old scene used, reseedable).
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash → 32-bit seed for a page id.
export function hashId(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
