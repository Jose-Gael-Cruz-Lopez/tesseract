import { type DB, run } from "../db";

// Connect-your-repos: keep the `installations` + `repos` tables in sync with GitHub App
// installation lifecycle. Driven entirely by the webhook payload (which carries the
// account + repo list), so no GitHub round-trip is needed here. Removal is a
// soft-disconnect (repos.status), never a delete — data survives and reconnect restores.

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

/**
 * Apply an installation-family webhook (`installation` / `installation_repositories`)
 * to the connection tables. Returns `{ handled }` (false for actions we ignore).
 */
export async function handleInstallationEvent(db: DB, eventName: string, payload: unknown, now: string): Promise<{ handled: boolean }> {
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
    await connectRepos(db, inst.id, (p.repositories_added ?? []).map((r) => r.full_name), sender, now);
    await disconnectRepos(db, (p.repositories_removed ?? []).map((r) => r.full_name));
    return { handled: true };
  }

  return { handled: false };
}
