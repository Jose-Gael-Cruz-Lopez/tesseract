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
  return h >>> 0;
}

// ---------- tiny [x,y,z] vector helpers ----------

const vlen = (v) => Math.hypot(v[0], v[1], v[2]);

function setLength(v, l) {
  const cur = vlen(v) || 1;
  return [(v[0] / cur) * l, (v[1] / cur) * l, (v[2] / cur) * l];
}

// Random unit vector (ported from the old randDir; consumes 3 rng values).
function randDir(rng) {
  const v = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
  const l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (l2 < 1e-4) return [1, 0, 0];
  return setLength(v, 1);
}

// Palette color → [r,g,b] floats (0..1) for point-cloud vertex colors.
function paletteRGB(rng) {
  const hex = PALETTE[Math.floor(rng() * PALETTE.length)];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const golden = Math.PI * (3 - Math.sqrt(5));

/**
 * @param {Array} pages  flat page records ({id, parentId, deleted, ...})
 * @returns {{hubs: Array<{page, dir:[x,y,z], dist, scale, accent,
 *   leaves: Array<{page, parentIdx, rest:[x,y,z], col:[r,g,b], major}>}>}}
 *
 * `parentIdx` is -1 for a direct child (anchored to the hub) or the index of
 * the parent leaf within the same `leaves` array for a grandchild. `rest` is
 * the spring rest offset from that anchor, capped so every node stays inside
 * the globe shell (|hub| + |offset| <= 0.94·R).
 */
export function buildGraphFromPages(pages) {
  const alive = (pages || []).filter((p) => p && !p.deleted);
  const byParent = new Map();
  for (const p of alive) {
    const key = p.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  }
  const tops = byParent.get(null) || [];
  const n = tops.length;

  const hubs = tops.map((page, i) => {
    const rng = mulberry32(hashId(page.id));

    // Fibonacci sphere base direction (index-spread), id-seeded jitter —
    // ported from the old cluster placement.
    const yy = 1 - ((i + 0.5) * 2) / n;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i;
    const j = randDir(rng);
    const dir = setLength(
      [Math.cos(th) * rr + j[0] * 0.22, yy + j[1] * 0.22, Math.sin(th) * rr + j[2] * 0.22],
      1,
    );

    // Hubs sit inward enough that every leaf fits between hub and shell.
    const dist = GLOBE_R * (0.4 + rng() * 0.3);
    const scale = 0.8 + rng() * 0.9;
    const budget = GLOBE_R * 0.94 - dist;

    const leaves = [];
    for (const child of byParent.get(page.id) || []) {
      const lr = mulberry32(hashId(child.id));
      let rest = setLength(randDir(lr), (0.7 + lr() * 1.8) * scale);
      if (vlen(rest) > budget) rest = setLength(rest, budget);
      const col = paletteRGB(lr);
      const major = lr() < 0.3;
      const leafIdx = leaves.length;
      leaves.push({ page: child, parentIdx: -1, rest, col, major });

      for (const grand of byParent.get(child.id) || []) {
        const gr = mulberry32(hashId(grand.id));
        const off = setLength(randDir(gr), 0.55 * scale);
        let abs = [rest[0] + off[0], rest[1] + off[1], rest[2] + off[2]];
        if (vlen(abs) > budget) abs = setLength(abs, budget);
        leaves.push({
          page: grand,
          parentIdx: leafIdx,
          rest: [abs[0] - rest[0], abs[1] - rest[1], abs[2] - rest[2]],
          col: paletteRGB(gr),
          major: false,
        });
        // deeper descendants are intentionally ignored
      }
    }

    return { page, dir, dist, scale, accent: PALETTE[i % PALETTE.length], leaves };
  });

  return { hubs };
}
