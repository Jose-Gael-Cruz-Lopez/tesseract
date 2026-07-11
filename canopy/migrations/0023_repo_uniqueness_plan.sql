-- 0023_repo_uniqueness_plan.sql — Phase 2 (recreations, plan family).
-- The plan stops being a global singleton and becomes per-repo: each repo owns its
-- own narrative row and its own version history. Order: plan_versions first (its PK
-- widens; no FK either way), then plan (whose id=1 CHECK-singleton PK becomes
-- PK(repo) — dropping it also drops the roadmap_fts_plan_au trigger, recreated
-- below). The `repo` column already exists (0020, backfilled). milestones is NOT
-- recreated (its id stays a global PK); write_plan/get_plan scope it by repo via
-- idx_milestones_repo. The new PKs index `repo` themselves, so no extra index.

-- plan_versions: PK(version) → PK(repo, version) so two repos' version 1 coexist.
CREATE TABLE plan_versions_new (
  repo TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  narrative TEXT NOT NULL,
  milestones_json TEXT NOT NULL,       -- full milestones snapshot AFTER this write
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (repo, version)
);
INSERT INTO plan_versions_new (repo, version, narrative, milestones_json, created_at, created_by)
  SELECT repo, version, narrative, milestones_json, created_at, created_by FROM plan_versions;
DROP TABLE plan_versions;
ALTER TABLE plan_versions_new RENAME TO plan_versions;

-- plan: the `id INTEGER PRIMARY KEY CHECK (id = 1)` singleton becomes PK(repo).
-- Dropping plan also drops its roadmap_fts_plan_au trigger (recreated identically
-- below — it references only new.narrative, unaffected by the key change).
CREATE TABLE plan_new (
  repo TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT,
  PRIMARY KEY (repo)
);
INSERT INTO plan_new (repo, narrative, current_version, updated_at, updated_by)
  SELECT repo, narrative, current_version, updated_at, updated_by FROM plan;
DROP TABLE plan;
ALTER TABLE plan_new RENAME TO plan;

-- Recreate the plan-narrative FTS sync trigger dropped with the old table. It stays
-- keyed on the global ref 'plan' (single-repo-correct today — the storage above is
-- fully per-repo); per-repo FTS keying + a repo-scoped query() land with the
-- read-scoping sub-phase.
CREATE TRIGGER roadmap_fts_plan_au AFTER UPDATE OF narrative ON plan BEGIN
  DELETE FROM roadmap_fts WHERE ref = 'plan';
  INSERT INTO roadmap_fts (ref, title, body)
    SELECT 'plan', 'Roadmap plan', new.narrative WHERE new.narrative != '';
END;
