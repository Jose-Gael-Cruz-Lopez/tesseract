import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { run, nowIso } from "../src/db";
import { write_plan } from "../src/tools/plan";
import { createSession } from "../src/auth/session";
import { hmacSeal } from "../src/auth/crypto";

// Phase 3 (GitHub App / connect-your-repos): the hub router mounted at
// /r/:owner/:repo, gated per-request by repoGate. Auths via a real session
// cookie (mirrors cookieFor in roadmap.test.ts et al.) — vitest.config.ts pins
// DEV_LOGIN to "" so the sessionGate dev bypass never engages in tests.
const REPO = "octo/hub";
const LOGIN = "octocat";

async function cookieFor(login: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
  ).bind(login, login, "2026-01-01T00:00:00Z").run();
  const { id } = await createSession(env.DB, login);
  return `session=${await hmacSeal(id, "test-cookie-secret")}`;
}

async function connect(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), LOGIN, 1);
}

beforeEach(() => { _resetHubTestHooks(); });
afterEach(() => { _resetHubTestHooks(); });

describe("hub roadmap route", () => {
  it("serves the repo-scoped plan when connected + collaborator", async () => {
    await connect(REPO);
    await write_plan(env.DB, { narrative: "octo hub plan", milestones: [] }, LOGIN, REPO);
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];

    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { narrative: string };
    expect(body.narrative).toBe("octo hub plan");
  });

  it("404s an unconnected repo (no existence leak)", async () => {
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(404);
  });

  it("401s when the user has no stored token", async () => {
    await connect(REPO);
    _hubTestHooks.getUserToken = async () => null;
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(401);
  });
});

describe("hub read routes", () => {
  it("feed is isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // seed one feed entry in each repo — column shape copied from repo-scope.test.ts /
    // query.fts.test.ts (feed has no `kind`/`tags` columns; tags live in entry_tags).
    await run(env.DB, `INSERT INTO feed (author, summary, body, artifacts, created_at, repo) VALUES (?, ?, ?, NULL, ?, ?)`, LOGIN, "hub-only", "hub-only", nowIso(), "octo/hub");
    await run(env.DB, `INSERT INTO feed (author, summary, body, artifacts, created_at, repo) VALUES (?, ?, ?, NULL, ?, ?)`, LOGIN, "other-only", "other-only", nowIso(), "octo/other");
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }, { repo: "octo/other", can_push: true }];

    const res = await app.request(`/r/octo/hub/feed`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const { feed } = await res.json() as { feed: Array<{ body: string }> };
    expect(feed.some((f) => f.body === "hub-only")).toBe(true);
    expect(feed.some((f) => f.body === "other-only")).toBe(false);
  });
});
