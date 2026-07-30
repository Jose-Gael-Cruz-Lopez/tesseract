# 3D Force-Directed Graph Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mnemosphere's bespoke three.js globe with `3d-force-graph` as the renderer for both the Knowledge globe and the Developer canopy sphere, preserving every interaction the app depends on.

**Architecture:** A new `src/graph/` module exposes `initGraph(container, hooks, provider)` with the **identical** contract `initGlobe` had (same hooks `onOpenPage`/`onHubFocus`, same five methods `focusPage`/`clearFocus`/`setVisible`/`dispose`/`refresh`). Because the contract is unchanged, `app.js` changes by two imports and two call sites, and the sidebar, topbar, editor, hub picker and dev-sidebar are untouched. `src/globe/` is then deleted.

**Tech Stack:** Vanilla JS (ES modules), Vite 7, Vitest + happy-dom, `3d-force-graph@^1.80.0`, `three@0.185.1` (pinned).

**Design spec:** `docs/superpowers/specs/2026-07-30-3d-force-graph-migration-design.md`

## Global Constraints

- **Do not modify `canopy/`.** `3d-force-graph` is a client-side renderer with no backend; the backend stays canopy, unchanged.
- **Do not change the renderer contract.** `initGraph` must accept `{onOpenPage, onHubFocus}` and return `{focusPage, clearFocus, setVisible, dispose, refresh}`. Consumers depend on these exact names.
- **three.js stays pinned at `0.185.1`.** Do not bump it. `3d-force-graph@1.80.0` takes `three: ">=0.179 <1"` as a regular dependency, which `0.185.1` satisfies.
- **The library is constructed with `new`:** `new ForceGraph3D(element)`. The older `ForceGraph3D()(element)` call form is **wrong** for 1.80.0 and will throw.
- **Theme event:** the app dispatches `document` event `'mnemosphere:themechange'` with `e.detail.theme` of `'dark' | 'light'`. Read the current value from `document.documentElement.dataset.theme`.
- **Run tests from the repo root** (`npm test`), not from `canopy/`. The root suite is Vitest over `tests/**`.
