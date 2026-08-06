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

  test('a mode remount within the window never pauses the NEW graph', () => {
    handle.ctx.openPage(pageId);
    const first = globe();
    // Simulate a teardown/remount (e.g. mode switch) before the pause fires.
    store.setDevAvailable(true);
    handle.ctx.setMode('developer');
    vi.advanceTimersByTime(2000);
    expect(first.setVisible).not.toHaveBeenCalledWith(false);
    for (const g of graphs.instances) {
      expect(g.setVisible).not.toHaveBeenCalledWith(false);
    }
  });
});
