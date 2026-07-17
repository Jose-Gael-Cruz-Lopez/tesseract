-- Abuse controls for the open-login surface (issue #21): fixed-window rate-limit
-- counters + auth-failure lockout state, read/written by src/auth/rate-limit.ts.
-- Keyed by "<policy>:<client>" (client = IP or login) — origin-level control state,
-- NOT tenant data, so no `repo` column (the same class as sessions / mcp_tokens).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,          -- "<policy>:<client>"
  window_start INTEGER NOT NULL, -- epoch ms the current fixed window began
  count INTEGER NOT NULL         -- hits recorded in the current window
);
CREATE TABLE auth_failures (
  key TEXT PRIMARY KEY,          -- "<policy>:<client>"
  failures INTEGER NOT NULL,     -- failures recorded in the current window
  window_start INTEGER NOT NULL, -- epoch ms of the first failure in the window
  locked_until INTEGER           -- epoch ms the lockout ends; NULL/past = not locked
);
