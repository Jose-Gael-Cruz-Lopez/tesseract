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

test('devProvider.getGraph fetches + maps to the five hubs', async () => {
  const graph = await devProvider(fakeApi()).getGraph();
  const hubs = hubGroups(graph);
  expect(hubs.map((h) => h.page.title)).toEqual(['Docs', 'Roadmap', 'Feed', 'Triage', 'My Work']);
  expect(hubs[0].leaves.length).toBe(1); // one doc
});

test('a failed surface is omitted, not fatal', async () => {
  const api = fakeApi({ getFeed: async () => ({ ok: false, status: 401 }) });
  const hubs = hubGroups(await devProvider(api).getGraph());
  expect(hubs.find((h) => h.page.title === 'Feed').leaves.length).toBe(0);
  expect(hubs.find((h) => h.page.title === 'Docs').leaves.length).toBe(1);
});

// Regression: the dev node index is what turns a graph click into an open-item
// call. It was silently empty after the {hubs} -> {nodes, links} change, so
// every Developer-mode item click became a no-op with no test noticing.
test('every node exposes page.id, so the dev click index can be built', async () => {
  const graph = await devProvider(fakeApi()).getGraph();
  const byId = new Map(graph.nodes.map((n) => [n.page.id, n.page]));
  expect(byId.size).toBe(graph.nodes.length);
  expect(byId.get('cat:docs').title).toBe('Docs');
  const doc = graph.nodes.find((n) => n.page.devKind === 'doc');
  expect(byId.get(doc.page.id).devRef).toBe(doc.page.devRef);
});

test('mountDevPage renders a doc and sanitizes the body (script stripped)', async () => {
  const container = document.createElement('section');
  document.body.appendChild(container);
  await mountDevPage(container, { devKind: 'doc', devRef: 'arch', title: 'Architecture' }, fakeApi());
  expect(container.querySelector('.dev-doc-title').textContent).toBe('Architecture');
  const body = container.querySelector('.dev-doc-body');
  expect(body.querySelector('h1')).not.toBeNull();
  expect(body.innerHTML).not.toContain('<script');
});

test('mountDevSidebar lists the five categories', () => {
  const container = document.createElement('aside');
  const graph = buildDevGraph({ docs: { docs: [{ slug: 'a', title: 'A' }] } });
  mountDevSidebar(container, { openDevItem: vi.fn() }, graph);
  const titles = [...container.querySelectorAll('.dev-sb-group-title')].map((e) => e.textContent);
  expect(titles).toEqual(['Docs', 'Roadmap', 'Feed', 'Triage', 'My Work']);
});

test('mountDevSidebar shows the active hub and switches hubs via the popover', () => {
  const container = document.createElement('aside');
  document.body.appendChild(container);
  const setDevHub = vi.fn();
  const hubs = [{ repo: 'acme/widgets', can_push: true }, { repo: 'acme/gadgets', can_push: false }];
  const ctx = { openDevItem: vi.fn(), devHub: () => 'acme/widgets', devHubs: () => hubs, setDevHub };
  mountDevSidebar(container, ctx, buildDevGraph({}));

  const hubBtn = container.querySelector('.dev-sb-hub');
  expect(hubBtn.textContent).toContain('acme/widgets');
  hubBtn.click();
  const items = [...document.querySelectorAll('.pop-root .sb-menu-item')];
  expect(items.map((i) => i.textContent)).toEqual(['✓ acme/widgets', 'acme/gadgets']);
  items[1].click();
  expect(setDevHub).toHaveBeenCalledWith('acme/gadgets');
  document.body.innerHTML = '';
