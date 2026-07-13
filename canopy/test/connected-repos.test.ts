import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { listAccessibleConnectedRepos } from "../src/tools/connected";
import { run, nowIso } from "../src/db";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";
import type { Env } from "../src/env";

const LOGIN = "alice";

describe("listAccessibleConnectedRepos", () => {
  it("returns the intersection of GitHub-accessible and connected repos, enforcing the collaborator boundary from the GitHub side", async () => {
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/a', ?, ?, 1, 'connected')`, nowIso(), LOGIN);
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/b', ?, ?, 1, 'disconnected')`, nowIso(), LOGIN);
    // octo/d is CONNECTED in the DB but NOT GitHub-accessible (absent from listRepos below).
    // This is the security-critical MIRROR axis: accessibleRepos is the collaborator boundary,
    // so a connected-but-unreachable repo must be excluded. If a refactor ever iterated the
    // `connected` DB set instead of filtering `reachable`, octo/d's hub would leak to a
    // non-collaborator — this asserts it does not.
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/d', ?, ?, 1, 'connected')`, nowIso(), LOGIN);
    // octo/c is accessible on GitHub but NOT connected → excluded (the other axis).
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, {
      getToken: async () => "tok",
      listRepos: async () => [{ repo: "octo/a", can_push: true }, { repo: "octo/b", can_push: false }, { repo: "octo/c", can_push: true }],
    });
    expect(out).toEqual([{ repo: "octo/a", can_push: true }]); // b disconnected, c not connected, d not GitHub-accessible
    expect(out.some((r) => r.repo === "octo/d")).toBe(false); // connected-but-inaccessible never leaks (collaborator boundary)
  });

  it("is empty when the user has no token", async () => {
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, { getToken: async () => null, listRepos: async () => [] });
    expect(out).toEqual([]);
  });

  it("does NOT swallow failures — it rejects so the route is the sole never-500 backstop", async () => {
    // The function propagates; only GET /me/repos' try/catch degrades to an empty list.
    await expect(
      listAccessibleConnectedRepos(env.DB, env, LOGIN, {
        getToken: async () => "tok",
        listRepos: async () => { throw new Error("github down"); },
      })
    ).rejects.toThrow("github down");
  });
});

// The real HTTP surface, wired through the flat session-gated app (no injected
// opts — exercises the actual getUserToken + repos-table wiring). Uses the shared
// authedCookie helper (test/helpers/session.ts).
describe("GET /me/repos (session-gated)", () => {
  it("401s without a session", async () => {
    const res = await app.request("/me/repos", {}, env);
    expect(res.status).toBe(401);
  });

  it("200s with an empty list + the configured appSlug when the user has no stored GitHub token (never 500s)", async () => {
    // No row in user_tokens for LOGIN → getUserToken resolves null → the real
    // (un-injected) route path short-circuits to an empty list without ever
    // reaching the network (accessibleRepos is never called).
    const res = await app.request("/me/repos", { headers: { cookie: await authedCookie(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: Array<{ repo: string; can_push: boolean }>; appSlug: string | null };
    expect(body.repos).toEqual([]);
    // cloudflare:test's env is typed via test/env.d.ts, which doesn't mirror GITHUB_APP_SLUG
    // (same cast precedent as roadmap.test.ts's buildCanopyMcpServer(env as unknown as Env, …)).
    expect(body.appSlug).toBe((env as unknown as Env).GITHUB_APP_SLUG ?? null); // wrangler.toml: "memo-sphere", confirmed non-null
  });
});
