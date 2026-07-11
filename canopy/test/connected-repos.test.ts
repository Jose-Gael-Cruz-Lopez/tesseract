import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { listAccessibleConnectedRepos } from "../src/tools/connected";
import { run, nowIso } from "../src/db";
import { app } from "../src/routes";
import { createSession } from "../src/auth/session";
import { hmacSeal } from "../src/auth/crypto";
import type { Env } from "../src/env";

const LOGIN = "alice";

// Mirrors cookieFor in roadmap.test.ts / hub-routes.test.ts / dashboard-route.test.ts.
async function cookieFor(login: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
  ).bind(login, login, "2026-01-01T00:00:00Z").run();
  const { id } = await createSession(env.DB, login);
  return `session=${await hmacSeal(id, "test-cookie-secret")}`;
}

describe("listAccessibleConnectedRepos", () => {
  it("returns the intersection of GitHub-accessible and connected repos", async () => {
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/a', ?, ?, 1, 'connected')`, nowIso(), LOGIN);
    await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES ('octo/b', ?, ?, 1, 'disconnected')`, nowIso(), LOGIN);
    // octo/c is accessible on GitHub but NOT connected → excluded.
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, {
      getToken: async () => "tok",
      listRepos: async () => [{ repo: "octo/a", can_push: true }, { repo: "octo/b", can_push: false }, { repo: "octo/c", can_push: true }],
    });
    expect(out).toEqual([{ repo: "octo/a", can_push: true }]); // b disconnected, c not connected
  });

  it("is empty when the user has no token", async () => {
    const out = await listAccessibleConnectedRepos(env.DB, env, LOGIN, { getToken: async () => null, listRepos: async () => [] });
    expect(out).toEqual([]);
  });
});

// The real HTTP surface, wired through the flat session-gated app (no injected
// opts — exercises the actual getUserToken + repos-table wiring). Mirrors the
// cookieFor auth pattern from roadmap.test.ts / hub-routes.test.ts.
describe("GET /me/repos (session-gated)", () => {
  it("401s without a session", async () => {
    const res = await app.request("/me/repos", {}, env);
    expect(res.status).toBe(401);
  });

  it("200s with an empty list + the configured appSlug when the user has no stored GitHub token (never 500s)", async () => {
    // No row in user_tokens for LOGIN → getUserToken resolves null → the real
    // (un-injected) route path short-circuits to an empty list without ever
    // reaching the network (accessibleRepos is never called).
    const res = await app.request("/me/repos", { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: Array<{ repo: string; can_push: boolean }>; appSlug: string | null };
    expect(body.repos).toEqual([]);
    // cloudflare:test's env is typed via test/env.d.ts, which doesn't mirror GITHUB_APP_SLUG
    // (same cast precedent as roadmap.test.ts's buildCanopyMcpServer(env as unknown as Env, …)).
    expect(body.appSlug).toBe((env as unknown as Env).GITHUB_APP_SLUG ?? null); // wrangler.toml: "memo-sphere", confirmed non-null
  });
});
