# Canopy

Shared context store. One Cloudflare Worker on one origin serves the HTTP API
(multi-tenant `/r/:owner/:repo` hubs + admin-gated flat routes), a stateless MCP
endpoint per connected repo (`/mcp/:owner/:repo`; bare `/mcp` is admin-only), and
a full single-page app (TypeScript + Vite, served via the ASSETS binding). Live at
`memo-sphere.com` — fused with the Mnemosphere UI at `/`, canopy's admin at `/admin`.

- `shared/` — Zod contract, vocabulary, D1 row types (imported by `src/` and `web/`)
- `src/` — Worker: `index.ts` (router), `routes.ts` (Hono HTTP), `hub.ts` (per-repo hubs),
  `mcp.ts` (MCP tools), `consumer.ts` (the gate — replay-safe, hash-deduped, change-typed),
  `webhook.ts` (GitHub event capture), `db.ts`, `tools/`, `auth/`
- `web/` — Full SPA with screens: Hubs, My Work, Feed, Docs, Roadmap,
  Triage, Search, Settings, and a Get Started guide. Built to `web/dist`.
- `migrations/` — D1 SQL (`0001_init` … `0028_rate_limits`; per-repo multi-tenancy
  landed in `0020`–`0027`)
- `plugins/canopy/` + `.claude-plugin/marketplace.json` — the Canopy **plugin** and the marketplace
  that distributes it (see **Install the Canopy plugin**). Bundles the three skills — `canopy`
  (umbrella + `query` reference), `load-context` (read/orient), `record-session` (session-end batch
  writer) — under `plugins/canopy/skills/`, plus the auto-wired MCP server.
- `.claude/skills/` — symlinks into `plugins/canopy/skills/` so this repo's own sessions load the
  bundled skills directly (single source of truth; nothing to keep in sync)

## Read side

FTS5 full-text search: `query()` ranks by bm25 + authority flag, assembles full bodies for
top hits, and returns ranked pointers for the rest. Backs `GET /search` and MCP `query`.
`get_doc` fetches a single doc with all its versions; `get_feed` streams the activity feed;
`get_roadmap` reads the admin-authored plan merged with the STORED progress cache (written
by the webhook and the 6-hour cron via per-installation App tokens — no live GitHub at render).

## Write side (agents stage, humans confirm)

Every agent write flows through the gate in `src/consumer.ts` — replay ledger
(`processed_items`), content-hash dedupe, change-typing (new/edit/rewrite), and
out-of-vocab or low-confidence entries route to `needs_triage`. HTTP confirm routes
(promote, ratify, reject, assign, discard) are session-cookie-only — never MCP tools.

MCP write tools: `append_feed`, `propose_doc_update`, `record_session` (the session-end batch
writer — a whole `IngestPayload` through the same gate), and the admin-authored `update_plan`
(promote-class, gated on per-repo push access). `propose_milestone` and `set_focus` are retired.

## The living loop (the skills)

Canopy stays current because agents continuously feed it and humans curate it. Three skills under
`.claude/skills/` drive that loop — **this is the root of how the context system stays alive**, not a
side feature:

1. **Orient — `load-context`** (auto-fires, read-only). Before an agent works an existing area it pulls
   the relevant context via `query` (assembled bodies + ranked pointers, each authority-flagged), so it
   builds on what's already there instead of guessing.
2. **Work** — the agent does the task.
3. **Record — `record-session`** (explicit: "record this session"). At the end it observes what actually
   shipped (`git`/`gh`), reads the affected docs back from Canopy for a true base, and stages **one**
   reconciled batch through the `record_session` MCP tool (same gate as `POST /ingest`, reachable over
   the agent's bearer).

The gate reconciles every write — drops no-ops (content-hash), tags each doc change `new`/`edit`/`rewrite`,
and routes out-of-vocab or low-confidence entries to Triage. A human then promotes / ratifies / rejects /
assigns / discards. **Staging + confirmation is what keeps the store trustworthy as it grows**: nothing
goes live unreviewed, and nothing rots, because every session writes back what it learned.

`canopy` is the umbrella skill (the map, plus the full `query` reference in `references/querying.md`);
`load-context` and `record-session` are the two halves it composes — kept separate because one must
auto-fire and the other must never. They live in this repo so they version with the tools they wrap.
To use them from another machine or repo, install the **Canopy plugin** (below) — it bundles all three
skills and auto-wires the MCP server in one step, so there's nothing to copy by hand.

## Develop

- `npm test` — Vitest against a real Miniflare D1
- `npm run typecheck` — type-check worker + web
- `npm run dev` — build web, then `wrangler dev`
- `npm run deploy` — build web, then `wrangler deploy`
- `npm run db:create` / `db:migrate:local` / `db:migrate:remote` — D1 provisioning + migrations

## Auth & secrets

Auth gates all data routes (session cookie) and the MCP surfaces (per-person bearer token).
Sign-in is the **GitHub App user-authorization flow** — signup is open unless
`LOGIN_ALLOWLIST` is set; users see only repos they're collaborators on, and
`ADMIN_LOGINS` gates admin actions. Secrets (see `SETUP.md` for the full walkthrough):

- `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` — the App's user-auth credentials
  (sign-in 503s without them).
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` (PKCS#8) — per-installation tokens for the
  cron recompute and backfills.
- `COOKIE_SECRET` — signs the session cookie. Optional: `GEMINI_API_KEY`,
  `GITHUB_WEBHOOK_SECRET`.

The legacy `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` OAuth-App pair is retired.
Production: pipe values (`printf '%s' 'V' | npx wrangler secret put NAME` — see the
secrets runbook). Local dev: copy `.dev.vars.example` to `.dev.vars` (git-ignored);
`DEV_LOGIN` skips the OAuth dance entirely.

Mint an MCP token from a logged-in session: `POST /auth/mcp-token` → `{ "token": "canopy_mcp_..." }`
(shown once; or use the web app → Settings → MCP access tokens).

## Install the Canopy plugin (skills + MCP in one step)

The three skills and the MCP wiring ship as a Claude Code **plugin**, distributed from this repo as a
marketplace. Anyone on the team gets both in two commands inside Claude Code:

```text
/plugin marketplace add SaplingLearn/canopy
/plugin install canopy@canopy
```

The plugin's MCP config reads your **personal** bearer from `$CANOPY_MCP_TOKEN`, so export it in the
shell that launches Claude Code (e.g. add it to your shell profile), then restart:

```bash
export CANOPY_MCP_TOKEN=canopy_mcp_...   # your token, minted above — per person, never stored in the plugin
export CANOPY_REPO=owner/repo            # the connected repo (hub) your agent works in
```

That auto-wires the `canopy` MCP server (`query` / `get_doc` / `record_session` …) and loads the
`canopy`, `load-context`, and `record-session` skills — no manual `claude mcp add`, no copying skill
folders. (The single-server manual path still works, against the repo-scoped surface:
`claude mcp add --transport http canopy https://memo-sphere.com/mcp/owner/repo --header "Authorization: Bearer canopy_mcp_..."`.
Bare `/mcp` is the single-tenant admin surface — `ADMIN_LOGINS` only.)

> **Maintainers:** the plugin is at `plugins/canopy/`; the marketplace manifest at
> `.claude-plugin/marketplace.json`. Validate either with `claude plugin validate <path>`. The real
> skill files live under `plugins/canopy/skills/`; the in-repo `.claude/skills/*` entries are symlinks
> into that bundle, so there is a single source of truth and the two can never drift — edit the files
> under `plugins/canopy/skills/`.
