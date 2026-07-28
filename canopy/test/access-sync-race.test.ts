import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { authorizeRepo } from "../src/auth/access";
import { all } from "../src/db";
import type { AccessibleRepo } from "../src/auth/app";

// Regression cover for the hub 500s found on 2026-07-28 running issue #9's e2e.
//
// Opening a hub makes the SPA fire several requests in parallel (me/dashboard,
// proposals, needs-triage, adrs). Each one runs repoGate → authorizeRepo, and on
// the first open after sign-in — or any time the 5-minute TTL has lapsed — they ALL
// see a stale cache and call syncAccess concurrently. syncAccess was a bare
// DELETE followed by a loop of plain INSERTs with no transaction, so the statements
// interleaved and a request inserted a (login, repo) pair another had already
// inserted → PRIMARY KEY violation (migration 0024) → uncaught D1 throw → 500.
//
// In production 3 of 4 parallel hub requests failed and the 4th succeeded. The whole
// existing suite missed it because it drives requests sequentially; the race needs
// genuine concurrency, which is exactly what a browser produces.

const LOGIN = "octocat";
const REPOS: AccessibleRepo[] = Array.from({ length: 12 }, (_, i) => ({
  repo: `acme/app-${i}`,
  can_push: i % 2 === 0,
}));

const connect = (repo: string) =>
  env.DB.prepare(`INSERT INTO repos (repo, added_at, status) VALUES (?, 'x', 'connected')`).bind(repo).run();

describe("authorizeRepo refreshes the access cache safely under concurrency", () => {
  it("survives parallel refreshes of a stale cache without throwing", async () => {
    await connect("acme/app-0");
    // Every caller sees an empty (therefore stale) cache and refreshes at once —
    // the exact shape of a hub open.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => authorizeRepo(env.DB, LOGIN, "acme/app-0", async () => REPOS))
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
  });

  it("leaves exactly one row per repo after concurrent refreshes", async () => {
    await connect("acme/app-1");
    await Promise.allSettled(
      Array.from({ length: 8 }, () => authorizeRepo(env.DB, LOGIN, "acme/app-1", async () => REPOS))
    );

    const rows = await all<{ repo: string; n: number }>(
      env.DB,
      `SELECT repo, COUNT(*) AS n FROM repo_access WHERE login = ? GROUP BY repo`,
      LOGIN
    );
    expect(rows).toHaveLength(REPOS.length);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it("still returns the correct decision for every concurrent caller", async () => {
    await connect("acme/app-2"); // can_push: true (even index)
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => authorizeRepo(env.DB, LOGIN, "acme/app-2", async () => REPOS))
    );
    // No caller may observe a transient "not allowed" caused by another's refresh
    // blowing the cache away mid-flight.
    expect(decisions).toEqual(Array.from({ length: 8 }, () => ({ allowed: true, canPush: true })));
  });

  it("still drops access the user has lost (revocation propagates)", async () => {
    await connect("acme/app-3");
    await authorizeRepo(env.DB, LOGIN, "acme/app-3", async () => REPOS);
    // Same login, narrower access set, cache forced stale via ttlSec 0.
    const after = await authorizeRepo(env.DB, LOGIN, "acme/app-3", async () => [{ repo: "acme/other", can_push: false }], {
      ttlSec: 0,
    });
    expect(after).toEqual({ allowed: false, canPush: false });
    const rows = await all<{ repo: string }>(env.DB, `SELECT repo FROM repo_access WHERE login = ?`, LOGIN);
    expect(rows.map((r) => r.repo)).toEqual(["acme/other"]);
  });
});
