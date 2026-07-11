-- 0024_github_app.sql — Phase 3 (GitHub App / connect-your-repos): the data model
-- backing multi-tenant connections. `repos` gains a soft-disconnect status; a new
-- `installations` table tracks each GitHub App installation; `repo_access` caches
-- per-user repo access (the repoGate authorization) on a checked_at TTL.

-- Soft-disconnect: uninstall / repo-removal flips status to 'disconnected' (data
-- retained, hub hidden), restored to 'connected' on reconnect. Never a hard delete.
ALTER TABLE repos ADD COLUMN status TEXT NOT NULL DEFAULT 'connected';

-- One row per GitHub App installation: the account that installed + its lifecycle.
CREATE TABLE installations (
  installation_id INTEGER PRIMARY KEY,   -- GitHub's installation id
  account_login TEXT NOT NULL,           -- the user/org that installed the App
  account_type TEXT NOT NULL,            -- 'User' | 'Organization'
  created_at TEXT NOT NULL,
  suspended_at TEXT                      -- set when GitHub suspends the install; NULL = active
);

-- Per-user repo-access cache backing repoGate: refreshed from GitHub on a TTL so a
-- hub request is not a GitHub round-trip every time. can_push = admin (plan/promote).
CREATE TABLE repo_access (
  login TEXT NOT NULL,                   -- the GitHub user
  repo TEXT NOT NULL,                    -- "owner/name"
  can_push INTEGER NOT NULL DEFAULT 0,   -- 1 = push/admin access
  checked_at TEXT NOT NULL,              -- when last verified against GitHub (TTL)
  PRIMARY KEY (login, repo)
);
CREATE INDEX idx_repo_access_checked ON repo_access(checked_at);
