// Map canopy's read DTOs onto the globe graph. The developer sphere reuses the
// exact knowledge-globe builder (buildGraphFromPages) by handing it synthetic
// "pages": five top-level category pages (→ hubs) and one child page per canopy
// item (→ orbiting leaves). Each item page carries { devKind, devRef } so a
// click knows what to open. The globe engine renders this graph unchanged.

import { buildGraphFromPages } from '../globe/globe-data.js';

const CATEGORIES = [
  { id: 'cat:docs', title: 'Docs', icon: '📄' },
  { id: 'cat:roadmap', title: 'Roadmap', icon: '🗺️' },
  { id: 'cat:feed', title: 'Feed', icon: '📣' },
  { id: 'cat:triage', title: 'Triage', icon: '🧹' },
  { id: 'cat:mywork', title: 'My Work', icon: '✅' },
];

// Accepts the canopy read DTOs (the `data` of each canopy-api call), any of
// which may be missing. Robust to either the wrapped ({docs:[…]}) or bare-array
// forms.
export function buildDevGraph({ docs, roadmap, feed, triage, dashboard } = {}) {
  const pages = CATEGORIES.map((c) => ({
    id: c.id, parentId: null, title: c.title, icon: c.icon, devKind: 'category',
  }));

  const push = (catId, id, title, devKind, devRef) =>
    pages.push({ id, parentId: catId, title: title || '(untitled)', devKind, devRef });

  for (const d of docs?.docs || (Array.isArray(docs) ? docs : [])) {
    push('cat:docs', 'doc:' + d.slug, d.title || d.slug, 'doc', d.slug);
  }
  for (const m of roadmap?.milestones || []) {
    push('cat:roadmap', 'milestone:' + m.id, m.title, 'milestone', m.id);
  }
  (feed?.feed || (Array.isArray(feed) ? feed : [])).forEach((f, i) => {
    push('cat:feed', 'feed:' + i, f.summary, 'feed', f.id ?? i);
  });
  (triage?.items || (Array.isArray(triage) ? triage : [])).forEach((t, i) => {
    push('cat:triage', 'triage:' + i, t.raw || t.reason, 'triage', t.id ?? i);
  });
  for (const pr of dashboard?.previousActivity || []) {
    push('cat:mywork', 'pr:' + pr.number, pr.displayTitle || pr.title, 'pr', pr.number);
  }
  for (const td of dashboard?.todo || []) {
    push('cat:mywork', 'todo:' + td.number, td.displayTitle || td.title, 'todo', td.number);
  }

  return buildGraphFromPages(pages);
}

export { CATEGORIES };
