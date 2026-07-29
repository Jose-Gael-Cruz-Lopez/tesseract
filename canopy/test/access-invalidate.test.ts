import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { authorizeRepo, invalidateAccess } from "../src/auth/access";
import { handleInstallationEvent } from "../src/auth/connect";
import { run, all, nowIso } from "../src/db";
import type { Env } from "../src/env";
import type { AccessibleRepo } from "../src/auth/app";

// Issue #39: re-granting a repo took up to 5 minutes to restore its hub.
//
// authorizeRepo decides freshness from MAX(checked_at) across the login's WHOLE set.
// If the cache was refreshed *during* the disconnected window it correctly recorded
// "no access", and is then treated as fresh for the full TTL — so restoring access on
// GitHub's side changes nothing until the TTL lapses. Observed in production:
// GET /me/repos listed the repo again immediately while the hub route still 404'd.
//
// Note the asymmetry, which is why only re-granting is affected: authorizeRepo checks
// `repos.status = 'connected'` BEFORE consulting the cache, so REVOCATION is already
// prompt (#33/PR #35 makes that flip reliably). Only the regain path is stale.
//
// Also note why the invalidation must drop the login's ENTIRE set: deleting just the
// one (login, repo) row would leave MAX(checked_at) recent, so no refresh would fire
// and the missing row would simply read as denied — strictly worse than the bug.

const LOGIN = "octocat";
const REPO = "octo/hub";
const OTHER = "octo/other";

const connect = (repo: string, installationId = 1) =>
  run(
    env.DB,
    `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`,
    repo,
    nowIso(),
    LOGIN,
    installationId
  );

/** Seed a cache row as though it were written `now`. */
const seedAccess = (login: string, repo: string, checkedAt: string) =>
  run(
    env.DB,
    `INSERT OR REPLACE INTO repo_access (login, repo, can_push, checked_at) VALUES (?, ?, 1, ?)`,
    login,
    repo,
    checkedAt
  );

const cachedRepos = (login: string) =>
  all<{ repo: string }>(env.DB, `SELECT repo FROM repo_access WHERE login = ? ORDER BY repo`, login);

describe("invalidateAccess (issue #39)", () => {
  it("drops the whole set for one login and leaves other logins alone", async () => {
    await seedAccess(LOGIN, REPO, nowIso());
    await seedAccess(LOGIN, OTHER, nowIso());
    await seedAccess("someone-else", REPO, nowIso());

    await invalidateAccess(env.DB, LOGIN);

    expect(await cachedRepos(LOGIN)).toEqual([]);
    expect((await cachedRepos("someone-else")).map((r) => r.repo)).toEqual([REPO]);
  });

  it("is a no-op for a login with nothing cached", async () => {
    await expect(invalidateAccess(env.DB, "nobody")).resolves.toBeUndefined();
  });
});

describe("regaining access restores the hub without waiting for the TTL (issue #39)", () => {
  it("REPRODUCES the bug: a fresh cache recorded during the outage denies a re-granted repo", async () => {
    await connect(REPO);
    // The cache as it stands right after the disconnected window: fresh, and
    // correctly recording that the user could NOT reach REPO at the time.
    await seedAccess(LOGIN, OTHER, nowIso());

    let refreshed = false;
    const decision = await authorizeRepo(env.DB, LOGIN, REPO, async () => {
      refreshed = true;
      return [{ repo: REPO, can_push: true }, { repo: OTHER, can_push: true }] as AccessibleRepo[];
    });

    // The cache is fresh, so GitHub is never consulted and the regained repo is denied.
    expect(refreshed).toBe(false);
    expect(decision).toEqual({ allowed: false, canPush: false });
  });

  it("after invalidation the very next request re-fetches and allows", async () => {
    await connect(REPO);
    await seedAccess(LOGIN, OTHER, nowIso());

    await invalidateAccess(env.DB, LOGIN);

    let refreshed = false;
    const decision = await authorizeRepo(env.DB, LOGIN, REPO, async () => {
      refreshed = true;
      return [{ repo: REPO, can_push: true }, { repo: OTHER, can_push: true }] as AccessibleRepo[];
    });

    expect(refreshed).toBe(true); // MAX(checked_at) is null ⇒ stale ⇒ refresh
    expect(decision).toEqual({ allowed: true, canPush: true });
  });
});

describe("installation events invalidate the sender's cache (issue #39)", () => {
  const ENV = env as unknown as Env;

  it("installation_repositories clears the sender's cached set", async () => {
    await seedAccess(LOGIN, OTHER, nowIso());

    await handleInstallationEvent(
      ENV,
      env.DB,
      "installation_repositories",
      {
        action: "added",
        installation: { id: 1 },
        sender: { login: LOGIN },
        repositories_added: [{ full_name: REPO }],
      },
      nowIso()
    );

    expect(await cachedRepos(LOGIN)).toEqual([]);
  });

  it("installation.created clears it too — a fresh install must show its hubs at once", async () => {
    await seedAccess(LOGIN, OTHER, nowIso());

    await handleInstallationEvent(
      ENV,
      env.DB,
      "installation",
      {
        action: "created",
        installation: { id: 2, account: { login: LOGIN, type: "User" } },
        sender: { login: LOGIN },
        repositories: [{ full_name: REPO }],
      },
      nowIso()
    );

    expect(await cachedRepos(LOGIN)).toEqual([]);
  });

  it("leaves other users' caches intact — invalidation is scoped to the sender", async () => {
    await seedAccess("bystander", OTHER, nowIso());

    await handleInstallationEvent(
      ENV,
      env.DB,
      "installation_repositories",
      { action: "added", installation: { id: 1 }, sender: { login: LOGIN }, repositories_added: [{ full_name: REPO }] },
      nowIso()
    );

    expect((await cachedRepos("bystander")).map((r) => r.repo)).toEqual([OTHER]);
  });

  it("a payload with no sender does not throw", async () => {
    await expect(
      handleInstallationEvent(
        ENV,
        env.DB,
        "installation_repositories",
        { action: "added", installation: { id: 1 }, repositories_added: [{ full_name: REPO }] },
        nowIso()
      )
    ).resolves.toBeDefined();
  });
});
