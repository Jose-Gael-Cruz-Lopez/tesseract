# Phase 3 Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the already-built Phase 3 *engine* (App JWT, installation/user tokens, `authorizeRepo`, connect webhooks, `repoGate`) into a live multi-tenant product — every connected repo becomes an isolated hub under `/r/:owner/:repo/*`, access mirrors GitHub collaborators, and login moves from the single-org OAuth App to the GitHub App's user-authorization flow.

**Architecture:** Additive-then-flip (spec Section 4). **Phase A** builds everything that does NOT need the live GitHub App — the `/r/:owner/:repo/*` hub router (with `repoGate`), the repo-ownership guards, the connect-repos endpoint, and the web hub-list/switcher UI — all deployed **dormant** alongside the working flat routes and OAuth login. **Phase B** (blocked on the user creating the App + setting 5 secrets) flips login to the App flow, retires `GITHUB_SERVICE_TOKEN` for per-installation tokens, and points the UI at hubs, verifying e2e against a real install before removing the old paths.

**Tech Stack:** Cloudflare Worker (TypeScript, Hono), D1 (SQLite), Vitest + Miniflare (`@cloudflare/vitest-pool-workers`, `cloudflare:test`), framework-less Vite SPA for `web/` (served at `/admin/`).

## Global Constraints

- **FINAL PRODUCT, not an MVP** — no stubs, no "coming soon" for shipped surfaces.
- **ONE GitHub App** does sign-in + install + webhooks + tokens; retires the OAuth App (`GITHUB_CLIENT_ID`/`_SECRET`) and `GITHUB_SERVICE_TOKEN`.
- **Access = repo collaborators**, read GitHub-native via `accessibleRepos(userToken)` (`/user/installations` → `/user/installations/:id/repositories`). Never an ad-hoc `/repos/:o/:r` probe.
- **Path-prefixed `/r/:owner/:repo/…` routes** behind one `repoGate` middleware (after `sessionGate`). Handlers read `c.get("repo")` where they call `defaultRepo(c.env)` today.
- **Push access ⇒ admin** — any write in the "authored/promote class" (plan writes, doc/milestone/adr promote & reject, triage assign/discard, milestone complete, identity map, backfill) requires `c.get("canPush") === true`.
- **Isolation:** every mutation mounted under `/r/` must operate only on rows whose `repo` equals `repoOf(c)` — repo-capable functions get `repoOf(c)`; id-keyed functions get a repo-ownership guard (load the row, 404 if its `repo` ≠ `repoOf(c)`).
- **Denials never leak existence** — an unconnected repo, or one the user can't reach, is the same `404 {"error":"not found"}`. Missing user token is `401 {"error":"reauthorize"}`.
- **Soft-disconnect only** — uninstall/removal flips `repos.status`; never a hard delete.
- **Additive-then-flip** — every step reversible; `memo-sphere.com` never has a broken window. Deploy order: build dormant → user sets secrets → verify e2e with a real install → flip UI + remove old paths.
- **Preserve the client contract** (the Mnemosphere app needs NO changes): keep `/auth/login?return=…` as the login entry redirect and `GET /auth/me` returning `{ login, name, avatar_url, org, admin }` from the session cookie; keep the `?denied=1` return contract available.
- **Web SPA:** served at `/admin/` (`web/vite.config.ts` `base:"/admin/"`); all API calls go through `web/src/api.ts` with `credentials:"same-origin"`; there is no web unit-test harness — UI tasks verify via `npm run build:web` + `npm run typecheck` + a documented manual check.
- **Tests:** Vitest against real Miniflare D1. GitHub I/O is dependency-injected (`fetchImpl`, and `repoGate`'s `getUserToken`/`authorize`/`listRepos`) — never hit the network. New tables (`installations`, `repo_access`, `user_tokens`) are already truncated `beforeEach` in `test/apply-migrations.ts` (verify).
- **Run after every task:** `cd canopy && npm test && npm run typecheck` — both must be green.

## New env var (non-secret)

- `GITHUB_APP_SLUG` — the App's URL slug; the "Connect repos" button links to `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`. Add to `[vars]` in `wrangler.toml` once the App is named. Optional in `Env` (absent → the connect button falls back to `https://github.com/settings/installations`).

---

## File Structure

**Create:**
- `canopy/src/hub.ts` — the `/r/:owner/:repo/*` hub router: a `Hono<AppEnv>` sub-app that mounts `repoGate` (built per-request from `c.env`) and re-exposes the repo-scoped read/write endpoints, each scoped to `repoOf(c)`, with push-gating + repo-ownership guards on mutations. Owns the multi-tenant request surface.
- `canopy/src/tools/repo-ownership.ts` — tiny helpers: `docRepo`, `adrRepo`, `milestoneRepo`, `milestoneProposalRepo`, `triageRepo` — each loads a row's `repo` by id/slug (returns `null` if absent) so hub mutations can 404 cross-repo ids.
- `canopy/src/auth/app-login.ts` — the GitHub App user-authorization sign-in: `buildAppAuthorizeUrl`, and the callback handler logic (`exchangeUserCode` → `getUser` → `storeUserToken` → session). Keeps `auth/github.ts` (old OAuth) untouched until the flip.
- `canopy/src/tools/connected.ts` — `listAccessibleConnectedRepos(db, env, login, opts?)`: the user's `accessibleRepos` ∩ connected `repos`, for the hub-list endpoint.
- `canopy/migrations/0026_grandfather_connected.sql` — defensive: ensure any pre-existing `repos` row is `status='connected'` (idempotent; the `0024` default already covers new rows).
- Tests: `canopy/test/hub-routes.test.ts`, `canopy/test/repo-ownership.test.ts`, `canopy/test/app-login.test.ts`, `canopy/test/connected-repos.test.ts`, `canopy/test/service-token-retire.test.ts`.

**Modify:**
- `canopy/src/auth/principal.ts:11` — extend `AppEnv["Variables"]` with `repo?: string; canPush?: boolean`.
- `canopy/src/routes.ts` — mount the hub router (`app.route("/r/:owner/:repo", hubApp)`); (Phase B) flip `/auth/login` handler wiring; keep flat routes through Phase A.
- `canopy/src/auth/routes.ts` — (Phase B additive) add `/auth/app/login` + `/auth/app/callback`; (flip) point `/auth/login`+`/auth/callback` at the App flow.
- `canopy/src/auth/principal.ts:35` — (Phase B) add `/auth/app/login`, `/auth/app/callback` to `PUBLIC_PATHS`.
- `canopy/src/env.ts` — add optional `GITHUB_APP_SLUG?: string`.
- `canopy/src/db.ts` — `bootstrapRepo`: on the seeded registry row, set `status='connected'` defensively (grandfather).
- `canopy/src/tools/progress.ts` + `canopy/src/tools/backfill.ts` + `canopy/src/index.ts` — (Phase B) resolve `repo → installation_id → installationToken` per connected repo, retiring `GITHUB_SERVICE_TOKEN`.
- `canopy/web/src/api.ts` — repo-prefix helper + `getMyRepos()`; thread an active-repo into path building.
- `canopy/web/src/render.ts` + `canopy/web/src/main.ts` — a `hubs` screen (list + empty state), a header repo-switcher, active-repo in `AppState`, repo-scoped loaders.
- `canopy/wrangler.toml` — add `GITHUB_APP_SLUG` to `[vars]` (after the App is named).

---

# PHASE A — App-independent (build + deploy dormant)

Everything here compiles, tests green with mocked GitHub, and is safe to deploy while the flat routes + OAuth login keep serving. Nothing here changes live behavior.

## Task 1: Context types + hub router skeleton (repoGate mounted, roadmap route)

**Files:**
- Modify: `canopy/src/auth/principal.ts:11`
- Create: `canopy/src/hub.ts`
- Modify: `canopy/src/routes.ts` (import + mount)
- Test: `canopy/test/hub-routes.test.ts`

**Interfaces:**
- Consumes: `makeRepoGate(deps)` (`src/auth/repo-gate.ts`), `repoOf(c)`, `getUserToken(db, env, login)` (`src/auth/user-token.ts`), `authorizeRepo` (`src/auth/access.ts`), `accessibleRepos` (`src/auth/app.ts`), `get_plan(db, repo)` (`src/tools/plan.ts`), `defaultRepo`, `nowIso` (`src/db.ts`).
- Produces: `hubApp: Hono<AppEnv>` (default export of `src/hub.ts`), mounted at `/r/:owner/:repo`. Each hub route reads `repoOf(c)`. A per-request middleware builds `repoGate` from `c.env` so `authorize`/`listRepos` default to the real wiring but are overridable in tests via `c.env`-independent injection (tests seed `repo_access` + a connected repo and inject `getUserToken`/`listRepos` through a test-only hook — see below).

**Testability hook:** `repoGate`'s `getUserToken`/`authorize`/`listRepos` are injected. Since the middleware is built per-request from `c.env`, expose the injection through a module-level override the test can set:

```ts
// src/hub.ts (excerpt)
import { Hono } from "hono";
import type { AppEnv } from "./auth/principal";
import { makeRepoGate, repoOf } from "./auth/repo-gate";
import { getUserToken } from "./auth/user-token";
import { get_plan } from "./tools/plan";

// Test seam: when set, these override the live wiring the gate builds from c.env.
// Production leaves them undefined → the gate uses getUserToken + the real
// authorizeRepo/accessibleRepos. Tests set them to avoid real GitHub + token storage.
export const _hubTestHooks: {
  getUserToken?: (login: string) => Promise<string | null>;
  listRepos?: import("./auth/app").AccessibleRepo[] | ((token: string) => Promise<import("./auth/app").AccessibleRepo[]>);
} = {};

export function _resetHubTestHooks(): void {
  _hubTestHooks.getUserToken = undefined;
  _hubTestHooks.listRepos = undefined;
}

const hubApp = new Hono<AppEnv>();

// Build repoGate per-request (Workers env is per-request). Test hooks override the
// live token store + access set; production uses the real getUserToken + accessibleRepos.
hubApp.use("*", async (c, next) => {
  const listRepos = _hubTestHooks.listRepos;
  const gate = makeRepoGate({
    db: c.env.DB,
    env: c.env,
    getUserToken: _hubTestHooks.getUserToken ?? ((login: string) => getUserToken(c.env.DB, c.env, login)),
    ...(listRepos
      ? { listRepos: typeof listRepos === "function" ? listRepos : async () => listRepos }
      : {}),
  });
  return gate(c, next);
});

// Roadmap read, scoped to the gated repo.
hubApp.get("/roadmap", async (c) => c.json(await get_plan(c.env.DB, repoOf(c))));

export default hubApp;
```

- [ ] **Step 1: Extend the context variables**

In `canopy/src/auth/principal.ts:11`, change:
```ts
export type AppEnv = { Bindings: Env; Variables: { principal: Principal } };
```
to:
```ts
export type AppEnv = { Bindings: Env; Variables: { principal: Principal; repo?: string; canPush?: boolean } };
```

- [ ] **Step 2: Write the failing test**

Create `canopy/test/hub-routes.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { run, nowIso } from "../src/db";
import { write_plan } from "../src/tools/plan";

const REPO = "octo/hub";
// DEV_LOGIN in test env makes sessionGate resolve this principal (see test wrangler vars).
const LOGIN = env.DEV_LOGIN as string;

async function connect(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), LOGIN, 1);
}

beforeEach(() => { _resetHubTestHooks(); });
afterEach(() => { _resetHubTestHooks(); });

describe("hub roadmap route", () => {
  it("serves the repo-scoped plan when connected + collaborator", async () => {
    await connect(REPO);
    await write_plan(env.DB, { narrative: "octo hub plan", milestones: [] }, LOGIN, REPO);
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];

    const res = await app.request(`/r/octo/hub/roadmap`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { narrative: string };
    expect(body.narrative).toBe("octo hub plan");
  });

  it("404s an unconnected repo (no existence leak)", async () => {
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(`/r/octo/hub/roadmap`, {}, env);
    expect(res.status).toBe(404);
  });

  it("401s when the user has no stored token", async () => {
    await connect(REPO);
    _hubTestHooks.getUserToken = async () => null;
    const res = await app.request(`/r/octo/hub/roadmap`, {}, env);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd canopy && npx vitest run test/hub-routes.test.ts`
Expected: FAIL — `src/hub` has no export / route not mounted (404 or import error).

- [ ] **Step 4: Create the hub router**

Create `canopy/src/hub.ts` with the excerpt above (test hooks + per-request gate + `/roadmap`).

- [ ] **Step 5: Mount it in routes.ts**

In `canopy/src/routes.ts`, after the existing imports add:
```ts
import hubApp from "./hub";
```
and after the `/github/app/callback` route (around line 39), add:
```ts
// Multi-tenant hub routes (Phase 3): /r/:owner/:repo/* behind repoGate. Coexists with
// the flat defaultRepo routes below until the UI cutover.
app.route("/r/:owner/:repo", hubApp);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd canopy && npx vitest run test/hub-routes.test.ts && npm run typecheck`
Expected: PASS (3/3), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add canopy/src/hub.ts canopy/src/routes.ts canopy/src/auth/principal.ts canopy/test/hub-routes.test.ts
git commit -m "Phase 3: mount repoGate on /r/:owner/:repo hub router (roadmap)"
```

## Task 2: Hub read routes (feed, docs, doc, search, triage, adrs, proposals, milestone-proposals, dashboard)

**Files:**
- Modify: `canopy/src/hub.ts`
- Test: `canopy/test/hub-routes.test.ts` (add an isolation case)

**Interfaces:**
- Consumes: `get_feed(db, filter, repo)`, `list_docs(db, section, repo)`, `get_doc(db, slug, repo?)`, `query(db, req, repo)`, `list_needs_triage(db, repo)`, `list_adrs(db, status, repo)`, `list_proposals(db, repo)`, `list_milestone_proposals(db, repo)`, `getMyWork(db, login, repo)` — all already accept an optional `repo`.
- Produces: hub GET routes mirroring the flat routes in `src/routes.ts`, each passing `repoOf(c)`.

> **Note on `get_doc`:** verify its signature at `src/tools/reads.ts:9`. If it accepts `(db, slug, repo?)`, pass `repoOf(c)`. If not, the hub still 404s cross-repo docs because the doc reader is reached from the repo-scoped `list_docs`; pass `repoOf(c)` only if the parameter exists (do NOT invent one).

- [ ] **Step 1: Write the failing isolation test**

Add to `canopy/test/hub-routes.test.ts`:
```ts
import { get_feed } from "../src/tools/reads";
// helper to append a feed row for a repo via the writer path used elsewhere in tests
// (reuse the project's existing feed seed helper if present; otherwise append_feed).

it("feed is isolated to the gated repo", async () => {
  await connect("octo/hub");
  await connect("octo/other");
  // seed one feed entry in each repo (use the same helper other feed tests use)
  await run(env.DB, `INSERT INTO feed (author, kind, body, created_at, repo) VALUES (?, 'note', ?, ?, ?)`, LOGIN, "hub-only", nowIso(), "octo/hub");
  await run(env.DB, `INSERT INTO feed (author, kind, body, created_at, repo) VALUES (?, 'note', ?, ?, ?)`, LOGIN, "other-only", nowIso(), "octo/other");
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }, { repo: "octo/other", can_push: true }];

  const res = await app.request(`/r/octo/hub/feed`, {}, env);
  const { feed } = await res.json() as { feed: Array<{ body: string }> };
  expect(feed.some((f) => f.body === "hub-only")).toBe(true);
  expect(feed.some((f) => f.body === "other-only")).toBe(false);
});
```
> Before writing, open `canopy/test/` and match the EXACT `feed` insert columns used by existing feed tests (kind/body/tags vary by schema) — copy their shape rather than the illustrative columns above.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd canopy && npx vitest run test/hub-routes.test.ts -t "feed is isolated"`
Expected: FAIL — `/r/octo/hub/feed` is 404 (route not defined).

- [ ] **Step 3: Add the read routes to `src/hub.ts`**

After the `/roadmap` route, add (import the read fns at the top):
```ts
import { get_doc, list_docs, get_feed, query, list_needs_triage, list_adrs, list_proposals, list_milestone_proposals } from "./tools/reads";
import { getMyWork } from "./tools/mywork";
import type { DashboardData } from "@shared/dashboard";

hubApp.get("/feed", async (c) => {
  const tags = c.req.query("tags");
  const limit = c.req.query("limit");
  const feed = await get_feed(c.env.DB, {
    author: c.req.query("author"),
    tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    since: c.req.query("since"),
    limit: limit ? Number(limit) : undefined,
  }, repoOf(c));
  return c.json({ feed });
});

hubApp.get("/docs", async (c) => c.json({ docs: await list_docs(c.env.DB, c.req.query("section"), repoOf(c)) }));

hubApp.get("/doc/:slug", async (c) => {
  const found = await get_doc(c.env.DB, c.req.param("slug"), repoOf(c));
  if (!found) return c.json({ error: "not found" }, 404);
  return c.json(found);
});

hubApp.get("/search", async (c) => {
  const typesCsv = c.req.query("types");
  const types = typesCsv
    ? typesCsv.split(",").map((t) => t.trim()).filter((t): t is "doc" | "decision" | "feed" | "milestone" =>
        t === "doc" || t === "decision" || t === "feed" || t === "milestone")
    : undefined;
  const limit = c.req.query("limit");
  const result = await query(c.env.DB, {
    q: c.req.query("q") ?? "",
    types: types && types.length ? types : undefined,
    section: c.req.query("section"),
    include_staged: false,
    limit: limit ? Number(limit) : undefined,
  }, repoOf(c));
  return c.json({ result });
});

hubApp.get("/needs-triage", async (c) => c.json({ items: await list_needs_triage(c.env.DB, repoOf(c)) }));
hubApp.get("/adrs", async (c) => c.json({ adrs: await list_adrs(c.env.DB, c.req.query("status"), repoOf(c)) }));
hubApp.get("/proposals", async (c) => c.json({ proposals: await list_proposals(c.env.DB, repoOf(c)) }));
hubApp.get("/milestone-proposals", async (c) => c.json({ proposals: await list_milestone_proposals(c.env.DB, repoOf(c)) }));

hubApp.get("/me/dashboard", async (c) => {
  try {
    const data: DashboardData = await getMyWork(c.env.DB, c.get("principal").login, repoOf(c));
    return c.json(data);
  } catch {
    const empty: DashboardData = { person: null, previousActivity: [], todo: [], degraded: true };
    return c.json(empty);
  }
});
```
> `get_doc`'s `repo` arg: confirm the parameter exists at `reads.ts:9` before adding it; if the signature is `(db, slug)`, call `get_doc(c.env.DB, c.req.param("slug"))` and drop the repo arg (the doc is still reachable only via the repo-scoped `list_docs`). `list_identity_tasks` is intentionally NOT added — identity mapping is a cross-repo people table.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd canopy && npx vitest run test/hub-routes.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add canopy/src/hub.ts canopy/test/hub-routes.test.ts
git commit -m "Phase 3: repo-scoped hub read routes"
```

## Task 3: Repo-ownership guards + hub mutation routes (push-gated)

**Files:**
- Create: `canopy/src/tools/repo-ownership.ts`
- Modify: `canopy/src/hub.ts`
- Test: `canopy/test/repo-ownership.test.ts`, and mutation cases in `canopy/test/hub-routes.test.ts`

**Interfaces:**
- Consumes: `promote_doc(db, slug, version, author, repo)`, `reject_doc_version(db, slug, version, repo)` (both repo-capable); the id-keyed writers `ratify_adr`, `reject_adr`, `promote_milestone_proposal`, `reject_milestone_proposal`, `complete_milestone`, `resolve_triage`, `assign_triage`, `map_identity`; `consume(db, payload, principal, repo)`; `first` (`src/db.ts`).
- Produces: `docRepo`, `adrRepo`, `milestoneProposalRepo`, `milestoneRepo`, `triageRepo` in `repo-ownership.ts`, each `(db, id|slug) => Promise<string | null>`; hub POST routes that (a) require `c.get("canPush")`, and (b) for id-keyed writers, 404 if the row's repo ≠ `repoOf(c)`.

- [ ] **Step 1: Write the failing ownership-helper test**

Create `canopy/test/repo-ownership.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adrRepo, triageRepo } from "../src/tools/repo-ownership";
import { run, nowIso } from "../src/db";

describe("repo-ownership helpers", () => {
  it("adrRepo returns the row's repo, or null when absent", async () => {
    await run(env.DB, `INSERT INTO adrs (title, body, status, created_at, repo) VALUES ('t','b','draft',?,?)`, nowIso(), "octo/hub");
    const id = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
    expect(await adrRepo(env.DB, id.id)).toBe("octo/hub");
    expect(await adrRepo(env.DB, 999999)).toBeNull();
  });
});
```
> Match the EXACT `adrs` insert columns to the schema used by existing ADR tests before running.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd canopy && npx vitest run test/repo-ownership.test.ts`
Expected: FAIL — `repo-ownership` module missing.

- [ ] **Step 3: Create the ownership helpers**

Create `canopy/src/tools/repo-ownership.ts`:
```ts
import { type DB, first } from "../db";

// Repo-ownership lookups for hub mutations on id/slug-keyed rows. Each returns the
// row's `repo`, or null if the row doesn't exist — the hub uses null/mismatch to 404
// a cross-repo id so a mutation can never cross the tenant boundary.

export async function docRepo(db: DB, slug: string): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM docs WHERE slug = ?`, slug);
  return r?.repo ?? null;
}
export async function adrRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM adrs WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function milestoneProposalRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM milestone_proposals WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function milestoneRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM milestones WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function triageRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM needs_triage WHERE id = ?`, id);
  return r?.repo ?? null;
}
```

- [ ] **Step 4: Write the failing hub-mutation tests**

Add to `canopy/test/hub-routes.test.ts`:
```ts
it("admin mutation is 403 without push access", async () => {
  await connect("octo/hub");
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: false }]; // read-only collaborator
  const res = await app.request(`/r/octo/hub/adr/1/ratify`, { method: "POST" }, env);
  expect(res.status).toBe(403);
});

it("id-keyed mutation 404s a cross-repo id", async () => {
  await connect("octo/hub");
  await run(env.DB, `INSERT INTO adrs (title, body, status, created_at, repo) VALUES ('x','y','draft',?, 'octo/other')`, nowIso());
  const row = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }];
  const res = await app.request(`/r/octo/hub/adr/${row.id}/ratify`, { method: "POST" }, env);
  expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `cd canopy && npx vitest run test/hub-routes.test.ts -t "mutation"`
Expected: FAIL — routes not defined (404 for both, but the 403 case fails since it also 404s).

- [ ] **Step 6: Add the mutation routes to `src/hub.ts`**

Add imports and a small `requirePush` + guard helper, then the routes:
```ts
import { promote_doc, ratify_adr, reject_adr, promote_milestone_proposal, reject_milestone_proposal, complete_milestone, reject_doc_version, resolve_triage, assign_triage, map_identity, type AssignType } from "./tools/writes";
import { IngestPayload } from "@shared/contract";
import { consume } from "./consumer";
import { docRepo, adrRepo, milestoneProposalRepo, milestoneRepo, triageRepo } from "./tools/repo-ownership";

// Admin (push⇒admin) gate for the authored/promote-class writes under a hub.
function requirePush(c: import("hono").Context<AppEnv>): Response | null {
  return c.get("canPush") ? null : c.json({ error: "push access required" }, 403);
}

// Ingest (agent-proposed content) scoped to the hub's repo.
hubApp.post("/ingest", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IngestPayload.safeParse(json);
  if (!parsed.success) return c.json({ error: "invalid payload", issues: parsed.error.issues }, 400);
  const result = await consume(c.env.DB, parsed.data, c.get("principal"), repoOf(c));
  return c.json({ ok: true, result });
});

hubApp.post("/doc/:slug/promote", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const body = await c.req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version)) return c.json({ error: "version (integer) required" }, 400);
  const owner = await docRepo(c.env.DB, c.req.param("slug"));
  if (owner !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try {
    const res = await promote_doc(c.env.DB, c.req.param("slug"), version, c.get("principal").login, repoOf(c));
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/doc/:slug/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const body = await c.req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version)) return c.json({ error: "version (integer) required" }, 400);
  const owner = await docRepo(c.env.DB, c.req.param("slug"));
  if (owner !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try {
    const res = await reject_doc_version(c.env.DB, c.req.param("slug"), version, repoOf(c));
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

// id-keyed writers: push-gate + repo-ownership guard, then delegate unchanged.
hubApp.post("/adr/:id/ratify", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await adrRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await ratify_adr(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/adr/:id/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await adrRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await reject_adr(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestone-proposals/:id/promote", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneProposalRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, milestone: await promote_milestone_proposal(c.env.DB, id, c.get("principal").login) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestone-proposals/:id/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneProposalRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await reject_milestone_proposal(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestones/:id/complete", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, milestone: await complete_milestone(c.env.DB, id) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/needs-triage/:id/discard", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await triageRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await resolve_triage(c.env.DB, id, c.get("principal").login, "discarded")) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/needs-triage/:id/assign", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await triageRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { type?: AssignType; section?: string; space?: "sapling" | "canopy"; tags?: string[] } | null;
  try {
    const res = await assign_triage(c.env.DB, id, c.get("principal").login, { type: body?.type, section: body?.section, space: body?.space, tags: body?.tags });
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});
```
> `map_identity`/`identity-tasks` stay on the flat admin routes only — the `people` map is cross-repo, not a per-hub surface. Do not add them under `/r/`.

- [ ] **Step 7: Run all tests + typecheck**

Run: `cd canopy && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add canopy/src/tools/repo-ownership.ts canopy/src/hub.ts canopy/test/repo-ownership.test.ts canopy/test/hub-routes.test.ts
git commit -m "Phase 3: push-gated hub mutations with repo-ownership guards"
```

## Task 4: Grandfather the bootstrap repo as connected

**Files:**
- Modify: `canopy/src/db.ts` (`bootstrapRepo`)
- Create: `canopy/migrations/0026_grandfather_connected.sql`
- Test: `canopy/test/bootstrap-connected.test.ts`

**Interfaces:**
- Consumes: `bootstrapRepo(env, db)` (existing), the `repos` table.
- Produces: the seeded `GITHUB_REPO` registry row always has `status='connected'`, so the grandfathered repo is hub-eligible the moment the user installs the App (the install then fills `installation_id` via `syncInstallationFromApp`/webhook).

- [ ] **Step 1: Write the failing test**

Create `canopy/test/bootstrap-connected.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { bootstrapRepo, first } from "../src/db";

describe("bootstrapRepo grandfather", () => {
  it("seeds the GITHUB_REPO registry row as connected", async () => {
    await bootstrapRepo(env, env.DB);
    const repo = (env.GITHUB_REPO as string) || "";
    const row = await first<{ status: string }>(env.DB, `SELECT status FROM repos WHERE repo = ?`, repo);
    expect(row?.status).toBe("connected");
  });
});
```
> Confirm `bootstrapRepo` and `first` are exported from `src/db.ts`; if `bootstrapRepo` is guarded to run once per isolate, reset that guard in the test or assert on a fresh seed.

- [ ] **Step 2: Run to verify it fails or passes**

Run: `cd canopy && npx vitest run test/bootstrap-connected.test.ts`
Expected: Likely PASS already (0024's `DEFAULT 'connected'`), OR FAIL if `bootstrapRepo` inserts `status` explicitly as something else. If it PASSES, the invariant is proven — still add the defensive migration + the explicit `status` in the upsert (Step 3) to lock it against future edits, then keep the test as a regression guard.

- [ ] **Step 3: Make the invariant explicit**

In `canopy/src/db.ts`, in the `bootstrapRepo` upsert that seeds the registry row, ensure the INSERT sets `status='connected'` and the ON CONFLICT path does not downgrade it (add `status='connected'` to the column list / conflict update if the current statement omits it). Create `canopy/migrations/0026_grandfather_connected.sql`:
```sql
-- 0026_grandfather_connected.sql — defensive: any repo row that predates the 0024
-- status column default (or was seeded before this) is marked connected so the
-- single-tenant repo keeps its hub after cutover. Idempotent; no-op on fresh installs.
UPDATE repos SET status = 'connected' WHERE status IS NULL OR status = '';
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd canopy && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add canopy/src/db.ts canopy/migrations/0026_grandfather_connected.sql canopy/test/bootstrap-connected.test.ts
git commit -m "Phase 3: grandfather the bootstrap repo as connected"
```

## Task 5: Connect-repos data endpoint (`GET /me/repos`)

**Files:**
- Create: `canopy/src/tools/connected.ts`
- Modify: `canopy/src/routes.ts` (add `GET /me/repos` on the flat, session-gated app)
- Modify: `canopy/src/env.ts` (add `GITHUB_APP_SLUG?`)
- Test: `canopy/test/connected-repos.test.ts`

**Interfaces:**
- Consumes: `getUserToken(db, env, login)`, `accessibleRepos(userToken)` (`src/auth/app.ts`), the `repos` table.
- Produces: `listAccessibleConnectedRepos(db, env, login, opts?: { listRepos?: (token: string) => Promise<AccessibleRepo[]>; getToken?: (login: string) => Promise<string | null> }): Promise<Array<{ repo: string; can_push: boolean }>>` — the user's GitHub-accessible repos ∩ connected repos; the web hub-list reads this. `GET /me/repos` returns `{ repos: [...], appSlug: env.GITHUB_APP_SLUG ?? null }`.

- [ ] **Step 1: Write the failing test**

Create `canopy/test/connected-repos.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { listAccessibleConnectedRepos } from "../src/tools/connected";
import { run, nowIso } from "../src/db";

const LOGIN = "alice";

describe("listAccessibleConnectedRepos", () => {
  it("returns the intersection of GitHub-accessible and connected repos", async () => {
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/a', ?, ?, 1, 'connected')`, nowIso(), LOGIN);
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/b', ?, ?, 1, 'disconnected')`, nowIso(), LOGIN);
    // octo/c is accessible on GitHub but NOT connected → excluded.
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, {
      getToken: async () => "tok",
      listRepos: async () => [{ repo: "octo/a", can_push: true }, { repo: "octo/b", can_push: false }, { repo: "octo/c", can_push: true }],
    });
    expect(out).toEqual([{ repo: "octo/a", can_push: true }]); // b disconnected, c not connected
  });

  it("is empty when the user has no token", async () => {
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, { getToken: async () => null, listRepos: async () => [] });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd canopy && npx vitest run test/connected-repos.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Add the env var + implement**

In `canopy/src/env.ts`, add inside the App block:
```ts
  GITHUB_APP_SLUG?: string; // the App's URL slug for the install link (github.com/apps/<slug>/installations/new)
```
Create `canopy/src/tools/connected.ts`:
```ts
import { type DB, all } from "../db";
import type { Env } from "../env";
import { getUserToken } from "../auth/user-token";
import { accessibleRepos, type AccessibleRepo } from "../auth/app";

// The hub-list source: the repos this user can reach on GitHub (the collaborator
// boundary) intersected with the repos connected to canopy. Injectable for tests.
export async function listAccessibleConnectedRepos(
  db: DB,
  env: Env,
  login: string,
  opts?: { getToken?: (login: string) => Promise<string | null>; listRepos?: (token: string) => Promise<AccessibleRepo[]> }
): Promise<Array<{ repo: string; can_push: boolean }>> {
  const getToken = opts?.getToken ?? ((l: string) => getUserToken(db, env, l));
  const token = await getToken(login);
  if (!token) return [];
  const listRepos = opts?.listRepos ?? ((t: string) => accessibleRepos(t));
  const reachable = await listRepos(token);
  const connected = new Set(
    (await all<{ repo: string }>(db, `SELECT repo FROM repos WHERE status = 'connected'`)).map((r) => r.repo)
  );
  return reachable.filter((r) => connected.has(r.repo)).map((r) => ({ repo: r.repo, can_push: r.can_push }));
}
```
> Confirm `all` is exported from `src/db.ts` (CLAUDE.md lists `first`/`all`/`run`). If not, use `first` in a loop or the project's list helper.

In `canopy/src/routes.ts`, add (import `listAccessibleConnectedRepos`):
```ts
// The signed-in user's connected hubs (GitHub-accessible ∩ connected). Feeds the web
// hub-list + the "Connect repos" button (appSlug). Never 500s → empty on any failure.
app.get("/me/repos", async (c) => {
  try {
    const repos = await listAccessibleConnectedRepos(c.env.DB, c.env, c.get("principal").login);
    return c.json({ repos, appSlug: c.env.GITHUB_APP_SLUG ?? null });
  } catch {
    return c.json({ repos: [], appSlug: c.env.GITHUB_APP_SLUG ?? null });
  }
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd canopy && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add canopy/src/tools/connected.ts canopy/src/routes.ts canopy/src/env.ts canopy/test/connected-repos.test.ts
git commit -m "Phase 3: GET /me/repos — the user's connected hubs"
```

## Task 6: Web hub-list + repo switcher (deployed dormant)

**Files:**
- Modify: `canopy/web/src/api.ts` (repo-prefix helper, `getMyRepos`, `Repo`/`MyRepos` types)
- Modify: `canopy/web/src/render.ts` (a `hubs` screen: list + empty state; header switcher)
- Modify: `canopy/web/src/main.ts` (active-repo in `AppState`, `hubs` screen wiring, repo-scoped loaders)
- Verify: `cd canopy && npm run build:web && npm run typecheck` + manual `wrangler dev` check

**Interfaces:**
- Consumes: `GET /me/repos` → `{ repos: Array<{repo, can_push}>, appSlug }`; the existing `getJson`/`postJson` (`credentials:"same-origin"`).
- Produces: a client "active repo" dimension. When set, read functions target `/r/${owner}/${repo}/…`; when unset, the hub-list screen is shown. There is no web test harness → this task's gate is a clean `build:web` + `typecheck` + the documented manual check.

- [ ] **Step 1: Add the API layer (repo prefix + hub-list)**

In `canopy/web/src/api.ts`, add near the top a module-level active repo + a prefix helper, and a `getMyRepos`:
```ts
// The active hub (owner/name) the read functions target. null → flat/no-hub (hub-list).
let activeRepo: string | null = null;
export function setActiveRepo(r: string | null): void { activeRepo = r; }
export function getActiveRepo(): string | null { return activeRepo; }
// Prefix a hub-scoped path with the active repo when one is selected.
function scoped(path: string): string {
  return activeRepo ? `/r/${activeRepo}${path}` : path;
}

export interface Repo { repo: string; can_push: boolean; }
export interface MyRepos { repos: Repo[]; appSlug: string | null; }
export async function getMyRepos(): Promise<MyRepos> { return getJson<MyRepos>("/me/repos"); }
```
Then change each hub-scoped read to call `scoped(...)`. For example `getRoadmap` (`api.ts:108`): `return getJson<Roadmap>(scoped("/roadmap"));`. Apply `scoped(...)` to: `getFeed`, `listDocs`, `getDoc`, `getRoadmap`, `getMyDashboard`, `search`, `listNeedsTriage`, `listAdrs`, `listStagedProposals`, `listMilestoneProposals`, and the promote/reject/assign/discard/complete POSTs. Leave `getMe`, `logout`, `mint token`, and `listIdentityTasks` UNscoped (they are not hub-scoped).
> Keep each function's existing query-string building; only wrap the base path in `scoped(...)`.

- [ ] **Step 2: Add active-repo to state + the hubs screen**

In `canopy/web/src/render.ts`: add `"hubs"` to the `Screen` union (`render.ts:23`); add `activeRepo: string | null` and `myRepos: Loadable<Repo[]>` (+ `appSlug`) to `AppState` (`render.ts:32-84`) and seed them in `initialState()` (`:94-131`); add a `hubsView(s)` that renders the connected-repo cards (model on `guideView`/`dashedCard`) with an empty state ("Connect your first repo" → `https://github.com/apps/${appSlug}/installations/new`, falling back to `https://github.com/settings/installations` when `appSlug` is null); add the `hubs` case to `screenBody` (`:1281-1294`) and `titles` (`:364`). Add the header repo-switcher in the left cluster (`render.ts:433-437`) — a `cnpy-select` (model on the Docs space toggle `:398-403`) listing `myRepos.data`, whose change dispatches `switchRepo`.

- [ ] **Step 3: Wire main.ts**

In `canopy/web/src/main.ts`: add `"hubs"` to `SCREENS` (`:140-144`); a `goHubs`/`loadMyRepos` loader (`:146-157`, `:538-550`) that calls `getMyRepos()` and stores `repos`+`appSlug`; a `switchRepo(repo)` dispatch case (`:520-808`) that calls `setActiveRepo(repo)`, sets `state.activeRepo`, switches to `mywork`, and re-runs `loadForScreen`; and at boot (`:846-860`), after `getMe()` succeeds, call `loadMyRepos()` and land on `hubs` when `activeRepo` is null. Import `setActiveRepo`, `getMyRepos` from `./api`.
> This ships DORMANT: until Phase B flips the boot default, the flat `defaultRepo` routes still back every screen (activeRepo stays null only if you leave the boot default on the flat home). Keep the existing flat-home boot until Task 10 to avoid a broken window; land the hub-list behind a `?hubs` query flag for now: at boot, only force `hubs` when `new URLSearchParams(location.search).has("hubs")`.

- [ ] **Step 4: Build + typecheck + manual check**

Run: `cd canopy && npm run build:web && npm run typecheck`
Expected: clean build, no type errors.
Manual: `npm run dev`, open `http://localhost:8787/admin/?hubs` — the hub-list renders (empty state if no `/me/repos`); the flat screens still work at `/admin/`.

- [ ] **Step 5: Commit**

```bash
git add canopy/web/src/api.ts canopy/web/src/render.ts canopy/web/src/main.ts
git commit -m "Phase 3: web hub-list + repo switcher (behind ?hubs, dormant)"
```

## Task 7: Deploy Phase A dormant + apply migration 0026

**Files:** none (deploy/ops task).

- [ ] **Step 1: Full green gate**

Run: `cd canopy && npm test && npm run typecheck && npm run build:app`
Expected: all tests pass, typecheck clean, build emits `web/dist`.

- [ ] **Step 2: Apply migration 0026 to remote D1 (user-run — production)**

This is a production migration; the user runs it (the auto-mode classifier blocks unnamed prod migrations):
```
! cd /Users/josecruz/Desktop/tesseract/canopy && npm run db:migrate:remote
```
Expected: `0026_grandfather_connected.sql ✅`.

- [ ] **Step 3: Merge Phase A to main (user-authorized — deploy)**

Open a PR from the working branch to `main`; the user merges (self-authored merge to the production branch is classifier-gated). Mere triggers the Workers Builds deploy.

- [ ] **Step 4: Verify dormant deploy**

Confirm `memo-sphere.com/` (200), `/admin/` (200), `/roadmap` (401 gated), and that `/r/x/y/roadmap` returns 401/404 (gated, not 500) — the hub routes exist but nothing uses them yet. Flat routes + OAuth login unchanged.

---

# PHASE B — App-dependent (blocked on the user's GitHub App + 5 secrets)

**Prerequisite (USER):** create the GitHub App and set the 5 secrets, per the spec's "User prerequisites". Do not start Task 8 until `wrangler secret list` shows `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `[vars] GITHUB_APP_SLUG` is set.

## Task 8: App user-auth login (additive path)

**Files:**
- Create: `canopy/src/auth/app-login.ts`
- Modify: `canopy/src/auth/routes.ts` (add `/auth/app/login` + `/auth/app/callback`)
- Modify: `canopy/src/auth/principal.ts:35` (add both to `PUBLIC_PATHS`)
- Test: `canopy/test/app-login.test.ts`

**Interfaces:**
- Consumes: `exchangeUserCode(env, code, opts?)` → `UserTokens`, `getUser(token)` (`src/auth/github.ts`), `storeUserToken(db, login, tokens)` (`src/auth/user-token.ts`), `createSession`/`setSessionCookie` (`src/auth/session.ts`), `randomToken`/`hmacSeal`/`hmacUnseal` (`src/auth/crypto.ts`), `safeReturnPath`/`callbackUrl` (`src/auth/routes.ts` — export them if not already).
- Produces: `buildAppAuthorizeUrl({ clientId, redirectUri, state }): string`; `handleAppCallback(c)` logic. `/auth/app/login` mirrors `/auth/login` (state cookie, return cookie) but authorizes against the App (`GITHUB_APP_CLIENT_ID`, no scope, no PKCE — App perms govern). `/auth/app/callback` exchanges the code, identifies the user, **stores the user token**, opens a session (NO org gate — any GitHub user), redirects to the return path.

- [ ] **Step 1: Write the failing test**

Create `canopy/test/app-login.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { buildAppAuthorizeUrl } from "../src/auth/app-login";

describe("app-login", () => {
  it("builds the App authorize URL with client_id + state, no scope", () => {
    const url = new URL(buildAppAuthorizeUrl({ clientId: "Iv1.abc", redirectUri: "https://memo-sphere.com/auth/app/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://memo-sphere.com/auth/app/callback");
    expect(url.searchParams.get("scope")).toBeNull(); // App permissions govern; no OAuth scope
  });
});
```
> A full callback integration test (code → token → session) requires injecting `fetchImpl` into `exchangeUserCode`/`getUser`; add it if `auth/routes.ts` handlers accept an injected fetch, otherwise cover the callback via the e2e verification in Task 11 and keep this unit test on the pure URL builder.

- [ ] **Step 2: Run to verify it fails**

Run: `cd canopy && npx vitest run test/app-login.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `app-login.ts`**

Create `canopy/src/auth/app-login.ts`:
```ts
import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./principal";
import { randomToken, hmacSeal, hmacUnseal } from "./crypto";
import { exchangeUserCode } from "./app";
import { getUser } from "./github";
import { storeUserToken } from "./user-token";
import { createSession, setSessionCookie } from "./session";
import { safeReturnPath, callbackUrl } from "./routes";
import { run, nowIso } from "../db";

const TX = "app_oauth_tx";
const RET = "app_oauth_return";

/** The GitHub App user-authorization URL. No scope: the App's permissions govern. */
export function buildAppAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

/** App user-auth callback path for this request (mirrors callbackUrl but /auth/app/callback). */
function appCallbackUrl(reqUrl: string): string {
  return callbackUrl(reqUrl).replace(/\/auth\/callback$/, "/auth/app/callback");
}

export async function startAppLogin(c: Context<AppEnv>): Promise<Response> {
  if (!c.env.GITHUB_APP_CLIENT_ID) return c.json({ error: "app_not_configured" }, 503);
  const state = randomToken(16);
  const sealed = await hmacSeal(state, c.env.COOKIE_SECRET);
  setCookie(c, TX, sealed, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  setCookie(c, RET, safeReturnPath(c.req.query("return")), { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  return c.redirect(buildAppAuthorizeUrl({ clientId: c.env.GITHUB_APP_CLIENT_ID, redirectUri: appCallbackUrl(c.req.url), state }), 302);
}

export async function finishAppLogin(c: Context<AppEnv>): Promise<Response> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const sealedTx = getCookie(c, TX);
  deleteCookie(c, TX, { path: "/" });
  const ret = safeReturnPath(getCookie(c, RET));
  deleteCookie(c, RET, { path: "/" });
  if (!code || !state || !sealedTx) return c.json({ error: "invalid_request" }, 400);
  const txState = await hmacUnseal(sealedTx, c.env.COOKIE_SECRET);
  if (txState !== state) return c.json({ error: "state_mismatch" }, 403);

  const tokens = await exchangeUserCode(c.env, code);       // user-to-server token (+ refresh)
  const ghUser = await getUser(tokens.token);
  if (!ghUser) return c.json({ error: "identity_failed" }, 401);

  await storeUserToken(c.env.DB, ghUser.login, tokens);      // so repoGate can read their access
  await run(c.env.DB,
    `INSERT INTO users (github_login, name, avatar_url, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(github_login) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url`,
    ghUser.login, ghUser.name, ghUser.avatar_url, nowIso());
  const { id } = await createSession(c.env.DB, ghUser.login);
  await setSessionCookie(c, id, c.env.COOKIE_SECRET);        // NO org gate — any GitHub user
  return c.redirect(ret, 302);
}
```
In `canopy/src/auth/routes.ts`, `export` `safeReturnPath` and `callbackUrl` (they're already `export function`), and register the routes:
```ts
import { startAppLogin, finishAppLogin } from "./app-login";
authApp.get("/app/login", (c) => startAppLogin(c));
authApp.get("/app/callback", (c) => finishAppLogin(c));
```
In `canopy/src/auth/principal.ts:35`, extend `PUBLIC_PATHS`:
```ts
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/callback", "/auth/app/login", "/auth/app/callback"]);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd canopy && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add canopy/src/auth/app-login.ts canopy/src/auth/routes.ts canopy/src/auth/principal.ts canopy/test/app-login.test.ts
git commit -m "Phase 3: App user-auth login (/auth/app/*), additive"
```

## Task 9: Retire GITHUB_SERVICE_TOKEN → per-installation tokens

**Files:**
- Modify: `canopy/src/tools/progress.ts` (new `recomputeConnectedRepos`), `canopy/src/index.ts` (`scheduled`), `canopy/src/tools/backfill.ts` (`runBackfill`)
- Test: `canopy/test/service-token-retire.test.ts`

**Interfaces:**
- Consumes: `installationToken(env, installationId, opts?)`, the `repos` table (`installation_id`, `status='connected'`), the existing `recomputeAllProgress(db, { token, repo })`.
- Produces: `recomputeConnectedRepos(db, env, opts?: { fetchImpl?; installationTokenImpl? }): Promise<void>` — for each connected repo with an `installation_id`, mint an installation token and recompute that repo's progress. `scheduled()` calls it and no longer reads `GITHUB_SERVICE_TOKEN`. `runBackfill` takes a repo, resolves its installation token, and backfills that repo (admin + push-gated at the route).

- [ ] **Step 1: Write the failing test**

Create `canopy/test/service-token-retire.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { recomputeConnectedRepos } from "../src/tools/progress";
import { run, nowIso } from "../src/db";

describe("recomputeConnectedRepos", () => {
  it("mints an installation token per connected repo (no GITHUB_SERVICE_TOKEN)", async () => {
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/a', ?, 'x', 11, 'connected')`, nowIso());
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/b', ?, 'x', 22, 'connected')`, nowIso());
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/c', ?, 'x', 33, 'disconnected')`, nowIso());
    const minted: number[] = [];
    await recomputeConnectedRepos(env.DB, env, {
      installationTokenImpl: async (_env, id) => { minted.push(id); return `tok-${id}`; },
      fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }), // GitHub calls stubbed empty
    });
    expect(minted.sort()).toEqual([11, 22]); // disconnected repo skipped
  });
});
```
> Match `recomputeAllProgress`'s real GitHub call shape when stubbing `fetchImpl` (inspect `tools/progress.ts`); the assertion of interest is which installation ids were minted.

- [ ] **Step 2: Run to verify it fails**

Run: `cd canopy && npx vitest run test/service-token-retire.test.ts`
Expected: FAIL — `recomputeConnectedRepos` missing.

- [ ] **Step 3: Implement**

In `canopy/src/tools/progress.ts`, add:
```ts
import { installationToken } from "../auth/app";
import type { Env } from "../env";
import { all } from "../db";

/**
 * Recompute progress for every connected repo, each authed by its own installation
 * token (retires the single GITHUB_SERVICE_TOKEN). `installationTokenImpl`/`fetchImpl`
 * are injectable for tests.
 */
export async function recomputeConnectedRepos(
  db: DB,
  env: Env,
  opts?: { fetchImpl?: typeof fetch; installationTokenImpl?: (env: Env, id: number) => Promise<string> }
): Promise<void> {
  const mint = opts?.installationTokenImpl ?? ((e: Env, id: number) => installationToken(e, id, { fetchImpl: opts?.fetchImpl }));
  const rows = await all<{ repo: string; installation_id: number | null }>(
    db, `SELECT repo, installation_id FROM repos WHERE status = 'connected' AND installation_id IS NOT NULL`
  );
  for (const r of rows) {
    if (r.installation_id == null) continue;
    const token = await mint(env, r.installation_id);
    await recomputeAllProgress(db, { token, repo: r.repo }); // reuse the existing per-repo recompute
  }
}
```
> Confirm `recomputeAllProgress`'s signature/scoping in `tools/progress.ts`; if it isn't already repo-scoped, scope it by `repo` here (it must only recompute that repo's milestones). Import `DB` type consistently with the file's existing imports.

In `canopy/src/index.ts`, replace `scheduled`:
```ts
async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  // Per-installation tokens now (GITHUB_SERVICE_TOKEN retired). No App configured → no-op.
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return;
  const { recomputeConnectedRepos } = await import("./tools/progress");
  await recomputeConnectedRepos(env.DB, env);
},
```
In `canopy/src/tools/backfill.ts`, change `runBackfill` to take the target repo and resolve its installation token from the `repos` row rather than `env.GITHUB_SERVICE_TOKEN` (mirror the pattern above: look up `installation_id` for the repo, `installationToken(env, id)`; 503 if the repo isn't connected / has no installation). Update the flat `POST /admin/backfill` route and add a hub `POST /r/:owner/:repo/admin/backfill` (push-gated) that backfills `repoOf(c)`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd canopy && npm test && npm run typecheck`
Expected: PASS, clean. Remove `GITHUB_SERVICE_TOKEN` from `env.ts` only after confirming no remaining references (`grep -rn GITHUB_SERVICE_TOKEN src`).

- [ ] **Step 5: Commit**

```bash
git add canopy/src/tools/progress.ts canopy/src/index.ts canopy/src/tools/backfill.ts canopy/test/service-token-retire.test.ts
git commit -m "Phase 3: retire GITHUB_SERVICE_TOKEN for per-installation tokens"
```

## Task 10: Login flip + UI cutover to hubs

**Files:**
- Modify: `canopy/src/auth/routes.ts` (`/auth/login` + `/auth/callback` → App flow)
- Modify: `canopy/web/src/main.ts` (boot default → hub-list; drop the `?hubs` flag)
- Test: extend `canopy/test/app-login.test.ts` if the callback is injectable; otherwise e2e (Task 11)

**Interfaces:**
- Consumes: `startAppLogin`/`finishAppLogin` (Task 8).
- Produces: `/auth/login` delegates to `startAppLogin` (App authorize) and `/auth/callback` delegates to `finishAppLogin`; the old OAuth `buildAuthorizeUrl`/`exchangeCode`/`isActiveOrgMember` path is retired. `/auth/me` contract unchanged (still `{ login, name, avatar_url, org, admin }`). The web boot lands on `hubs` when no active repo is selected.

- [ ] **Step 1: Flip the login routes**

In `canopy/src/auth/routes.ts`, change the `/login` and `/callback` handlers to delegate to the App flow:
```ts
authApp.get("/login", (c) => startAppLogin(c));
authApp.get("/callback", (c) => finishAppLogin(c));
```
Remove the now-unused OAuth-app imports (`buildAuthorizeUrl`, `exchangeCode`, PKCE `pkce`) if nothing else uses them; keep `getUser` (the App flow uses it). Leave `/auth/app/login` + `/auth/app/callback` as aliases (harmless) or remove them — the App's registered callback URL list includes `/auth/callback`, so the flip works with the primary path. Delete the org-gate call: `isAllowed`/`isActiveOrgMember` are no longer on the login path (any GitHub user signs in). Keep `isAdmin` (still gates admin actions).

- [ ] **Step 2: Flip the web boot to the hub-list**

In `canopy/web/src/main.ts` boot (`:846-860`), after `getMe()` + `loadMyRepos()`, land on `hubs` whenever `state.activeRepo` is null (remove the `?hubs` gate from Task 6). A returning user with a remembered repo can deep-link; otherwise they pick a hub first.

- [ ] **Step 3: Run tests + typecheck + build**

Run: `cd canopy && npm test && npm run typecheck && npm run build:app`
Expected: PASS, clean, build emits.

- [ ] **Step 4: Commit**

```bash
git add canopy/src/auth/routes.ts canopy/web/src/main.ts
git commit -m "Phase 3: flip login to the GitHub App flow + web boot to hub-list"
```

## Task 11: E2E verification against a real install + remove flat routes

**Files:**
- Modify: `canopy/src/routes.ts` (remove/redirect the flat repo-scoped routes once hubs are verified)

**Interfaces:** none new — this is the final flip + verification.

- [ ] **Step 1: Deploy Tasks 8–10 (user-authorized)**

With the App live + secrets set, merge to `main` (user-authorized) → Workers Builds deploys. `/auth/login` now runs the App flow; hubs are the web default.

- [ ] **Step 2: E2E verify (documented checklist)**

- Sign in at `memo-sphere.com` via GitHub → the App user-auth consent → lands on the hub-list (empty if no install yet).
- Click "Connect your first repo" → install the App on `Jose-Gael-Cruz-Lopez/tesseract` → `/github/app/callback` syncs → the repo appears as a hub.
- Open the hub → roadmap/feed/docs/triage render the grandfathered repo's existing data (scoped).
- A push-collaborator sees admin actions; a read-only collaborator gets 403 on promote/complete.
- Uninstall → the hub disappears (soft-disconnect); reconnect → it returns.
- Webhook: merge a PR / assign an issue in the connected repo → the event lands in that hub's feed/progress.

- [ ] **Step 3: Remove the flat repo-scoped routes**

> **⚠️ SECURITY ORDERING (whole-branch review, 2026-07-11):** the flat **mutation** routes
> (`/adr/:id/ratify`, `/adr/:id/reject`, `/milestones/:id/complete`,
> `/milestone-proposals/:id/promote|reject`, `/needs-triage/:id/discard|assign`,
> `/doc/:slug/promote|reject`) are session-gated but have **no push-gate and no repo-ownership
> guard** — an id-keyed one acts on any global id. This is safe ONLY while the App is
> unconfigured (the grandfathered bootstrap repo is the sole `connected` repo, so it's the only
> data that exists). These flat mutation routes MUST be removed or guarded **atomically with App
> activation — before any second tenant can connect** — not merely "after cutover". Do NOT let a
> window exist where a second connected repo coexists with the unguarded flat mutations. (For this
> deployment `ADMIN_LOGINS` is a single login, which incidentally neutralizes the practical
> exposure, but the sequencing must not rely on that.)

Once hubs are verified, delete (or 301-redirect to the grandfathered hub) the flat repo-scoped routes in `src/routes.ts` that duplicated hub behavior — `/roadmap`, `/feed`, `/docs`, `/doc/:slug`, `/search`, `/needs-triage`, `/adrs`, `/proposals`, `/milestone-proposals`, `/me/dashboard`, `/ingest`, and the promote/reject/assign/discard/complete POSTs — leaving only the non-hub surfaces (`/auth/*`, `/me/repos`, `/identity-tasks` + map, `/github/app/callback`). Keep `/ingest` reachable for any agent still posting flat until MCP is repo-routed (follow-up). Run `npm test` (update/remove flat-route tests that no longer apply) + `npm run typecheck`.

- [ ] **Step 4: Commit + final deploy (user-authorized)**

```bash
git add canopy/src/routes.ts
git commit -m "Phase 3: remove flat repo-scoped routes after hub cutover"
```
Merge to `main` (user-authorized) → deploy. Phase 3 is live.

---

## Self-Review

**Spec coverage:**
- §1 Core architecture (request-repo replaces defaultRepo; `/r/:owner/:repo`; repoGate; push⇒admin; auth opens up) → Tasks 1–3, 8, 10. ✓
- §2 GitHub App (sign-in, install callback [already built], tokens, data model [0024 live]) → Tasks 8 (sign-in), 9 (installation tokens). Install callback already mounted. ✓
- §3 UI/onboarding (empty state, hub-list, hub, switcher; Mnemosphere flows into App auth) → Tasks 5, 6, 10. Mnemosphere needs no change (verified). ✓
- §4 Migration/cutover (grandfather; routes coexist→flip; login coexist→flip; order) → Tasks 4, 7 (dormant deploy), 10, 11. ✓
- §5 Testing (unit built; integration repoGate/connect; e2e; migration) → Tasks 1–5, 8, 9 (integration/unit), 11 (e2e). ✓
- Remaining list items 1–6 → Tasks 1–3 (1), callback already done (2), Task 8 + user-token wiring done (3), Tasks 8+10 (4), Tasks 5+6 (5), Task 4 (6). ✓

**Gaps / decisions flagged for the executor:**
- **`get_doc` repo param** — verify at `reads.ts:9` before Task 2 Step 3; pass `repoOf(c)` only if present.
- **Feed/ADR/milestone insert columns** in tests — match the live schema, not the illustrative columns here.
- **`recomputeAllProgress` scoping** — confirm it recomputes only the passed repo before Task 9 relies on it per-repo.
- **MCP repo-routing** is explicitly OUT of this plan (the `/mcp` bearer surface still uses `defaultRepo`); note as a Phase 3 follow-up so agents keep working during cutover.
- **id-keyed cross-repo guard** applies the same pattern everywhere; `map_identity`/`identity-tasks` deliberately stay cross-repo (flat only).

**Placeholder scan:** no TBD/TODO; every code step carries real code; test steps carry real assertions. ✓
**Type consistency:** `repoOf(c)`/`c.get("repo")` backed by the `AppEnv` extension (Task 1); `AccessibleRepo`/`UserTokens` reused from `auth/app.ts`; `Repo`/`MyRepos` defined in Task 6 and consumed there. ✓
