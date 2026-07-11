-- 0022_repo_uniqueness_docs.sql — Phase 2 (recreations, docs family).
-- docs.slug becomes per-repo so the SAME slug can exist in two repos. Order:
-- doc_versions first (it drops its old FK → docs(slug)), then docs, then the FTS
-- (rebuilt with a repo column + repo-keyed sync triggers so two repos' same-slug
-- docs never conflate in the index). The repo column already exists (0020, backfilled).

-- doc_versions: drop the FK→docs(slug) (app enforces the doc-before-version order);
-- id stays the PK. repo/slug are plain columns.
CREATE TABLE doc_versions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  confidence TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  content_hash TEXT,
  base_version INTEGER,
  change_kind TEXT,
  low_confidence INTEGER NOT NULL DEFAULT 0
);
INSERT INTO doc_versions_new (id, repo, slug, version, body, summary, status, confidence, created_at, created_by, content_hash, base_version, change_kind, low_confidence)
  SELECT id, repo, slug, version, body, summary, status, confidence, created_at, created_by, content_hash, base_version, change_kind, low_confidence FROM doc_versions;
DROP TABLE doc_versions;
ALTER TABLE doc_versions_new RENAME TO doc_versions;

-- docs: PK(slug) → PK(repo, slug). Dropping docs also drops its docs_fts_* triggers
-- (recreated below).
CREATE TABLE docs_new (
  repo TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  section TEXT NOT NULL REFERENCES sections(name),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT,
  space TEXT NOT NULL DEFAULT 'canopy',
  PRIMARY KEY (repo, slug)
);
INSERT INTO docs_new (repo, slug, section, title, body, current_version, updated_at, updated_by, space)
  SELECT repo, slug, section, title, body, current_version, updated_at, updated_by, space FROM docs;
DROP TABLE docs;
ALTER TABLE docs_new RENAME TO docs;
CREATE INDEX idx_docs_repo ON docs(repo);

-- docs_fts: rebuild with a repo column so sync + search distinguish repos. Standalone
-- FTS5 (own content), repopulated from the recreated docs, then repo-keyed triggers.
DROP TABLE docs_fts;
CREATE VIRTUAL TABLE docs_fts USING fts5(
  slug UNINDEXED, repo UNINDEXED, title, section UNINDEXED, body, tokenize = 'porter unicode61');
INSERT INTO docs_fts (slug, repo, title, section, body)
  SELECT slug, repo, title, section, body FROM docs;

CREATE TRIGGER docs_fts_ai AFTER INSERT ON docs BEGIN
  DELETE FROM docs_fts WHERE slug = new.slug AND repo = new.repo;
  INSERT INTO docs_fts (slug, repo, title, section, body)
    VALUES (new.slug, new.repo, new.title, new.section, new.body);
END;
CREATE TRIGGER docs_fts_ad AFTER DELETE ON docs BEGIN
  DELETE FROM docs_fts WHERE slug = old.slug AND repo = old.repo;
END;
CREATE TRIGGER docs_fts_au AFTER UPDATE OF title, section, body ON docs BEGIN
  DELETE FROM docs_fts WHERE slug = new.slug AND repo = new.repo;
  INSERT INTO docs_fts (slug, repo, title, section, body)
    VALUES (new.slug, new.repo, new.title, new.section, new.body);
END;
