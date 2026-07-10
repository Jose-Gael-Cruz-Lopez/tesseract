# Phase 2 — Repo-Scope Canopy — Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-10-phase2-repo-scoping-design.md`. Executed inline,
> TDD, commit per sub-phase. Site line-numbers from the codebase map (2026-07-10).

**Status:** 2a DONE (commit f728e60). 2b–2d below.

## Global constraints
- `defaultRepo(env) = env.GITHUB_REPO`; callers omitting a repo get it (single-repo back-compat
  so memo-sphere.com's dev sphere keeps working while there is one repo).
- Writes use explicit-column INSERTs; `repo` is a plain column (no FK).
- `cd canopy && npm test` + `npx tsc -p tsconfig.worker.json --noEmit` stay green each sub-phase.
- Vocab (`sections`/`tags`), identity (`people`/`identity_tasks`), ledger (`processed_items`),
  auth tables stay global.

---

### 2a — Schema foundation ✅ DONE
`0020_repos.sql`, `repos` registry, `repo` column on 14 tables, `defaultRepo`/`bootstrapRepo`,
wired into fetch, `repo-scope.test.ts`. 449 tests green.

### 2b — Scope the WRITES + per-repo uniqueness

**Files:** `src/consumer.ts`, `src/tools/writes.ts`, `src/tools/plan.ts`, `src/tools/summarize.ts`,
`src/tools/progress.ts`, `src/routes.ts`, `src/mcp.ts`, `src/webhook.ts`, `src/tools/backfill.ts`,
`shared/rows.ts`; new migration `0021_repo_uniqueness.sql`; tests across `test/*`.

- [ ] **Signatures:** add `repo: string` to the 6 gate fns (`ingestFeedEntry/DocProposal/AdrDraft/
  MilestoneProposal/Event`, `consume`) and to the low-level writers in `writes.ts`
  (`append_feed`, `propose_doc_update`, `stage_adr`, `stage_milestone_proposal`, `route_triage`,
  `ensure_identity_task`) + `plan.ts write_plan`, `summarize.ts storePr/IssueSummary`,
  `progress.ts upsertProgress`. Promote/reject/ratify/complete/assign/resolve add `repo` to their
  WHERE clauses (scope the mutation to the repo).
- [ ] **Gate dedup SELECTs** (`consumer.ts:129,150,210,247`) gain `repo = ?`.
- [ ] **Entry points supply repo:** `/ingest` (`routes.ts:30`) + MCP `record_session` (`mcp.ts:146`)
  read an optional `repo` from the payload/args, default `defaultRepo(env)`; MCP `append_feed`/
  `propose_doc_update` (`mcp.ts:91,114`) an optional `repo` arg; `webhook.ts` resolves
  `payload.repository.full_name`; `backfill.ts` uses `env.GITHUB_REPO`. `IngestPayload`
  (`shared/contract.ts`) gains an optional `repo`.
- [ ] **Uniqueness migration `0021`** (create-new/copy/drop/rename, FK-safe order):
  `docs` PK → `(repo, slug)`; `doc_versions` FK/uniqueness → `(repo, slug, version)`; `events`
  UNIQUE → `(repo, semantic_key)`; `pr_summaries` PK/FK → `(repo, semantic_key)`;
  `issue_summaries` PK → `(repo, issue_number)`; `plan` (drop `CHECK(id=1)`) → PK `(repo)`;
  `plan_versions` → `(repo, version)`; `entry_tags` PK → `(repo, tag, entry_type, entry_id)`.
  Recreate the FTS **triggers** dropped with `docs`/`plan`/`milestones` recreation (re-run the
  `0011`/`0013` trigger blocks). Add `repo` to `shared/rows.ts` row types as each is touched.
- [ ] **Plan singleton → per-repo** (`plan.ts:45,47,90,116` + `reads.ts:359,419`): key by `repo`,
  and `write_plan`/`get_plan`'s unfiltered `SELECT … FROM milestones` (`plan.ts:86,117`) filter `repo`.
- [ ] **Tests:** update every gate/writer call site to pass a repo; add isolation tests (same
  slug + same `gh:pr:42` semantic_key coexist across two repos). `npm test` green. Commit.

### 2c — Scope the READS

**Files:** `src/tools/reads.ts`, `src/tools/mywork.ts`, `src/tools/progress.ts`, `src/tools/plan.ts`,
`src/routes.ts`, `src/mcp.ts`; tests.

- [ ] Every read fn takes an optional `repo` (default `defaultRepo(env)`) and filters base-table
  queries by `repo` (`reads.ts` list/get/hydrate; `mywork.ts` event joins; `progress.ts` reads;
  `plan.ts get_plan`). HTTP read routes + MCP read tools thread the repo through.
- [ ] **FTS search:** `docs` FTS adds `docs.repo = ?` to its existing join clause; `feed`/`adrs`/
  `roadmap` FTS add a base-table `JOIN … WHERE base.repo = ?` (no FTS schema change — the map
  confirmed a join is viable). Roadmap `plan` FTS row keyed per-repo.
- [ ] **Tests:** reads/search return only the requested repo. `npm test` green. Commit.

### 2d — Webhook per-repo routing

**Files:** `src/webhook.ts`, `src/tools/progress.ts`, `src/index.ts`; tests.

- [ ] `eventsFromDelivery` (`webhook.ts:117`) reads `payload.repository.full_name`; a delivery for
  an **unregistered** repo is ignored (logged, 200 no-op); events ingested under that repo.
- [ ] `scheduled()` progress recompute (`index.ts:47`) iterates registered repos.
- [ ] **Tests:** events from repo A vs B land under A vs B; unknown repo ignored. `npm test` green. Commit.

### Deploy note (per sub-phase touching schema)
Apply the new migration to **remote D1** (`npm run db:migrate:remote`) BEFORE the code auto-deploys
(Workers Builds runs `wrangler deploy`, not migrations). 2a's `bootstrapRepo` is pre-migration-safe
(swallows the missing-table error); 2b's recreations are not — migrate remote first.
