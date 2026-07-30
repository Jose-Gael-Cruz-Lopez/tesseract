// @vitest-environment happy-dom
import { beforeEach, test, expect, vi } from 'vitest';
import { devProvider } from '../src/dev/dev-provider.js';
import { mountDevPage } from '../src/dev/dev-page.js';
import { mountDevSidebar, mountDevSidebarChrome } from '../src/dev/dev-sidebar.js';
import { mountDevHubPicker, hubInstallUrl, shouldClearDevHub } from '../src/dev/dev-hub.js';
import { buildDevGraph } from '../src/dev/dev-graph.js';
import { hubGroups } from '../src/graph/graph-data.js';

// marked + dompurify are real in the browser but dompurify returns "" under
// happy-dom (needs a fuller DOM). Mock both so the dev-page flow is testable;
// real sanitization is verified live.
vi.mock('marked', () => ({
  marked: { parse: (md) => `<h1>${String(md || '').split('\n')[0].replace(/^#\s*/, '')}</h1><p>body</p><script>alert(1)</script>` },
}));
vi.mock('dompurify', () => ({
  default: { sanitize: (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, '') },
}));

// A fake canopy-api: each getter resolves to { ok, data }.
function fakeApi(over = {}) {
  const ok = (data) => async () => ({ ok: true, status: 200, data });
  return {
    getDocs: ok({ docs: [{ slug: 'arch', title: 'Architecture' }] }),
    getRoadmap: ok({ narrative: 'x', milestones: [{ id: 1, title: 'v1' }] }),
    getFeed: ok({ feed: [{ summary: 'merged' }] }),
    getTriage: ok({ items: [{ raw: 'oov tag' }] }),
    getDashboard: ok({ previousActivity: [], todo: [] }),
    getDoc: ok({ body: '# Hello\n\nSome text.\n\n<script>alert(1)</script>' }),
    ...over,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 },
    configurable: true, writable: true,
  });
});

