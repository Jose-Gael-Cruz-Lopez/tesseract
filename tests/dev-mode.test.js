// @vitest-environment happy-dom
import { beforeEach, test, expect, vi } from 'vitest';
import { devProvider } from '../src/dev/dev-provider.js';
import { mountDevPage } from '../src/dev/dev-page.js';
import { mountDevSidebar } from '../src/dev/dev-sidebar.js';
import { mountDevHubPicker, hubInstallUrl } from '../src/dev/dev-hub.js';
import { buildDevGraph } from '../src/dev/dev-graph.js';

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
  const { hubs } = await devProvider(fakeApi()).getGraph();
  expect(hubs.map((h) => h.page.title)).toEqual(['Docs', 'Roadmap', 'Feed', 'Triage', 'My Work']);
  expect(hubs[0].leaves.length).toBe(1); // one doc
});

test('a failed surface is omitted, not fatal', async () => {
  const api = fakeApi({ getFeed: async () => ({ ok: false, status: 401 }) });
  const { hubs } = await devProvider(api).getGraph();
  expect(hubs.find((h) => h.page.title === 'Feed').leaves.length).toBe(0);
  expect(hubs.find((h) => h.page.title === 'Docs').leaves.length).toBe(1);
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
});

test('mountDevSidebar renders no hub switcher without an active hub', () => {
  const container = document.createElement('aside');
  mountDevSidebar(container, { openDevItem: vi.fn() }, buildDevGraph({}));
  expect(container.querySelector('.dev-sb-hub')).toBeNull();
});

test('hub picker lists connected hubs and picks one', () => {
  const container = document.createElement('div');
  const onPick = vi.fn();
  mountDevHubPicker(container, {
    repos: [{ repo: 'acme/widgets', can_push: true }, { repo: 'acme/gadgets', can_push: false }],
    appSlug: 'canopy-app',
    onPick,
  });
  const options = [...container.querySelectorAll('.dev-hub-option')];
  expect(options.map((o) => o.querySelector('.dev-hub-name').textContent)).toEqual(['acme/widgets', 'acme/gadgets']);
  expect(options.map((o) => o.querySelector('.dev-hub-access').textContent)).toEqual(['Push access', 'Read-only']);
  options[1].click();
  expect(onPick).toHaveBeenCalledWith('acme/gadgets');
});

test('hub picker with no repos shows the connect-a-repo empty state with the App install link', () => {
  const container = document.createElement('div');
  mountDevHubPicker(container, { repos: [], appSlug: 'canopy-app', onPick: vi.fn() });
  expect(container.querySelector('h2').textContent).toBe('Connect a repo');
  expect(container.querySelector('.dev-hub-option')).toBeNull();
  const link = container.querySelector('.dev-hub-connect');
  expect(link.getAttribute('href')).toBe('https://github.com/apps/canopy-app/installations/new');
  expect(link.getAttribute('target')).toBe('_blank');
});

test('hub picker error state offers retry instead of connect guidance', () => {
  const container = document.createElement('div');
  const onRetry = vi.fn();
  mountDevHubPicker(container, { repos: [], error: true, onRetry });
  expect(container.querySelector('h2').textContent).toBe('Hubs unavailable');
  expect(container.querySelector('.dev-hub-connect')).toBeNull();
  container.querySelector('.dev-hub-retry').click();
  expect(onRetry).toHaveBeenCalled();
});

test('hubInstallUrl falls back to the GitHub installations page without an app slug', () => {
  expect(hubInstallUrl(null)).toBe('https://github.com/settings/installations');
  expect(hubInstallUrl('canopy-app')).toBe('https://github.com/apps/canopy-app/installations/new');
});
