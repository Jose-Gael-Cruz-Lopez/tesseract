-- 0020_repos.sql — Phase 2a: the repos registry + an additive `repo` column on every
-- per-repo table. The column is plain TEXT (NOT a foreign key) so existing
-- explicit-column INSERTs keep working unchanged. NOT NULL DEFAULT '' is a transient
-- sentinel: migrations can't read env, so bootstrapRepo(env, db) (src/db.ts) backfills
-- '' → GITHUB_REPO at runtime and seeds the registry. No PK/UNIQUE/FTS changes here —
-- per-repo uniqueness and scoped reads/writes land in the following sub-phases.

CREATE TABLE repos (
  repo TEXT PRIMARY KEY,             -- "owner/name"
  added_at TEXT NOT NULL,
  added_by TEXT,
  installation_id INTEGER            -- reserved for the Phase 3 GitHub App
);

ALTER TABLE docs                ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE doc_versions        ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE feed                ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE adrs                ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE entry_tags          ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE needs_triage        ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE milestones          ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE milestone_proposals ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE events              ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE pr_summaries        ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_summaries     ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE milestone_progress  ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE plan                ADD COLUMN repo TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_versions       ADD COLUMN repo TEXT NOT NULL DEFAULT '';

-- Indexes for the per-repo filters the read-scoping sub-phase adds.
CREATE INDEX idx_docs_repo ON docs(repo);
CREATE INDEX idx_feed_repo ON feed(repo);
CREATE INDEX idx_adrs_repo ON adrs(repo);
CREATE INDEX idx_events_repo ON events(repo);
CREATE INDEX idx_milestones_repo ON milestones(repo);
CREATE INDEX idx_needs_triage_repo ON needs_triage(repo);
