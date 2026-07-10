-- 0021_repo_uniqueness_events.sql — Phase 2 (recreations, events family).
-- Rescope the event dedupe keys from global to per-repo so the SAME PR/issue number
-- can be captured in two repos at once. Recreation order matters: pr_summaries first
-- (it drops its old FK to events.semantic_key), THEN events, so no table references
-- events when it is dropped (works whether or not D1 enforces FKs in the migration).
-- The `repo` column already exists (0020, backfilled); the writers/reads already carry
-- repo, so NO application code changes are needed — only the constraints change.

-- pr_summaries: PK(semantic_key)+FK→events → PK(repo, semantic_key), FK dropped
-- (referential integrity is enforced by the app: the event lands before its summary).
CREATE TABLE pr_summaries_new (
  repo TEXT NOT NULL DEFAULT '',
  semantic_key TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  title TEXT, what TEXT, why TEXT, impact TEXT,
  PRIMARY KEY (repo, semantic_key)
);
INSERT INTO pr_summaries_new (repo, semantic_key, pr_number, model, created_at, title, what, why, impact)
  SELECT repo, semantic_key, pr_number, model, created_at, title, what, why, impact FROM pr_summaries;
DROP TABLE pr_summaries;
ALTER TABLE pr_summaries_new RENAME TO pr_summaries;

-- events: UNIQUE(semantic_key) → UNIQUE(repo, semantic_key). id stays the PK.
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL DEFAULT '',
  semantic_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ref_number INTEGER NOT NULL,
  subject_login TEXT NOT NULL,
  raw TEXT NOT NULL,
  provenance TEXT NOT NULL,
  occurred_at TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  UNIQUE (repo, semantic_key)
);
INSERT INTO events_new (id, repo, semantic_key, event_type, ref_number, subject_login, raw, provenance, occurred_at, recorded_at, recorded_by)
  SELECT id, repo, semantic_key, event_type, ref_number, subject_login, raw, provenance, occurred_at, recorded_at, recorded_by FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_repo ON events(repo);

-- issue_summaries: PK(issue_number) → PK(repo, issue_number).
CREATE TABLE issue_summaries_new (
  repo TEXT NOT NULL DEFAULT '',
  issue_number INTEGER NOT NULL,
  summary TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  title TEXT, next_step TEXT,
  PRIMARY KEY (repo, issue_number)
);
INSERT INTO issue_summaries_new (repo, issue_number, summary, model, created_at, title, next_step)
  SELECT repo, issue_number, summary, model, created_at, title, next_step FROM issue_summaries;
DROP TABLE issue_summaries;
ALTER TABLE issue_summaries_new RENAME TO issue_summaries;
