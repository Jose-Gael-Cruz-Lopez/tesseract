// The Mnemosphere graph: a 3D force-directed view of the workspace, rendered by
// 3d-force-graph (three.js + d3-force-3d) instead of the hand-written globe
// scene it replaces.
//
// Two modes share this one engine. Knowledge mode reads the page store and
// subscribes to 'pages' events; Developer mode is handed a `provider` whose
// getGraph() returns the same {nodes, links} shape from canopy. The engine
// never learns which mode it is in — a node's `kind` ('hub' | 'leaf') is all it
// needs to route a click.

import ForceGraph3D from '3d-force-graph';
import { buildGraphFromPages, escapeHtml } from './graph-data.js';
import { getPages, onStore, offStore } from '../data/store.js';

export { buildGraphFromPages };

const THEMES = {
  dark: { bg: '#05060a', link: 'rgba(200,210,255,0.22)' },
  light: { bg: '#f7f7f5', link: 'rgba(40,50,80,0.25)' },
};

const readTheme = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark')
    ? 'dark' : 'light';

/**
 * @param {HTMLElement} container renders into this element
 * @param {{onOpenPage?(pageId), onHubFocus?(pageId|null)}} hooks
 * @param {{getGraph(): Promise<{nodes,links}>}|null} provider developer mode source
 * @returns {{focusPage(id), clearFocus(), setVisible(bool), dispose(), refresh()}}
 */
export function initGraph(container, hooks = {}, provider = null) {
  const onOpenPage = hooks.onOpenPage || (() => {});
  const onHubFocus = hooks.onHubFocus || (() => {});

  container.classList.add('graph-stage');
  let theme = readTheme();
  container.classList.toggle('graph-light', theme === 'light');

  const graph = new ForceGraph3D(container)
    .nodeId('id')
    // nodeLabel is rendered as HTML by 3d-force-graph, so a page title is
    // untrusted markup here. The globe this replaces used textContent and was
    // safe by construction; this is not, so escape explicitly.
    .nodeLabel((n) => escapeHtml(n.label))
    .nodeVal((n) => n.val)
    .nodeColor((n) => n.color)
    .linkColor(() => THEMES[theme].link)
    .backgroundColor(THEMES[theme].bg)
    .showNavInfo(false)
    .width(container.clientWidth || 800)
    .height(container.clientHeight || 600)
    .onNodeClick((node) => {
      if (!node) return;
      focusNode(node);
      // A hub is focused, not opened — matching the globe's behaviour, where a
      // top-level page is a focus target even though a page exists behind it.
      if (node.kind === 'hub') onHubFocus(node.id);
      else onOpenPage(node.id);
    });

  let selected = null;

  function focusNode(node) {
    selected = node;
    const dist = 90;
    const len = Math.hypot(node.x || 0, node.y || 0, node.z || 0) || 1;
    const k = 1 + dist / len;
    graph.cameraPosition(
      { x: (node.x || 0) * k, y: (node.y || 0) * k, z: (node.z || 0) * k },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      600,
    );
  }

  /* ---------- data ---------- */
  let disposed = false;

  function setData(data) {
    // A canopy read in flight when the mode is switched must not write into a
    // destroyed renderer.
    if (disposed) return;
    const next = data && data.nodes ? data : { nodes: [], links: [] };
    // Carry settled positions across rebuilds. Knowledge mode rebuilds on every
    // store 'pages' event — roughly one per editor autosave — and handing the
    // engine brand-new node objects re-heats the simulation, so the whole graph
    // visibly re-explodes while the user is typing. Reusing the previous
    // coordinates keeps an edit local to the node that changed.
    const prev = new Map(((graph.graphData() || {}).nodes || []).map((n) => [n.id, n]));
    for (const n of next.nodes) {
      const old = prev.get(n.id);
      if (!old) continue;
      n.x = old.x; n.y = old.y; n.z = old.z;
      n.vx = old.vx; n.vy = old.vy; n.vz = old.vz;
    }
    graph.graphData(next);
  }

  function rebuild() {
    if (provider) {
      // Developer mode: never let a failed canopy read blank the view.
      Promise.resolve(provider.getGraph())
        .then(setData)
        .catch(() => setData({ nodes: [], links: [] }));
    } else {
      setData(buildGraphFromPages(getPages()));
    }
  }

  rebuild();

  // Knowledge mode tracks the store live, exactly as the globe did.
  const onPages = () => { if (!provider) rebuild(); };
  if (!provider) onStore('pages', onPages);

  /* ---------- theme ---------- */
  function onThemeChange(e) {
    theme = (e && e.detail && e.detail.theme) ? e.detail.theme : readTheme();
    theme = theme === 'dark' ? 'dark' : 'light';
    container.classList.toggle('graph-light', theme === 'light');
    graph.backgroundColor(THEMES[theme].bg);
    graph.linkColor(() => THEMES[theme].link);
  }
  document.addEventListener('mnemosphere:themechange', onThemeChange);

  /* ---------- sizing ---------- */
  const resize = () => {
    graph.width(container.clientWidth || 800).height(container.clientHeight || 600);
  };
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  }
  window.addEventListener('resize', resize);

  /* ---------- public handle ---------- */
  let visible = true;

  // Every public method no-ops after disposal. app.js disposes on mode switch
