import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recomputeConnectedRepos, recomputeAllProgress } from "../src/tools/progress";
import { run, first, nowIso } from "../src/db";
import type { MilestoneProgressRow } from "@shared/rows";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { createSession } from "../src/auth/session";
import { hmacSeal } from "../src/auth/crypto";

// Task 9: retire the single app-level GITHUB_SERVICE_TOKEN in favor of per-connected-repo
// GitHub App installation tokens for the scheduled progress recompute + the admin backfill.
// GitHub I/O (installationToken + fetch) is dependency-injected throughout — none of this
// touches the network or needs a real GITHUB_APP_PRIVATE_KEY.

describe("recomputeConnectedRepos", () => {
  it("mints an installation token per connected repo (no GITHUB_SERVICE_TOKEN)", async () => {
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/a', ?, 'x', 11, 'connected')`, nowIso());
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/b', ?, 'x', 22, 'connected')`, nowIso());
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/c', ?, 'x', 33, 'disconnected')`, nowIso());
    const minted: number[] = [];
    await recomputeConnectedRepos(env.DB, env, {
      installationTokenImpl: async (_env, id) => { minted.push(id); return `tok-${id}`; },
      fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }), // GitHub calls stubbed empty
    });
    expect(minted.sort()).toEqual([11, 22]); // disconnected repo skipped
  });

  it("never mints a token for a connected repo with no installation_id (pre-App grandfather row)", async () => {
    // bootstrapRepo seeds the single-tenant repo as status='connected' with NO
    // installation_id (it predates the GitHub App) — this must never reach mint().
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/legacy', ?, 'bootstrap', NULL, 'connected')`, nowIso());
    const minted: number[] = [];
    await recomputeConnectedRepos(env.DB, env, {
      installationTokenImpl: async (_env, id) => { minted.push(id); return `tok-${id}`; },
    });
    expect(minted).toEqual([]);
  });
});

describe("POST /r/:owner/:repo/admin/backfill (push-gated hub route)", () => {
  const LOGIN = "octocat";
  const REPO = "octo/hub-backfill";

  async function cookieFor(login: string): Promise<string> {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
    ).bind(login, login, "2026-01-01T00:00:00Z").run();
    const { id } = await createSession(env.DB, login);
    return `session=${await hmacSeal(id, "test-cookie-secret")}`;
  }

  async function connect(repo: string, installationId: number | null): Promise<void> {
    await run(
      env.DB,
      `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, 'x', ?, 'connected')`,
      repo,
      nowIso(),
      installationId
    );
  }

  beforeEach(() => { _resetHubTestHooks(); });
  afterEach(() => { _resetHubTestHooks(); });

  it("403s without push access — never reaches runBackfill", async () => {
    await connect(REPO, 88);
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: false }]; // read-only collaborator
    const res = await app.request(
      `/r/octo/hub-backfill/admin/backfill`,
      { method: "POST", headers: { cookie: await cookieFor(LOGIN) } },
      env
    );
    expect(res.status).toBe(403);
  });

  it("push-authorized: reaches runBackfill scoped to repoOf(c) — proven by the installation-mint failure text, not a generic/wrong-repo error", async () => {
    await connect(REPO, 88);
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(
      `/r/octo/hub-backfill/admin/backfill`,
      { method: "POST", headers: { cookie: await cookieFor(LOGIN) } },
      env
    );
    // The route passes no fetchImpl/installationTokenImpl (it's a real HTTP surface),
    // and GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY are unset in tests, so runBackfill's
    // mint() throws — caught, and 503s with THIS specific message. Had repoOf(c) been
    // wired wrong (e.g. an unconnected repo), the error would instead be "repo not
    // connected or has no installation" — the distinct text proves the route found
    // REPO's own connected+installed row before failing at the (out-of-scope-here)
    // token mint, i.e. proves the wiring without touching the network.
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("installation token mint failed");
  });

  it("404s an unconnected repo (repoGate denies before requirePush even runs)", async () => {
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }]; // reachable on GitHub, but never connected
    const res = await app.request(
      `/r/octo/hub-backfill/admin/backfill`,
      { method: "POST", headers: { cookie: await cookieFor(LOGIN) } },
      env
    );
    expect(res.status).toBe(404);
  });
});

// The multi-tenant isolation boundary for the progress recompute. recomputeAllProgress
// is handed ONE repo's installation token, so it must only ever read + write THAT repo's
// milestones — a milestone belonging to another connected repo must never be selected,
// fetched (against the wrong repo's GitHub URL), or have its cached progress overwritten.
describe("recompute isolation — one repo's recompute never touches another's milestones", () => {
  // milestones column shape copied from progress.test.ts's seedMilestone, with `repo`.
  async function seedMilestone(repo: string, githubRef: string, title = "M"): Promise<number> {
    const res = await run(
      env.DB,
      `INSERT INTO milestones (repo, title, target_date, status, github_ref, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      repo, title, "2026-08-01", "in_progress", githubRef, nowIso(), "tester"
    );
    return res.meta.last_row_id as number;
  }

  async function connect(repo: string, installationId: number): Promise<void> {
    await run(
      env.DB,
      `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, 'x', ?, 'connected')`,
      repo, nowIso(), installationId
    );
  }

  it("recomputeAllProgress(repo:'o/a') writes o/a's milestone progress and leaves o/b's UNTOUCHED (the regression: drop `repo = ?` and this fails)", async () => {
    const idA = await seedMilestone("o/a", "5", "A"); // github_ref 5 → GET /repos/o/a/milestones/5
    const idB = await seedMilestone("o/b", "9", "B"); // github_ref 9 → GET /repos/o/b/milestones/9

    // A repo-BLIND fetch stub keyed ONLY on the milestone number (not the repo path
    // segment). This is deliberate and load-bearing: if recomputeAllProgress's query
    // were unscoped, the o/a recompute would ALSO select o/b's milestone (#9) and fetch
    // it as GET /repos/o/a/milestones/9 — which this stub happily answers with real
    // counts, writing a bogus milestone_progress row for o/b. A repo-sensitive stub that
    // 404'd the wrong-repo URL would MASK the bug (the stray fetch would just skip), so
    // the negative below would pass even when broken. Blind-by-number is what makes the
    // isolation assertion a true regression test.
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/milestones/5")) return new Response(JSON.stringify({ open_issues: 2, closed_issues: 8 }), { status: 200 });
      if (u.endsWith("/milestones/9")) return new Response(JSON.stringify({ open_issues: 1, closed_issues: 3 }), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await recomputeAllProgress(env.DB, { token: "tok-a", repo: "o/a", fetchImpl });
    expect(result.updated).toBe(1); // ONLY o/a's milestone — not o/b's (unscoped would be 2)

    // POSITIVE: o/a's milestone got its progress row written (closed_issues 8, open+closed 10).
    const rowA = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idA);
    expect(rowA).toMatchObject({ closed: 8, total: 10, source: "recompute" });

    // ISOLATION (the real negative): o/b's milestone was never selected → no cache row.
    const rowB = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idB);
    expect(rowB).toBeNull();
  });

  it("recomputeConnectedRepos writes EACH connected repo's progress via its OWN installation token", async () => {
    const idA = await seedMilestone("o/a", "5", "A");
    const idB = await seedMilestone("o/b", "9", "B");
    await connect("o/a", 11);
    await connect("o/b", 22);

    // Repo-SENSITIVE fetch that also records which bearer token hit which repo, to
    // positively prove each repo is recomputed against ITS OWN URL with ITS OWN
    // installation token (11 → o/a, 22 → o/b) — never a shared/app-level one.
    const seen: Array<{ repo: string; token: string | null }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const m = u.match(/\/repos\/([^/]+\/[^/]+)\/milestones\/(\d+)/);
      if (!m) return new Response("not found", { status: 404 });
      const [, repo, num] = m;
      seen.push({ repo, token: new Headers(init?.headers).get("authorization") });
      if (repo === "o/a" && num === "5") return new Response(JSON.stringify({ open_issues: 2, closed_issues: 8 }), { status: 200 });
      if (repo === "o/b" && num === "9") return new Response(JSON.stringify({ open_issues: 1, closed_issues: 3 }), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await recomputeConnectedRepos(env.DB, env, {
      installationTokenImpl: async (_env, id) => `tok-${id}`,
      fetchImpl,
    });

    // POSITIVE: BOTH connected repos' progress rows written, each with its own distinct counts.
    const rowA = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idA);
    expect(rowA).toMatchObject({ closed: 8, total: 10, source: "recompute" });
    const rowB = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idB);
    expect(rowB).toMatchObject({ closed: 3, total: 4, source: "recompute" });

    // token → repo binding: o/a fetched with installation 11's token, o/b with 22's.
    expect(seen).toContainEqual({ repo: "o/a", token: "Bearer tok-11" });
    expect(seen).toContainEqual({ repo: "o/b", token: "Bearer tok-22" });
  });
});
