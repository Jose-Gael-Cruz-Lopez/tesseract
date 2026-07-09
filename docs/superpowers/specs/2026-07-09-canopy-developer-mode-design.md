# Canopy Developer Mode — Design Spec

**Date:** 2026-07-09
**Source repo integrated:** `https://github.com/Jose-Gael-Cruz-Lopez/canopy.git` (a fork)

## Goal

Add a **developer mode** to Mnemosphere: a second, separate "developer sphere"
(distinct from the personal knowledge globe) that visualizes a codebase's
context — docs, roadmap/milestones, activity feed, triage — read live from
**canopy**, and connectable to one or multiple git repos.

## What canopy is (context)

Canopy is a complete standalone full-stack app, not a library:

- **Backend:** a Cloudflare Worker (TypeScript) — Hono HTTP API + an MCP server
  (`/mcp`) + a Cloudflare **D1** (SQLite) database + GitHub OAuth/webhooks +
  Gemini PR/issue summaries.
- **Frontend:** its own Vite/TS SPA (My Work, Feed, Docs, Roadmap, Triage,
  Search, Settings).
- **Purpose:** a "shared context store" — versioned docs, an activity feed, a
  roadmap, ADRs, a triage queue, PR/issue summaries — kept alive by agents +
  humans. Distributed as a Claude Code plugin with 3 skills.
- **Single-repo today:** wired to one repo via `GITHUB_REPO`. Multi-repo is a
  feature to build (sub-project B).
- **Access-gated to the `SaplingLearn` GitHub org** (`src/auth/github.ts`) — as
  forked, the owner cannot log in without changing this.

## Approach (chosen)

**Monorepo + dev-globe over canopy's API.** Canopy is brought into this repo as
a `canopy/` subfolder that keeps its own Cloudflare Worker build/deploy. The two
apps never share a build or dependencies. They meet at exactly one seam: the dev
sphere calls canopy's **HTTP API over the network**. That API is the isolation
boundary — either app can change internally as long as the contract holds.

```
tesseract/                    Mnemosphere (static Vite + three.js + Supabase)
├── src/ …                       deploys as a static site
├── canopy/                    canopy (Cloudflare Worker + D1) — deploys separately
│   └── src/ web/ shared/ migrations/ wrangler.toml package.json
└── docs/superpowers/specs/…
```

**Rejected:** rebuilding canopy on Supabase (a weeks-long rewrite of a mature
app, losing the MCP/plugin ecosystem); embedding canopy's raw SPA (no globe).

## Sub-projects (each its own spec → plan → build)

### A — Canopy in-repo, de-Saplinged, deployable  *(this cycle)*

**Produces:** canopy living in `canopy/`, building/testing/running locally, and a
`canopy/SETUP.md` that takes the user from zero to a deployed canopy connected to
**one** repo. Everything downstream consumes the resulting API base URL.

Scope:
1. **Bring it in.** Copy canopy's contents into `canopy/` (minus its `.git`).
   Keep its own `package.json`, `wrangler.toml`, tsconfig, migrations, tests,
   `plugins/`, skills. Add to the repo `.gitignore`: `canopy/.dev.vars`,
   `canopy/.wrangler/`, `canopy/web/dist/`, `canopy/node_modules/`.
2. **Isolated builds.** Root `npm run dev/build` (Mnemosphere) is untouched.
   Canopy runs from its own folder (`cd canopy && npm install && npm run
   dev|test|deploy`). Verify `npm test` + `npm run typecheck` pass standalone.
3. **De-Sapling / parameterize (load-bearing):**
   - `src/auth/github.ts`: replace the hardcoded `SAPLING_ORG = "SaplingLearn"`
     org gate with an env var `AUTH_ORG`. **When `AUTH_ORG` is empty, gate by an
     allow-list of GitHub logins (`ADMIN_LOGINS`)** instead of org membership, so
     a personal-account owner can log in. When set, keep the org-membership
     check (renamed generically).
   - `wrangler.toml`: blank `database_id` (user creates their own); make
     `GITHUB_REPO`, `AUTH_ORG`, `ADMIN_LOGINS` placeholders with comments.
   - User-facing Sapling copy: the membership-gate screen and "the Sapling team"
     line in `web/src/render.ts` → generic/neutral wording; `web/src/github.ts`
     repo URL derived from config; plugin marketplace ref `SaplingLearn/canopy`
     → the fork path. Behavior otherwise identical.
4. **`canopy/SETUP.md`** — the "how do I connect it to a repo" answer, copy-paste:
   `wrangler login` → `npm run db:create` (paste `database_id`) → create a GitHub
   OAuth app (callback `https://<worker>/auth/callback`) → `wrangler secret put`
   `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `COOKIE_SECRET` (optional:
   `GEMINI_API_KEY`, `GITHUB_SERVICE_TOKEN`, `GITHUB_WEBHOOK_SECRET`) → set
   `GITHUB_REPO="owner/repo"`, `AUTH_ORG`, `ADMIN_LOGINS`, and a
   `GITHUB_SERVICE_TOKEN` PAT (repo read) so the roadmap can pull progress →
   `npm run db:migrate:remote` → `npm run deploy`. Local dev: copy
   `.dev.vars.example` → `.dev.vars`, set `DEV_LOGIN=<your-login>` to bypass
   OAuth, `npm run dev`.
5. **Division of labor.** Claude does the code/config/docs and verifies canopy
   **builds, type-checks, tests, and runs under local `wrangler dev`**. Claude
   **cannot** run the real Cloudflare deploy (needs the user's account) — the
   user runs the final `wrangler deploy` following SETUP.md.

**Out of scope for A:** the dev sphere (C), multi-repo (B), identity bridge (D).

**Env/secrets reference (from canopy's `env.ts`):** required —
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_SECRET`, D1 `DB`, `ASSETS`.
Optional — `GITHUB_WEBHOOK_SECRET`, `GITHUB_REPO`, `DEV_LOGIN` (local only),
`GEMINI_API_KEY`, `GITHUB_SERVICE_TOKEN`, `ADMIN_LOGINS`, plus new `AUTH_ORG`.

### C — Developer mode + dev sphere

Mnemosphere gains a **mode switch** (Knowledge globe ↔ Developer globe). The dev
globe reuses the existing three.js engine but builds its graph from canopy: the
**core = the repo**, **hubs = context categories** (Docs · Roadmap · Feed ·
Triage), **orbiting nodes = individual docs / PRs / milestones / triage items**.
Clicking a node opens a "dev page" rendering that item's markdown (mirroring how
a knowledge node opens a Notion page). Two new modules: `canopy-api.js` (fetch)
and `dev-graph.js` (map canopy DTOs → the globe graph shape). **Consumes** A's
API + a read token from D.

### B — Multi-repo in canopy

Make canopy repo-aware: add a `repo` dimension to the GitHub-derived tables +
`?repo=` API filters, and loop the roadmap/backfill/progress over a *list* of
repos instead of one. The dev sphere then shows **one hub per repo**. Biggest
canopy-internal change. **Extends** A's data model + C's mapping.

### D — Identity wiring (folds into C)

Mnemosphere's identity (Google/Supabase) and canopy's (GitHub OAuth) stay
**separate systems bridged by a token**: the user connects the dev sphere to
canopy by pasting its API URL + a read token in a new "Developer" settings panel.
Canopy gets CORS for the Mnemosphere origin + a read-scoped token check. No
identity merge.

## Stable contract (holds the pieces together)

Canopy's read API — `/search`, `/feed`, `/roadmap`, `/mywork`, `get_doc` — plus
a `?repo=` filter (added in B) and a read token (D). Sub-project C is built
entirely against that contract.

## Testing / verification (A)

- `cd canopy && npm install && npm test` — canopy's vitest suite passes.
- `cd canopy && npm run typecheck` — clean.
- `cd canopy && npm run dev` (local `wrangler dev` + Miniflare local D1 +
  `DEV_LOGIN`) — boots; `GET /` serves the SPA, an API route returns JSON.
- Mnemosphere's own build + tests remain green (canopy is isolated).
- The de-Sapling change is verified by: `AUTH_ORG=""` + `ADMIN_LOGINS=<login>`
  path allows that login; a non-allowed login is rejected (existing auth tests
  extended or a focused new test).
