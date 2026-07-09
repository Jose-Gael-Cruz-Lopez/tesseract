# Canopy Sub-project C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`. Build order matters: **Phase 1 (canopy bridge)** unblocks the cross-origin reads; **Phase 2** adds isolated Mnemosphere modules (parallel-safe); **Phase 3** does the globe refactor + wiring (sequential, integration).

**Goal:** A read-only developer mode in Mnemosphere — a second globe (core = repo; hubs = Docs·Roadmap·Feed·Triage·My Work; dots = items) fed live from canopy over a CORS+bearer bridge, with a sidebar workspace switcher between Knowledge and Developer modes.

**Architecture:** Canopy gains CORS + bearer-authorized reads (Half 1). Mnemosphere gains a `mode` state, a `canopy-api` read client, a `dev-graph` mapper, a globe **provider** abstraction (knowledge = store, developer = canopy), a read-only dev-page viewer, a dev sidebar, and a Developer settings panel (Half 2).

**Tech Stack:** canopy (TS/Hono/Cloudflare/vitest-pool-workers); Mnemosphere (vanilla JS/Vite/three.js/vitest+happy-dom).

## Global Constraints

- **Read-only:** the dev sphere issues only `GET`s. CORS allows only `GET,OPTIONS` cross-origin.
- **Knowledge path unchanged:** the globe provider refactor must keep the store-driven knowledge globe behaviorally identical — its **406 Mnemosphere tests stay green** as the guardrail.
- **Isolated builds stay isolated:** canopy changes run under `cd canopy && npm test`; Mnemosphere under root `npm test` (already scoped to `tests/`).
- **Prefs namespace `ms:`** for all Mnemosphere state (`mode`, `dev.canopyUrl`, `dev.canopyToken`). Colors via tokens; class prefix `dev-`.
- **Canopy read contract (verbatim shapes):** `GET /docs`→`{docs:DocRow[]}` (`DocRow{slug,section,title}`); `GET /doc/:slug`→the doc; `GET /feed`→`{feed:FeedRow[]}` (`FeedRow{summary,...}`); `GET /needs-triage`→`{items:[]}`; `GET /roadmap`→`{narrative, milestones:(MilestoneRow&{progress:{closed,total}|null})[]}`; `GET /me/dashboard`→`{person, previousActivity:MyWorkPr[], todo:MyWorkTodo[], degraded}`; `GET /auth/me`→`{login,name,avatar_url,org,admin}`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Phase 1 — Canopy auth bridge

### Task 1: CORS middleware + `CORS_ORIGINS`

**Files:** Create `canopy/src/cors.ts`, `canopy/test/cors.test.ts`; Modify `canopy/src/env.ts`, `canopy/src/index.ts`.

**Interfaces — Produces:** `corsHeaders(origin: string|null, env: Env): Record<string,string>` (empty object if origin not allowed) and `handlePreflight(request: Request, env: Env): Response|null` (a 204 with CORS headers for an allowed `OPTIONS`, else null). The Worker applies `corsHeaders` to every response and short-circuits `OPTIONS`.

- [ ] **Step 1 (failing test)** `canopy/test/cors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { corsHeaders, handlePreflight } from "../src/cors";
const env = (o: string) => ({ CORS_ORIGINS: o } as any);
describe("cors", () => {
  it("allows a listed origin (echoes it, GET+OPTIONS only)", () => {
    const h = corsHeaders("http://localhost:5173", env("http://localhost:5173,https://app"));
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(h["Access-Control-Allow-Methods"]).toBe("GET,OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
  });
  it("gives nothing to an unlisted origin", () => {
    expect(corsHeaders("http://evil", env("http://localhost:5173"))).toEqual({});
  });
  it("preflight: 204 for an allowed OPTIONS, null otherwise", () => {
    const req = new Request("https://c/docs", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
    const res = handlePreflight(req, env("http://localhost:5173"));
    expect(res?.status).toBe(204);
    expect(handlePreflight(new Request("https://c/docs"), env("http://localhost:5173"))).toBeNull();
  });
});
```
- [ ] **Step 2** run → FAIL (`npx vitest run test/cors.test.ts`).
- [ ] **Step 3** `canopy/src/cors.ts`:
```ts
import type { Env } from "./env";
function allowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
}
export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!allowed(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
export function handlePreflight(request: Request, env: Env): Response | null {
  if (request.method !== "OPTIONS") return null;
  const h = corsHeaders(request.headers.get("origin"), env);
  if (!h["Access-Control-Allow-Origin"]) return null;
  return new Response(null, { status: 204, headers: h });
}
```
- [ ] **Step 4** `env.ts`: add `CORS_ORIGINS?: string;  // comma-separated origins allowed cross-origin (GET only) — e.g. the Mnemosphere dev sphere`.
- [ ] **Step 5** `index.ts`: at the top of `fetch`, `const pre = handlePreflight(request, env); if (pre) return pre;`. Wrap the final response so `corsHeaders(request.headers.get("origin"), env)` is merged onto it (a small helper that clones the Response adding headers). Apply to the Hono-app branch responses (the read routes). Do NOT add CORS to `/mcp` or `/webhook/github`.
- [ ] **Step 6** run `npx vitest run test/cors.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 7** commit `feat(canopy): CORS middleware (GET-only) gated by CORS_ORIGINS`.

### Task 2: Bearer-authorized reads (sessionGate fallback)

**Files:** Modify `canopy/src/auth/principal.ts` (sessionGate); Create `canopy/test/auth-bearer-read.test.ts`.

**Interfaces — Consumes:** existing `resolveBearerPrincipal(request, env)` and `resolveSessionPrincipal(c)`. **Produces:** `sessionGate` that resolves principal from cookie → `DEV_LOGIN` → **bearer** → else 401.

- [ ] **Step 1 (failing test)** `canopy/test/auth-bearer-read.test.ts`: mint a token (`mintToken(env.DB, "Jose-Gael-Cruz-Lopez")`), `GET /docs` with `Authorization: Bearer <raw>` → 200 `{docs:[...]}`; with a bad bearer → 401; with none → 401. (Follow `test/auth-me.test.ts`'s `app.request(path, {headers}, env)` pattern; seed a doc via the migrations/seed helper or assert the empty `{docs:[]}` shape at 200.)
- [ ] **Step 2** run → FAIL (bearer not accepted on `/docs` yet).
- [ ] **Step 3** in `sessionGate`, after the `DEV_LOGIN` branch and before the session resolve, keep the session attempt but add a bearer fallback:
```ts
  const principal = await resolveSessionPrincipal(c) ?? await resolveBearerPrincipal(c.req.raw, c.env);
  if (!principal) return c.json({ error: "unauthorized" }, 401);
  c.set("principal", principal);
  return next();
```
(import `resolveBearerPrincipal` — already in the file's module.)
- [ ] **Step 4** run the new test + `npm test` (full) → all green (435 + new). typecheck.
- [ ] **Step 5** commit `feat(canopy): accept a bearer token on the session-gated read routes`.

### Task 3: Document the bridge in SETUP.md

**Files:** Modify `canopy/SETUP.md`.

- [ ] Add a "Connect the Mnemosphere dev sphere" section: set `CORS_ORIGINS="http://localhost:5173"` (dev) / your prod origin in `wrangler.toml [vars]`; mint a token (`POST /auth/mcp-token` — sign in, then the Settings screen's "Generate token", shown once); paste the canopy URL + token into Mnemosphere → Developer settings. Commit `docs(canopy): document the dev-sphere CORS+token bridge`.

---

## Phase 2 — Mnemosphere isolated modules

### Task 4: Prefs — mode + dev connection

**Files:** Modify `src/data/store.js`; Test `tests/store.test.js` (extend).

**Interfaces — Produces:** `getMode(): 'knowledge'|'developer'` (default `'knowledge'`), `setMode(m)`, `getDevConfig(): {url, token}` (from `ms:prefs` `dev.canopyUrl`/`dev.canopyToken`), `setDevConfig({url, token})`. Built on the existing `getPrefs`/`setPref`.

- [ ] TDD: test mode round-trips + defaults `knowledge`; devConfig round-trips. Implement thin wrappers over `setPref`/`getPrefs`. Run root `npx vitest run tests/store.test.js`. Commit `feat: prefs for dev mode + canopy connection`.

### Task 5: `canopy-api.js` — read client

**Files:** Create `src/dev/canopy-api.js`, `tests/canopy-api.test.js`.

**Interfaces — Produces:** `isConfigured()`, and async `getMe/getDocs/getDoc(slug)/getFeed/getRoadmap/getDashboard/getTriage/search(q)`. Each returns `{ ok:true, data }` or `{ ok:false, status, error }` (never throws on HTTP status). Reads `{url,token}` from `getDevConfig()`. Uses injectable `fetchImpl` (default global `fetch`) for tests.

- [ ] TDD (`tests/canopy-api.test.js`, mocked fetch): `getDocs()` GETs `<url>/docs` with `Authorization: Bearer <token>` and returns `{ok:true,data:{docs:[…]}}`; a 401 returns `{ok:false,status:401}`; a network throw returns `{ok:false,status:0,error:'network'}`; `isConfigured()` false when url/token missing. Implement. Run. Commit `feat: canopy-api read client`.

### Task 6: `dev-graph.js` — canopy DTOs → globe graph

**Files:** Create `src/dev/dev-graph.js`, `tests/dev-graph.test.js`.

**Interfaces — Consumes:** the five DTOs (Global Constraints shapes). **Produces:** `buildDevGraph({docs, roadmap, feed, triage, dashboard}) : { hubs: [{ page, dir:[x,y,z], dist, scale, accent, leaves:[{page, parentIdx}] }] }` — the SAME shape `src/globe/globe.js`'s `buildGraphFromPages` returns, so the globe renders it unchanged. Five hubs (Docs/Roadmap/Feed/Triage/My Work); each leaf `page = { id, title, icon, devKind, devRef }` (`devKind`∈`doc|milestone|feed|triage|pr|todo`; `devRef` = slug/number for the viewer). Reuse the seeded fibonacci placement (extract a shared helper from globe-data or duplicate the small math).

- [ ] TDD (`tests/dev-graph.test.js`, node env): feed DTO fixtures → exactly 5 hubs with titles Docs/Roadmap/Feed/Triage/My Work; Docs hub leaf count == docs.length; a milestone leaf carries `devKind:'milestone'`; My Work hub == previousActivity.length + todo.length; deterministic (same input ⇒ same dirs). Implement. Run. Commit `feat: dev-graph maps canopy data onto the globe`.

---

## Phase 3 — Globe provider + wiring + viewer

### Task 7: Globe provider injection (knowledge path unchanged)

**Files:** Modify `src/globe/globe.js`; Test: existing `tests/globe-data.test.js` + `npx vitest run` (406 guardrail).

**Interfaces — Produces:** `initGlobe(container, hooks, provider)` where `provider = { getGraph(): Graph|Promise<Graph>, subscribe(cb): ()=>void }`. Default (when `provider` omitted) = the current store provider, so nothing else changes. Internally: replace the direct `buildGraphFromPages(getPages())` + `onStore('pages')` calls with `provider.getGraph()` (await if a promise; show a `.gl-loading` state until it resolves) + `provider.subscribe(rebuild)`. Export a `storeProvider()` factory (wraps `getPages`/`buildGraphFromPages`/`onStore`).

- [ ] TDD: `buildGraphFromPages` stays exported + unchanged (its tests pass). Add a test that `initGlobe` with a stub provider (`getGraph` → a 1-hub fixture; `subscribe` → noop) builds without touching the store. Refactor carefully; run `npx vitest run` → **406 still green**; `npm run build`. Commit `refactor: globe takes an injectable graph provider (knowledge path unchanged)`.

### Task 8: Developer provider + dev-page viewer + dev sidebar

**Files:** Create `src/dev/dev-provider.js`, `src/dev/dev-page.js`, `src/dev/dev-sidebar.js`, `src/styles/dev.css`, `tests/dev-mode.test.js`.

**Interfaces:** `devProvider()` → `{ getGraph }` (calls `canopy-api` for the five reads in parallel via `Promise.all`, filters `ok`, feeds `buildDevGraph`; `subscribe` = noop + a `refresh()`). `mountDevPage(container, node, ctx)` renders a canopy item read-only (doc markdown → sanitized HTML; feed/milestone/triage → structured read-only view; top bar: title + "Open in canopy"). `mountDevSidebar(container, ctx)` → the five categories + item rows (from the same reads), row click → `ctx.openDevItem(node)`. Markdown: add `marked` + `dompurify` (dev-only; both are canopy deps already) OR a minimal renderer — pick in-step; sanitize always.

- [ ] TDD (`tests/dev-mode.test.js`, happy-dom, mocked canopy-api): `devProvider().getGraph()` with fixture responses → 5 hubs; `mountDevPage` with a doc fixture renders the title + sanitized body (a `<script>` in the body is stripped); dev sidebar lists the 5 categories. Implement + `dev.css`. Run root suite. Commit `feat: developer provider, read-only dev page, dev sidebar`.

### Task 9: Mode switch + Developer settings + app wiring

**Files:** Modify `src/app.js`, `src/ui/sidebar.js`, `src/ui/settings.js`; Test `tests/dev-mode.test.js` (extend), `tests/settings.test.js` (extend).

- [ ] **Sidebar workspace menu:** the header popover gains a "Switch mode" group (Knowledge / Developer, active checked) → `ctx.setMode(m)`. TDD: menu shows both, selecting persists via `setMode` + calls a `ctx.onModeChange`.
- [ ] **Developer settings panel** (`settings.js`): a "Developer" nav item → Canopy URL + Access token fields (persist via `setDevConfig`) + "Test connection" (`canopy-api.getMe()` → ok/unauthorized/unreachable). TDD: fields persist; test-connection reflects a mocked result.
- [ ] **app.js mode branch:** build `ctx.setMode`, `ctx.openDevItem`; on Developer mode mount the `devProvider()` into `initGlobe`, mount `mountDevSidebar` instead of the knowledge sidebar, route node/sidebar clicks → `mountDevPage`; if `!isConfigured()` show the connect prompt (open Developer settings). Knowledge mode = today's wiring. Switching modes re-mounts the shell.
- [ ] Run root suite (still 406 + new dev tests) + `npm run build`. Commit `feat: wire developer mode — switch, settings, dev globe + sidebar + pages`.

### Task 10: Live end-to-end verification

- [ ] Start canopy local (`cd canopy`, `.dev.vars` with `DEV_LOGIN` + `CORS_ORIGINS=http://localhost:5173`, `npm run seed`, `npm run dev` on :8787). Mint a token: with a session (or DEV_LOGIN) `curl -XPOST localhost:8787/auth/mcp-token` (capture the raw token).
- [ ] Start Mnemosphere (`npm run dev` :5173). In the browser: Developer settings → paste `http://localhost:8787` + token → Test connection ok. Switch to Developer mode → the dev globe renders the seeded canopy categories; click a Docs node → the doc renders read-only; sidebar shows the 5 categories. Switch back to Knowledge → the notes globe is intact. Screenshot both. Fix any gaps.
- [ ] Final: `cd canopy && npm test` (green) + root `npx vitest run` (406 + dev tests green) + `npm run build`. Confirm no secrets tracked (`git status`).

---

## Self-review notes
- Spec coverage: bridge CORS (T1) + bearer reads (T2) + docs (T3); prefs (T4); canopy-api (T5); dev-graph (T6); provider refactor (T7); dev provider/page/sidebar (T8); switch+settings+wiring (T9); live verify (T10). Read-only enforced by CORS `GET,OPTIONS` (T1). Knowledge-path guardrail (406) asserted in T7/T9/T10.
- Interfaces named once: `provider={getGraph,subscribe}`, `buildDevGraph({docs,roadmap,feed,triage,dashboard})`, `canopy-api` result `{ok,status,data|error}`, node `page={id,title,icon,devKind,devRef}` — consistent across tasks.
- Out of scope: multi-repo (B), write-back, identity merge.
