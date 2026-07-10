import type { Env } from "./env";

export type DB = D1Database;

/** Current time as an ISO8601 string. Allowed in the Workers runtime. */
export const nowIso = (): string => new Date().toISOString();

// The per-repo data tables that carry a `repo` column (migration 0020). Backfilled by
// bootstrapRepo. A hardcoded constant (never user input) — safe to interpolate below.
export const REPO_TABLES = [
  "docs", "doc_versions", "feed", "adrs", "entry_tags", "needs_triage",
  "milestones", "milestone_proposals", "events", "pr_summaries",
  "issue_summaries", "milestone_progress", "plan", "plan_versions",
] as const;

/** The repo a request targets when none is specified: the configured GITHUB_REPO.
 *  Single-repo deployments never pass a repo; multi-repo callers pass one explicitly. */
export function defaultRepo(env: Env): string {
  return (env.GITHUB_REPO ?? "").trim();
}

// Completes migration 0020's backfill at runtime (migrations can't read env): registers
// GITHUB_REPO in the `repos` registry and rewrites the transient `repo = ''` sentinel on
// any legacy rows to it. Idempotent and guarded to run at most once per isolate; on a
// pre-0020 DB (no repos table) it swallows the error and retries on a later request.
let _bootstrapped = false;
export function _resetBootstrapForTests(): void { _bootstrapped = false; }
export async function bootstrapRepo(env: Env, db: DB): Promise<void> {
  if (_bootstrapped) return;
  const repo = defaultRepo(env);
  if (!repo) { _bootstrapped = true; return; }
  try {
    const known = await first<{ x: number }>(db, `SELECT 1 AS x FROM repos WHERE repo = ?`, repo);
    if (!known) {
      await run(db, `INSERT OR IGNORE INTO repos (repo, added_at, added_by) VALUES (?, ?, ?)`, repo, nowIso(), "bootstrap");
      for (const t of REPO_TABLES) await run(db, `UPDATE ${t} SET repo = ? WHERE repo = ''`, repo);
    }
    _bootstrapped = true;
  } catch {
    // repos table not migrated yet (pre-0020) — leave the guard unset so a later
    // request (post-migration) retries. Best-effort; never breaks the request.
  }
}

/** First row of a query, or null. */
export async function first<T>(db: DB, query: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(query).bind(...params).first<T>()) ?? null;
}

/** All rows of a query (empty array if none). */
export async function all<T>(db: DB, query: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(query).bind(...params).all<T>();
  return results ?? [];
}

/** Run a write and return the D1 result (use res.meta.last_row_id for inserts). */
export async function run(db: DB, query: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(query).bind(...params).run();
}
