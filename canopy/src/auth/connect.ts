import { all, type DB, run } from "../db";
import type { Env } from "../env";
import { appJwt, ghGetAll, installationToken } from "./app";
import { invalidateAccess } from "./access";

// Connect-your-repos: keep the `installations` + `repos` tables in sync with GitHub App
// installation lifecycle. Mostly driven by the webhook payload (which carries the account
// + repo list); the one place that needs a GitHub round-trip is a repo-selection change,
// where the payload delta is provably incomplete (issue #33 — see
// `reconcileInstallationRepos`). Removal is a soft-disconnect (repos.status), never a
// delete — data survives and reconnect restores.

interface InstallationEventPayload {
  action?: string;
  installation?: { id: number; account?: { login: string; type: string } };
  repositories?: Array<{ full_name: string }>;
  repositories_added?: Array<{ full_name: string }>;
  repositories_removed?: Array<{ full_name: string }>;
  sender?: { login: string };
}

/** Upsert an installation row (account + suspension state). */
export async function recordInstallation(
  db: DB,
  inst: { id: number; account_login: string; account_type: string },
  now: string,
  suspendedAt: string | null = null
): Promise<void> {
  await run(
    db,
    `INSERT INTO installations (installation_id, account_login, account_type, created_at, suspended_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       suspended_at = excluded.suspended_at`,
    inst.id,
    inst.account_login,
    inst.account_type,
    now,
    suspendedAt
  );
}

/** Mark repos connected under an installation (upsert; reconnect flips status back). */
export async function connectRepos(db: DB, installationId: number, repos: string[], addedBy: string | null, now: string): Promise<void> {
  for (const repo of repos) {
    await run(
      db,
      `INSERT INTO repos (repo, added_at, added_by, installation_id, status)
       VALUES (?, ?, ?, ?, 'connected')
       ON CONFLICT(repo) DO UPDATE SET installation_id = excluded.installation_id, status = 'connected'`,
      repo,
      now,
      addedBy,
      installationId
    );
  }
}

/** Soft-disconnect repos (status only — the row + its captured data remain). */
export async function disconnectRepos(db: DB, repos: string[]): Promise<void> {
  for (const repo of repos) {
    await run(db, `UPDATE repos SET status = 'disconnected' WHERE repo = ?`, repo);
  }
}

export interface InstallationEventResult {
  handled: boolean;
  /** `installation_repositories` only: did the authoritative reconcile run to completion? */
  reconciled?: boolean;
  /** `installation_repositories` only: how many repos that reconcile soft-disconnected. */
  disconnected?: number;
}

/**
 * Apply an installation-family webhook (`installation` / `installation_repositories`)
 * to the connection tables. Returns `{ handled }` (false for actions we ignore).
 *
 * `env` + `opts` are here only for the `installation_repositories` reconcile, which is
 * the single branch that cannot trust the payload (issue #33); every other branch is
 * still pure payload → D1. `fetchImpl`/`nowSec` are injectable for tests.
 */
export async function handleInstallationEvent(
  env: Env,
  db: DB,
  eventName: string,
  payload: unknown,
  now: string,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<InstallationEventResult> {
  const p = payload as InstallationEventPayload;
  const inst = p.installation;
  if (!inst?.id) return { handled: false };
  const sender = p.sender?.login ?? null;
  const account = inst.account;

  if (eventName === "installation") {
    switch (p.action) {
      case "created":
        if (account) await recordInstallation(db, { id: inst.id, account_login: account.login, account_type: account.type }, now);
        await connectRepos(db, inst.id, (p.repositories ?? []).map((r) => r.full_name), sender, now);
        // The installer is about to look at their new hubs; without this their cached
        // access set (if any) keeps them out for up to the TTL (issue #39).
        if (sender) await invalidateAccess(db, sender);
        return { handled: true };
      case "deleted":
        await run(db, `UPDATE repos SET status = 'disconnected' WHERE installation_id = ?`, inst.id);
        return { handled: true };
      case "suspend":
      case "unsuspend":
        if (account) {
          await recordInstallation(
            db,
            { id: inst.id, account_login: account.login, account_type: account.type },
            now,
            p.action === "suspend" ? now : null
          );
        }
        return { handled: true };
      default:
        return { handled: false };
    }
  }

  if (eventName === "installation_repositories") {
    // The payload delta first: it costs no GitHub call, and it is ALL we have when the
    // App isn't configured. Then reconcile against the authoritative list — the only
    // thing that catches an all→selected narrowing, whose delta is empty by design.
    await connectRepos(db, inst.id, (p.repositories_added ?? []).map((r) => r.full_name), sender, now);
    await disconnectRepos(db, (p.repositories_removed ?? []).map((r) => r.full_name));
    const rec = await reconcileInstallationRepos(env, db, inst.id, sender, now, opts);
    // Whoever changed the selection is the person about to reload the UI. Their cached
    // access set was written BEFORE this change, so without dropping it a re-added repo
    // stays 404 for up to the TTL while GET /me/repos already lists it — the confusing
    // split state observed in production (issue #39). Scoped to the sender: a revoked
    // repo is denied promptly by the `status = 'connected'` check regardless of cache,
    // so nobody else is left holding a wrong answer worth a cache-wide flush.
    if (sender) await invalidateAccess(db, sender);
    return { handled: true, reconciled: rec.reconciled, disconnected: rec.disconnected.length };
  }

  return { handled: false };
}

/**
 * Sync one installation directly from the GitHub App API (not a webhook payload): the
 * install callback lands the user here with only an `installation_id`, so we read the
 * account via the App JWT and the repo list via an installation token, then upsert both
 * tables. The webhook stays the durable source of truth — this just makes the connection
 * appear immediately after install. `fetchImpl`/`nowSec` are injectable for tests.
 *
 * The repo list is FULLY paginated (`ghGetAll`) and all-or-nothing: any failed page
 * throws instead of returning a prefix. That is what makes the returned list safe to
 * treat as authoritative — see `reconcileInstallationRepos` (issue #33).
 */
export async function syncInstallationFromApp(
  env: Env,
  db: DB,
  installationId: number,
  addedBy: string | null,
  now: string,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<{ repos: string[] }> {
  const doFetch = opts?.fetchImpl ?? fetch;

  // Account (login + type) is an App-level read, authed by the short-lived App JWT.
  const jwt = await appJwt(env, opts?.nowSec);
  const instRes = await doFetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "canopy" },
  });
  if (!instRes.ok) throw new Error(`installation lookup failed for ${installationId}: ${instRes.status}`);
  const { account } = (await instRes.json()) as { account: { login: string; type: string } };
  await recordInstallation(db, { id: installationId, account_login: account.login, account_type: account.type }, now);

  // Repo list is an installation-scoped read, authed by a minted installation token.
  const token = await installationToken(env, installationId, opts);
  const repositories = await ghGetAll<{ full_name: string }>(doFetch, "/installation/repositories", token, "repositories");
  const names = repositories.map((r) => r.full_name);
  await connectRepos(db, installationId, names, addedBy, now);

  return { repos: names };
}

/**
 * Reconcile one installation's connection rows against the AUTHORITATIVE repo list
 * GitHub reports for it: anything still `status='connected'` under this
 * `installation_id` but absent from that list is soft-disconnected.
 *
 * Why the webhook delta isn't enough: narrowing an installation from "All repositories"
 * to "Only select repositories" arrives as `action: "added"` with an EMPTY
 * `repositories_removed` — under "all" GitHub never held an explicit list to remove
 * FROM. So the delta flipped nothing and every de-scoped repo stayed `connected`
 * forever, feeding the 6-hourly `recomputeConnectedRepos` a token mint that can no
 * longer succeed (issue #33).
 *
 * SAFETY — this is the destructive direction, so it fires ONLY on a list we can prove
 * is complete. "Absent from the list" is only evidence of de-scoping if the list is
 * whole; on a truncated one it means "past the truncation point", which would take out
 * every repo after page 1. Three guards, in order:
 *   1. `syncInstallationFromApp` pages through `ghGetAll`, which accumulates in memory
 *      and throws on the first non-2xx — we get the WHOLE list or an exception, never a
 *      prefix, and nothing partial ever reaches D1.
 *   2. Any throw at all (App unconfigured, token mint, account read, any page) is caught
 *      here and disconnects NOTHING. A failed reconcile is a no-op, never a partial one.
 *   3. An empty list is refused: it is indistinguishable from a 200 whose body we
 *      couldn't read, and "this installation sees zero repos" is what `installation.
 *      deleted` legitimately means — not what a repo-selection change means.
 * Returns the repos it actually disconnected (always empty when it refused).
 */
export async function reconcileInstallationRepos(
  env: Env,
  db: DB,
  installationId: number,
  addedBy: string | null,
  now: string,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<{ reconciled: boolean; disconnected: string[] }> {
  let authoritative: string[];
  try {
    ({ repos: authoritative } = await syncInstallationFromApp(env, db, installationId, addedBy, now, opts));
  } catch {
    return { reconciled: false, disconnected: [] }; // guard 2
  }
  if (authoritative.length === 0) return { reconciled: false, disconnected: [] }; // guard 3

  // Scoped to this installation: another tenant's rows are never in the comparison set,
  // so one install's repo-selection change can't touch another's hubs.
  const connected = await all<{ repo: string }>(
    db,
    `SELECT repo FROM repos WHERE installation_id = ? AND status = 'connected'`,
    installationId
  );
  const reachable = new Set(authoritative);
  const gone = connected.map((r) => r.repo).filter((repo) => !reachable.has(repo));
  await disconnectRepos(db, gone); // status only — rows and captured data stay
  return { reconciled: true, disconnected: gone };
}
