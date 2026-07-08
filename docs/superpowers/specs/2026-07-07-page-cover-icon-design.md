# Notion-style page covers & icons

**Date:** 2026-07-07
**Status:** Approved, implementing

## Goal

Make each page (a globe node opened as a Notion-style doc) support a
**user-customizable cover** and a **user-customizable icon**, both saved
per page. Today the cover is auto-derived from the cluster accent and there
is no icon.

## Scope (v1)

- **Cover sources:** a curated gallery of solid colors + gradients, and an
  image via URL ("Link"). Default (uncustomized) cover stays the current
  **cluster-accent gradient**. A **Remove** action reverts to that default.
- **Icon sources:** searchable **emoji** grid, a curated **line-icon set**
  (Lucide-style, tintable with a color swatch row), and **upload** of a
  local image (stored as a data-URL). A **Remove** action clears it.
- Default: no icon until the user adds one (Notion-style "Add icon").

### Out of scope (deferred)

Cover **Reposition** drag, cover **download** button, **Unsplash** search.

## Layout

```
cover (≈200px, full width)        [Change][Remove] on hover
   ( 78px icon, overlaps cover bottom-left )
"+ Add icon" ghost button (only when no icon)
# Title
Part of <Cluster> · a node on the globe
body…
```

The icon overlaps the bottom-left of the cover with a negative top margin,
matching Notion. Cover controls appear on cover hover; the icon opens its
picker on click; when absent, an "Add icon" affordance shows on doc hover.

## Data & persistence

Extend the existing per-page record at `localStorage['mnemo:page:' + url]`
from `{ title, body, edited }` to also carry:

```js
cover: { type: 'gradient' | 'color' | 'link', value: <presetId | css | url> }
icon:  { type: 'emoji' | 'icon' | 'image', value: <char | iconId | dataURL>, color? }
```

- Both fields are optional. Missing `cover` → cluster-accent gradient.
  Missing `icon` → no icon. So **no migration** is needed; existing pages
  keep working.
- Writes go through the existing debounced `persistPage()`. Picking a
  cover/icon updates `currentNode.cover` / `currentNode.icon`, re-renders,
  and persists.

## Components

- `src/decor-data.js` (new, pure data, isolated & testable):
  - `COVER_PRESETS` — `[{ id, label, css }]` solids + gradients.
  - `ICON_SET` — `[{ id, svg }]` curated line icons.
  - `EMOJI` — curated `[{ char, name }]` common emoji for the searchable grid.
- `main.js` (behavior; needs the page DOM globals):
  - `applyCover(node)` / `applyIcon(node)` — render from the node's cover/icon
    or the defaults; called in `openNode()`.
  - `openCoverPicker(anchor)` — tabbed popover: Gallery grid + Link input +
    Remove.
  - `openIconPicker(anchor)` — tabbed popover: Emoji search grid + Icons grid
    with color swatches + Upload + Remove.
  - A shared anchored-popover positioner (same pattern as the sidebar
    `openRowMenu`).
- `index.html` — add the `#pg-icon` button, cover `[Change][Remove]`
  controls, and the "Add icon" affordance element.
- `src/styles.css` — styles for the icon, cover controls, popovers, tabs,
  gallery/emoji/icon grids, color swatches, and upload button.

## Verification

Drive the running app in Chrome: open a page, confirm the default
accent-gradient cover and no icon; change the cover from the gallery and via
a URL; add an emoji, a tinted line-icon, and an uploaded image as the icon;
reload and confirm cover + icon persist; Remove reverts each to its default.
