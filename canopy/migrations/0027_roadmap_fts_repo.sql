-- 0027_roadmap_fts_repo.sql — Fix #11: roadmap_fts stops being a single global
-- last-writer index. It gains a `repo` column (own-content FTS5, exactly like
-- 0022 did for docs_fts) so query()'s roadmap FTS pass can scope the MATCH
-- itself by repo, instead of relying only on a post-hoc join-back.
--
-- Two row shapes change:
--   * milestone rows keep their ref ('milestone:<id>' — milestones.id stays a
--     global PK across repos, per 0023, so the ref alone is still unique) and
--     simply carry milestones.repo as a new column.
--   * the plan-narrative row stops being the single shared ref='plan' row
--     (last-writer-wins across repos — the bug: each repo's write_plan
--     overwrote the one global row) and becomes ref='plan:<repo>', one row
--     per repo — mirroring the 'milestone:<id>' scheme so two repos'
--     narratives never collide in the index, each carrying repo as a column too.
--
-- `plan` / `milestones` are NOT recreated here (their repo columns already
-- exist — 0020, backfilled; PK(repo) on plan since 0023) — only roadmap_fts
-- and its four sync triggers. Dropping the virtual table does NOT drop
-- triggers defined ON plan/milestones (a trigger's lifetime is tied to its
-- base table, not to tables it references in its body), so the old trigger
-- bodies must be dropped explicitly before recreating them against the new
-- column shape — otherwise CREATE TRIGGER below would collide on the name.
--
-- D1 EXPORT CAVEAT (carried over from 0013): `wrangler d1 export` cannot dump
-- a database containing virtual tables — DROP the *_fts tables, export, then
-- recreate (re-applying this migration's CREATE + backfill).

DROP TRIGGER roadmap_fts_milestone_ai;
DROP TRIGGER roadmap_fts_milestone_au;
DROP TRIGGER roadmap_fts_milestone_ad;
DROP TRIGGER roadmap_fts_plan_au;
DROP TABLE roadmap_fts;

CREATE VIRTUAL TABLE roadmap_fts USING fts5(
  ref UNINDEXED, repo UNINDEXED, title, body, tokenize = 'porter unicode61');

-- ── milestone triggers (delete-then-insert keyed on the synthetic ref) ────────
CREATE TRIGGER roadmap_fts_milestone_ai AFTER INSERT ON milestones BEGIN
  DELETE FROM roadmap_fts WHERE ref = 'milestone:' || new.id;
  INSERT INTO roadmap_fts (ref, repo, title, body)
    VALUES ('milestone:' || new.id, new.repo, new.title,
            COALESCE(new.description, '') || ' ' || COALESCE(new.phase, '') || ' ' || COALESCE(new.status, ''));
END;

CREATE TRIGGER roadmap_fts_milestone_au AFTER UPDATE OF title, description, phase, status ON milestones BEGIN
  DELETE FROM roadmap_fts WHERE ref = 'milestone:' || new.id;
  INSERT INTO roadmap_fts (ref, repo, title, body)
    VALUES ('milestone:' || new.id, new.repo, new.title,
            COALESCE(new.description, '') || ' ' || COALESCE(new.phase, '') || ' ' || COALESCE(new.status, ''));
END;

CREATE TRIGGER roadmap_fts_milestone_ad AFTER DELETE ON milestones BEGIN
  DELETE FROM roadmap_fts WHERE ref = 'milestone:' || old.id;
END;

-- ── plan trigger (per-repo now: ref carries the repo, like 'milestone:<id>') ──
-- Row-level trigger: fires once per row touched by the UPDATE (with its OWN
-- new.repo), so the harness's blanket `UPDATE plan SET narrative=''` (no
-- WHERE — resets every repo's row at once) still cascades correctly: one
-- DELETE-then-conditional-INSERT per repo, not a single global one.
CREATE TRIGGER roadmap_fts_plan_au AFTER UPDATE OF narrative ON plan BEGIN
  DELETE FROM roadmap_fts WHERE ref = 'plan:' || new.repo;
  INSERT INTO roadmap_fts (ref, repo, title, body)
    SELECT 'plan:' || new.repo, new.repo, 'Roadmap plan', new.narrative WHERE new.narrative != '';
END;

-- ── backfill existing rows (repo-carrying) ───────────────────────────────────
INSERT INTO roadmap_fts (ref, repo, title, body)
  SELECT 'milestone:' || id, repo, title,
         COALESCE(description, '') || ' ' || COALESCE(phase, '') || ' ' || COALESCE(status, '')
    FROM milestones;
INSERT INTO roadmap_fts (ref, repo, title, body)
  SELECT 'plan:' || repo, repo, 'Roadmap plan', narrative FROM plan WHERE narrative != '';
