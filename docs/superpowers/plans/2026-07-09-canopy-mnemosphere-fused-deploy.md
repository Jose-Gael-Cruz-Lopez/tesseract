# Fused Deploy Implementation Plan

> **For agentic workers:** executed inline in-session (coupled tasks; the build script is iterated live). Steps use checkbox syntax.

**Goal:** Serve the Mnemosphere UI (`/`) and the canopy backend + admin UI (`/admin`) from one Cloudflare Worker on one URL, with Developer mode reading same-origin.

**Architecture:** Canopy's Worker is unchanged (routing/gate/auth). Its `[assets]` dir gains a merged tree: Mnemosphere at root, canopy's admin SPA (hash-routed, rebased `base:/admin/`) under `/admin`. Non-file paths still fall through to the Hono API.

**Tech Stack:** Vite (both builds), Cloudflare Workers + assets binding, wrangler.

## Global Constraints

- Canopy's Worker fetch handler, gate (`consumer.ts`), and auth model are NOT modified.
- Canopy's admin SPA is hash-routed — only its `base` and hard-coded `/` landing targets change.
- Developer-mode reads: blank stored URL → relative (same-origin); a set URL → that origin (local split-dev). A token is always required.
- Both suites stay green: root `npx vitest run`, `cd canopy && npm test`. Both builds succeed.

---

### Task 1: Rebase canopy's admin UI to `/admin/`

**Files:**
- Modify: `canopy/web/vite.config.ts` (add `base`, nest `outDir`)
- Modify: `canopy/web/src/main.ts:529` (`"/"` → `"/admin/"`)
- Modify: `canopy/src/auth/routes.ts:60,69` (`"/…"` → `"/admin/…"`)

- [ ] **Step 1:** `canopy/web/vite.config.ts` — `base: "/admin/"`, `build.outDir: path.join(__dirname, "dist", "admin")`, keep `emptyOutDir: true`.
- [ ] **Step 2:** `canopy/web/src/main.ts:529` — `history.replaceState({}, "", "/admin/")`.
- [ ] **Step 3:** `canopy/src/auth/routes.ts` — line 60 `c.redirect("/admin/?denied=1", 302)`; line 69 `c.redirect("/admin/", 302)`.
- [ ] **Step 4:** Build canopy web: `cd canopy && npx vite build --config web/vite.config.ts`. Verify `canopy/web/dist/admin/index.html` exists and its asset `<script>`/`<link>` refs start with `/admin/assets/`.
- [ ] **Step 5:** `cd canopy && npm test` — confirm the 441 Worker tests stay green (asset serving isn't in the test pool, so the rebase is inert to them; the routes.ts redirect strings have no test asserting `"/"`).
- [ ] **Step 6:** Commit.

### Task 2: Developer mode reads same-origin

**Files:**
- Modify: `src/dev/canopy-api.js` (`isConfigured`, `get`)
- Test: `tests/canopy-api.test.js` (add same-origin case)

- [ ] **Step 1 (test first):** In `tests/canopy-api.test.js` add:
  ```js
  test('blank url + token reads same-origin (relative path) and is configured', async () => {
    store.setDevConfig({ url: '', token: 'canopy_mcp_z' });
    expect(isConfigured()).toBe(true);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 }));
    await makeCanopyApi(fetchImpl).getDocs();
    expect(fetchImpl.mock.calls[0][0]).toBe('/docs');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer canopy_mcp_z');
  });
  ```
- [ ] **Step 2:** Run it — fails (currently `isConfigured` needs url; `get` guards on `!url`).
- [ ] **Step 3:** `canopy-api.js` — `isConfigured()`: `const { token } = getDevConfig(); return !!token;`. `get()`: guard `if (!token) return { ok:false, status:0, error:'not-configured' }`; `const base = (url || '').replace(/\/$/, '');`.
- [ ] **Step 4:** Run `npx vitest run tests/canopy-api.test.js` — all pass (incl. existing `''+''→false`).
- [ ] **Step 5:** Commit.

### Task 3: Merged build script + wiring

**Files:**
- Create: `canopy/scripts/build-app.mjs`
- Modify: `canopy/package.json` (`build:app`, point `dev`/`deploy` at it)

- [ ] **Step 1:** `canopy/scripts/build-app.mjs`:
  ```js
  import { execSync } from 'node:child_process';
  import { rmSync, cpSync } from 'node:fs';
  import path from 'node:path';
  const canopy = path.resolve(import.meta.dirname, '..');
  const repo = path.resolve(canopy, '..');
  const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
  run('npm run build', repo);                                   // Mnemosphere → repo/dist
  rmSync(path.join(canopy, 'web/dist'), { recursive: true, force: true });
  run('npx vite build --config web/vite.config.ts', canopy);   // canopy admin → web/dist/admin
  cpSync(path.join(repo, 'dist'), path.join(canopy, 'web/dist'), { recursive: true });  // UI → web/dist root (admin/ preserved)
  console.log('build:app complete — web/dist (Mnemosphere) + web/dist/admin (canopy)');
  ```
- [ ] **Step 2:** `canopy/package.json` scripts: add `"build:app": "node scripts/build-app.mjs"`; `"dev": "npm run build:app && wrangler dev"`; `"deploy": "npm run build:app && wrangler deploy"`. Keep `build:web` for standalone canopy builds.
- [ ] **Step 3:** `cd canopy && npm run build:app`. Verify both `web/dist/index.html` (Mnemosphere) and `web/dist/admin/index.html` (canopy) exist.
- [ ] **Step 4:** Commit.

### Task 4: Local end-to-end verify + SETUP docs

**Files:**
- Modify: `canopy/SETUP.md` (fused topology + `/admin`, same-origin token, Supabase redirect note)
- Modify: `src/ui/settings.js` (URL field hint: "blank = this site")

- [ ] **Step 1:** `cd canopy && npm run dev` (wrangler dev on the merged tree). In the browser: `/` renders Mnemosphere; `/admin` renders canopy; Developer mode with a blank URL + a local token reads same-origin.
- [ ] **Step 2:** Add a hint under the Developer-settings URL input: leave blank to use the current site.
- [ ] **Step 3:** Update `canopy/SETUP.md` to the one-Worker topology (UI at `/`, admin at `/admin`, mint token there, paste with blank URL; add the Worker origin to Supabase redirect URLs + the GitHub OAuth callback `/auth/callback`).
- [ ] **Step 4:** Full gates: root `npx vitest run`; `cd canopy && npm test`; `cd canopy && npm run build:app`. Commit.

### Deploy (with the user, after Task 4)

`wrangler login` → `db:create` (paste id) → GitHub OAuth app → set vars/secrets → `db:migrate:remote` → `deploy` → add Worker origin to Supabase/Google + GitHub callback → open `/admin`, mint token → paste into Developer settings (blank URL).
