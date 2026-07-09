// Read-only viewer for a canopy item, shown in the shell page panel when a dev
// node is clicked. Docs render their full markdown (sanitized); other kinds
// (feed / milestone / triage / PR / issue) show a compact card + an "Open in
// canopy" link. No editing controls — the dev sphere is read-only.

import { el } from '../ui/popover.js';
import { canopyApi } from './canopy-api.js';
import { getDevConfig } from '../data/store.js';

const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// marked + dompurify are dynamic-imported so they never enter the knowledge-mode
// bundle. dompurify sanitizes, so a canopy body can never inject script.
async function renderMarkdown(md) {
  const [{ marked }, purify] = await Promise.all([import('marked'), import('dompurify')]);
  const DOMPurify = purify.default || purify;
  return DOMPurify.sanitize(marked.parse(md || '', { async: false }));
}

const KIND_LABEL = {
  doc: 'Doc', milestone: 'Milestone', feed: 'Feed entry', triage: 'Triage item', pr: 'Pull request', todo: 'Issue',
};

// Render a canopy dev node read-only into `container` (#shell-page). `api` is
// injectable for tests.
export async function mountDevPage(container, node, api = canopyApi) {
  container.innerHTML = '';
  container.classList.add('show');
  container.setAttribute('aria-hidden', 'false');

  const doc = el('article', 'dev-doc');
  const head = el('div', 'dev-doc-head');
  head.appendChild(el('span', 'dev-doc-kind', KIND_LABEL[node.devKind] || 'Item'));
  head.appendChild(el('h1', 'dev-doc-title', escapeText(node.title || 'Untitled')));
  const { url } = getDevConfig();
  if (url) {
    const link = el('a', 'dev-doc-open', 'Open in canopy ↗');
    link.href = url.replace(/\/$/, '');
    link.target = '_blank';
    link.rel = 'noopener';
    head.appendChild(link);
  }
  const body = el('div', 'dev-doc-body');
  body.textContent = 'Loading…';
  doc.append(head, body);
  container.appendChild(doc);

  if (node.devKind === 'doc') {
    const res = await api.getDoc(node.devRef);
    if (res.ok) {
      const md = res.data.body ?? res.data.live_body ?? res.data.doc?.body ?? '';
      body.innerHTML = await renderMarkdown(md);
    } else {
      body.textContent = res.status === 401 ? 'Not authorized — reconnect canopy in Developer settings.' : 'Could not load this doc.';
    }
  } else {
    // Compact read-only card for non-doc items (the rich body lives in docs).
    body.textContent = '';
    body.appendChild(el('p', 'dev-doc-note', `${KIND_LABEL[node.devKind] || 'Item'} · ${escapeText(node.title || '')}`));
  }
}
