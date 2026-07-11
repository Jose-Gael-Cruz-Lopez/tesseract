-- 0025_user_tokens.sql — Phase 3 (GitHub App / connect-your-repos): stores the
-- user-to-server token (+ refresh) so repoGate can refresh a user's access set
-- without re-auth.

CREATE TABLE user_tokens (
  login TEXT PRIMARY KEY,          -- the GitHub user
  token TEXT NOT NULL,             -- the current user-to-server access token
  refresh_token TEXT,              -- to mint a fresh token near expiry; NULL if the App doesn't issue one
  expires_at TEXT,                 -- ISO8601 access-token expiry; NULL = non-expiring
  updated_at TEXT NOT NULL         -- when this row was last written
);
