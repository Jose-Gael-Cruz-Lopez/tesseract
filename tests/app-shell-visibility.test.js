// @vitest-environment happy-dom
// The graph pause/resume wiring the force-graph migration promised but never
// wired: with a page slide-over covering the graph, the WebGL animation loop
// kept running underneath (battery/CPU for pixels nobody sees). The shell must
// pause AFTER the 600ms camera fly-to lands (freezing mid-flight looks broken)
// and resume the instant the page closes.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from '../src/data/store.js';
import { mountApp } from '../src/app.js';

const graphs = vi.hoisted(() => ({ instances: [] }));
vi.mock('../src/graph/graph.js', () => ({
  initGraph: vi.fn(() => {
    const g = {
      focusPage: vi.fn(),
      clearFocus: vi.fn(),
      setVisible: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
    };
    graphs.instances.push(g);
    return g;
  }),
}));

// The remount test needs the developer sphere to actually MOUNT a second graph
// (a vacuous remount that creates no graph proves nothing about the cancelled
// pause). Stub the canopy API at the module boundary: a connected hub list and
// empty read surfaces are enough for mountDevSphere → initGraph to run.
vi.mock('../src/dev/canopy-api.js', () => {
  const ok = (data) => async () => ({ ok: true, status: 200, data });
  return {
    isConfigured: () => true,
    canopyApi: {
      getMyRepos: ok({ repos: [{ repo: 'o/r', can_push: true }], appSlug: null }),
      getDocs: ok({ docs: [] }),
      getRoadmap: ok({ narrative: '', milestones: [] }),
      getFeed: ok({ feed: [] }),
      getTriage: ok({ items: [] }),
      getDashboard: ok({ previousActivity: [], todo: [] }),
      getMe: ok({ login: 'dev' }),
      getDoc: ok({ body: '' }),
      search: ok({ result: { primary: [], pointers: [] } }),
    },
    makeCanopyApi: () => ({}),
  };
});

function installMemoryLocalStorage() {
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true,
  });
}

let handle;
let pageId;

beforeEach(() => {
  installMemoryLocalStorage();
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  graphs.instances.length = 0;
  store.resetStore();
  store.seedWorkspace({ name: 'Ada', email: 'ada@example.com' });
  pageId = store.topLevelPages()[0].id;
  handle = mountApp(document.getElementById('root'), {});
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const globe = () => graphs.instances.at(-1);

describe('graph visibility across the page slide-over', () => {
  test('opening a page pauses the graph — but only after the camera fly-to lands', () => {
    handle.ctx.openPage(pageId);
    expect(globe().focusPage).toHaveBeenCalledWith(pageId);
    expect(globe().setVisible).not.toHaveBeenCalled(); // mid-flight: still animating

    vi.advanceTimersByTime(700);
    expect(globe().setVisible).toHaveBeenCalledWith(false);
  });

  test('closing the page resumes the graph immediately', () => {
    handle.ctx.openPage(pageId);
    vi.advanceTimersByTime(700);
    globe().setVisible.mockClear();

    handle.ctx.closePage();
    expect(globe().setVisible).toHaveBeenCalledWith(true);
  });

  test('open then close within the fly-to window never pauses at all', () => {
    handle.ctx.openPage(pageId);
    handle.ctx.closePage();
    vi.advanceTimersByTime(2000);
    const calls = globe().setVisible.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(false); // the pending pause was cancelled
  });

  test('a mode remount within the window never pauses the NEW graph', async () => {
    store.setDevAvailable(true);
    store.setDevHub('o/r'); // the dev sphere mounts a REAL second graph
    handle.ctx.openPage(pageId); // pause pending on graph #1
    const first = globe();

    handle.ctx.setMode('developer');
    // mountDeveloper resolves /me/repos then mounts the sphere — drain the
    // microtask queue (fake timers leave promise jobs runnable).
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(graphs.instances.length).toBeGreaterThan(1); // the remount actually created one
    expect(globe()).not.toBe(first);

    vi.advanceTimersByTime(2000);
    // The pause scheduled against #1 was cancelled by the teardown: it must
    // hit neither the disposed graph nor the freshly mounted one.
    for (const g of graphs.instances) {
      expect(g.setVisible).not.toHaveBeenCalledWith(false);
    }
  });

  test('goHome in a developer state with no sphere mounted (globe null) does not crash', () => {
    // Regression guard for a pre-existing crash: closeDevPage called
    // globe.clearFocus() unguarded, and the topbar home button reaches it in
    // every developer no-sphere state (hub picker / connect prompt).
    store.setDevAvailable(true);
    handle.ctx.setMode('developer'); // async sphere mount hasn't resolved: globe is null
    expect(() => handle.ctx.goHome()).not.toThrow();
  });
});
