# Second Brain Globe

An interactive 3D knowledge globe. Every cluster of thought, tethered to a single core.

![Second Brain Globe hero](docs/hero.png)

![Demo](docs/demo.gif)

A dark wireframe globe holds twelve glowing clusters of knowledge. At the center, a nested-cube tesseract nucleus convolves, feeding energy along curved tethers to every cluster. A self-contained `three.js` scene, built with Vite.

## Features

- **Tesseract nucleus.** A solid lit red cube inside counter-rotating wire cubes and frosted shells. The whole cluster spins about the globe's center. The power source of the network.
- **Dandelion clusters.** Twelve glowing hubs on a fibonacci sphere, each fanning out 16 to 30 leaves as soft additive dots with the occasional two-hop branch.
- **Energy pulses.** A bright pulse continuously travels from the core outward along every curved tether.
- **Click-to-focus.** Click a hub and everything outside that cluster dims to near-black while a panel shows its details. Click empty space (or Esc) to release.
- **Additive glow.** Hubs, leaves, streams and dust are soft additive sprites over a dark globe, no post-processing needed.
- **Seeded reproducible layout.** One seed, one layout, generated from a tiny mulberry32 PRNG.

## Quickstart

```bash
git clone https://github.com/Jose-Gael-Cruz-Lopez/second-brain-globe.git
cd second-brain-globe
npm install
npm run dev
```

## Controls

| Input | Action |
| --- | --- |
| Drag | Rotate the globe |
| Scroll | Zoom in and out |
| Hover a hub | Preview its cluster name |
| Click a hub | Focus that cluster (dims the rest, shows a panel) |
| Click empty space / Esc | Release focus |

## Data

The whole scene is generated procedurally in `src/main.js` from a seeded mulberry32 PRNG (seed `42`), so every load produces the same layout. The twelve clusters, their hubs, leaves, branches and tethers are built directly as `three.js` objects rather than from a data file.

To drive it from your own knowledge base (Obsidian, Notion, a Supabase table), replace the `clusterNames` array and the per-cluster leaf loop in `src/main.js`: give each cluster a name and a set of leaves, and the fibonacci placement, tethers and glow are applied automatically. The tesseract nucleus lives in `src/nodes.js`.

## Deploy

**Vercel** works zero-config for Vite: import the repo and deploy, no settings needed.

**GitHub Pages** needs the base path set in `vite.config.js`:

```js
export default defineConfig({
  base: '/second-brain-globe/',
  resolve: { dedupe: ['three'] },
});
```

Then build and publish the `dist/` folder:

```bash
npm run build
git subtree push --prefix dist origin gh-pages
# or: npx gh-pages -d dist
```

Enable Pages for the `gh-pages` branch in the repo settings.

## Roadmap

- **Real data adapters.** First-class importers for Obsidian vaults, Notion exports and Supabase tables.
- **Search beam.** Type a query and a light path traces from the core to the matching node.
- **Time scrubber.** The floating year label becomes a control that filters the graph by time.
- **Cluster dive.** Expand a hub into its own sub-globe and navigate down the hierarchy.

## Stack and credits

- [three.js](https://threejs.org/) (a single self-contained scene; no scene-graph framework)
- [Vite](https://vite.dev/)
- The dandelion-on-a-globe look is inspired by [3d-force-graph](https://github.com/vasturiano/3d-force-graph) by [vasturiano](https://github.com/vasturiano)

Design notes live in [DESIGN_SPEC.md](DESIGN_SPEC.md).

## License

MIT. See [LICENSE](LICENSE).
