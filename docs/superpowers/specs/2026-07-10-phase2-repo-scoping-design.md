# Phase 2 — Repo-Scope Canopy's Data Model (Multi-Repo Foundation) — Design

**Date:** 2026-07-10
**Status:** Design (part of the multi-tenant developer-SaaS roadmap — Phase 2 of 5).

## Goal

Make canopy hold and serve **multiple repositories'** context, isolated per repo, **without
breaking the currently-deployed single-repo behavior** (memo-sphere.com's dev sphere reads
`/docs`, `/roadmap`, `/feed`, … today and must keep working). This is the data-model
foundation for the multi-tenant product.

## Scope boundary

- **IN (Phase 2):** a `repos` registry; a `repo` dimension on every per-repo table; every
  **write** scoped to a repo; every **read** filtered by a repo; the **webhook** routing events
  to the right repo by `repository.full_name`; back-compat defaults so existing callers and the
  live dev sphere keep working (default to the sole registered repo).
- **OUT (Phase 3+):** per-user **access control** (which tenant may read/write which repo), the
  **GitHub App** + installation flow (users connecting *their own* repos), and the Mnemosphere
  **UI** showing multiple repos (Phase 4). Phase 2 delivers "several admin-registered repos,
  isolated data, events routed per repo." Phase 3 makes repos user-connected and access-controlled.

## Key decisions

1. **Repo identifier = TEXT `repo` = `"owner/name"`** (matches `GITHUB_REPO` and the webhook's
   `repository.full_name` — zero translation at boundaries; readable; the API uses it naturally).
   Denormalization is acceptable at canopy's scale.
2. **New `repos` registry table:** `repo TEXT PRIMARY KEY, added_at TEXT, added_by TEXT,
   installation_id INTEGER` (installation_id reserved for Phase 3's GitHub App). The migration
   **seeds the current `GITHUB_REPO`** as the first repo.
3. **Every per-repo table gains `repo TEXT NOT NULL`**, referencing `repos.repo`. The migration
   backfills existing rows to the seeded default repo.
4. **Uniqueness rescoping** (SQLite → create-new/copy/drop/rename where a key changes):
   - `docs`: PK `(slug)` → `(repo, slug)`.
   - `doc_versions`: its `(slug, version)` uniqueness → `(repo, slug, version)`.
   - `events`: `UNIQUE(semantic_key)` → `UNIQUE(repo, semantic_key)`.
   - `pr_summaries`: PK `(semantic_key)` → `(repo, semantic_key)`.
   - `issue_summaries`: PK `(issue_number)` → `(repo, issue_number)`.
   - `plan`: singleton (`id=1`) → **one row per repo**, PK `(repo)`.
   - `plan_versions`: `(version)` → `(repo, version)`.
   - `entry_tags`: if PK includes the entry key, extend with `repo`.
   - Simple `ADD COLUMN repo` (id-PK tables, no key change): `feed`, `adrs`, `needs_triage`,
     `milestones`, `milestone_proposals`, `milestone_progress`.
5. **Stays GLOBAL (not repo-scoped) in Phase 2:** `sections` + `tags` (shared controlled
   vocabulary — the gate's source of truth); `people` + `identity_tasks` (a GitHub login maps to
   the same person across repos); `processed_items` (replay ledger — session ids are globally
   unique and a session targets one repo); `users`/`sessions`/`mcp_tokens` (auth).
6. **Back-compat via a default repo.** Reads/writes accept an **optional** `repo`; when omitted,
   `defaultRepo(db)` returns the sole registered repo (there is exactly one today), so the
   deployed dev sphere and existing MCP/HTTP callers keep working unchanged. Once **>1** repo is
   registered, `defaultRepo` throws "ambiguous — specify a repo," forcing callers to pass one
   (the UI wires this in Phase 4; until then one repo Just Works).
7. **FTS** (docs/feed/adr in `0008`/`0011`; roadmap in `0013`) gains a `repo` column so search
   filters by repo (`… MATCH ? AND repo = ?`). Requires recreating the FTS tables + repopulating.

## Sub-phases (each an independently testable TDD cycle, committed)

- **2a — Schema.** Migrations: `repos` table (seed `GITHUB_REPO`), add `repo` to every per-repo
  table (backfill to the default), recreate tables/FTS where a key changes. Update `shared/rows.ts`
  + `defaultRepo(db)` helper in `db.ts`. **Deliverable:** schema supports `repo`; all existing data
  under the default repo; `npm test` green (existing queries still resolve one repo).
- **2b — Writes.** Thread `repo` through the gate (`consumer.ts`: all `ingest*` fns + `consume`)
  and `tools/writes.ts`; every dedup/lookup SELECT scopes by `repo`; the ingest entry points
  (`/ingest`, MCP `record_session` + per-entry write tools) accept an optional `repo` (default via
  `defaultRepo`). **Deliverable:** the same slug/semantic_key coexists across two repos.
- **2c — Reads.** Scope `tools/reads.ts` (query + FTS), `mywork`, `progress`, roadmap, and the HTTP
  read routes by `repo` (optional param, default via `defaultRepo`). **Deliverable:** reads return
  only the requested repo's data; search is repo-scoped.
- **2d — Webhook.** Resolve `repo` from `repository.full_name`; **ignore** deliveries for
  unregistered repos (logged, not error); `ingestEvent`/progress recompute run per repo.
  **Deliverable:** events from repo A land under A, from B under B.

## Error handling / edge cases

- **Unregistered repo** on a write/read → 400 "unknown repo"; on the webhook → ignored (logged).
- **`defaultRepo` ambiguity** once >1 repo exists → callers must specify; the deployed dev sphere
  keeps working while there is exactly one repo, and Phase 4 teaches the UI to send `repo`.
- **Migration safety on live D1:** backfill is a plain `UPDATE … SET repo = <default>`; table
  recreations copy every row before dropping. Ordered and idempotent (wrangler tracks applied
  migrations). Built + verified locally before any remote apply.

## Testing

- Migration: after apply, every per-repo table has `repo`; seed rows carry the default; `repos`
  has the seeded repo.
- Isolation (per sub-phase): two repos with the same slug/semantic_key coexist; reads/search do
  not bleed across repos; the webhook routes by `full_name`.
- `cd canopy && npm test` stays green throughout (existing tests exercise the default-repo path).

## Out of scope (later)

- Access control + the GitHub App + user-connected repos (Phase 3); multi-repo sphere UI (Phase 4).
