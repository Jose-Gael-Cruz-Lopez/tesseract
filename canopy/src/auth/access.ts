import { type DB, first, run, nowIso } from "../db";
import type { AccessibleRepo } from "./app";

// The repo-access authorization behind repoGate: is this user allowed to see a repo's
// hub, and with push (admin)? Answered from the `repo_access` cache, refreshed from
// GitHub on a TTL via an injected `refresh` (accessibleRepos(userToken)). A hub is
// visible iff the repo is CONNECTED and the user is a collaborator.

const DEFAULT_TTL_SEC = 300; // 5 min

// Replace this user's cached access set with a fresh snapshot — upserts the reachable
// repos and drops any they've lost (revocation propagates on the next check).
async function syncAccess(db: DB, login: string, repos: AccessibleRepo[], now: string): Promise<void> {
  await run(db, `DELETE FROM repo_access WHERE login = ?`, login);
  for (const r of repos) {
    await run(
      db,
      `INSERT INTO repo_access (login, repo, can_push, checked_at) VALUES (?, ?, ?, ?)`,
      login,
      r.repo,
      r.can_push ? 1 : 0,
      now
    );
  }
}

/**
 * Authorize `login` for `repo`'s hub. Returns `allowed` (connected + collaborator) and
 * `canPush` (admin: plan/promote). The user's access set is refreshed from GitHub when
 * its cache is older than the TTL (MAX(checked_at) drives both positive and negative
 * caching, so probing an inaccessible repo doesn't re-hit GitHub every request).
 */
export async function authorizeRepo(
  db: DB,
  login: string,
  repo: string,
  refresh: () => Promise<AccessibleRepo[]>,
  opts?: { ttlSec?: number; now?: string }
): Promise<{ allowed: boolean; canPush: boolean }> {
  const now = opts?.now ?? nowIso();
  const ttlMs = (opts?.ttlSec ?? DEFAULT_TTL_SEC) * 1000;

  // Only connected repos have hubs.
  const connected = await first<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM repos WHERE repo = ? AND status = 'connected'`,
    repo
  );
  if (!connected) return { allowed: false, canPush: false };

  // Refresh the user's whole access set if the cache is stale (or absent).
  const last = await first<{ m: string | null }>(db, `SELECT MAX(checked_at) AS m FROM repo_access WHERE login = ?`, login);
  const fresh = last?.m != null && Date.parse(now) - Date.parse(last.m) < ttlMs;
  if (!fresh) await syncAccess(db, login, await refresh(), now);

  const row = await first<{ can_push: number }>(
    db,
    `SELECT can_push FROM repo_access WHERE login = ? AND repo = ?`,
    login,
    repo
  );
  return { allowed: row != null, canPush: row?.can_push === 1 };
}
