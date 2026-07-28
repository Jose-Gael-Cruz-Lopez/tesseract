import { env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { run, nowIso, all } from "../src/db";
import { authedCookie } from "./helpers/session";

// Issue #40: POST /r/:owner/:repo/admin/backfill had NO server-side test. Only the
// flat POST /admin/backfill (routes.ts) was covered — and since PR #37 pointed the
// SPA at the hub route, the covered one is the route nobody calls and the live one
// was untested.
//
// The two differ in exactly the ways that caused #34:
//   flat: isAdmin        + defaultRepo(env)
//   hub:  requirePush    + repoOf(c)
// A regression swapping either would have passed the whole suite.
//
// HOW THE TARGET REPO IS OBSERVED, with no network:
// runBackfill's first act is `SELECT installation_id, status FROM repos WHERE repo = ?`.
// It returns two DISTINCT failure strings depending on how far it gets:
//   • repo missing / not connected / no installation → "repo not connected or has no installation"
//   • repo OK, token mint fails (no App config here)  → "installation token mint failed: …"
// vitest.config.ts sets no GITHUB_REPO, so defaultRepo(env) === "". Connecting the HUB
// repo with an installation_id therefore separates the two cases cleanly: the correct
// route reaches the mint, a defaultRepo-targeting regression cannot.

const REPO = "octo/hub";
const PATH = `/r/${REPO}/admin/backfill`;
const LOGIN = "octocat";
const ADMIN = "admin-user"; // vitest.config.ts ADMIN_LOGINS

const connect = (repo: string, installationId: number | null = 1) =>
  run(
    env.DB,
    `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`,
    repo,
    nowIso(),
    LOGIN,
    installationId
  );

/** POST the hub backfill as `login`, with `canPush` on REPO. */
async function post(login: string, canPush: boolean): Promise<Response> {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: REPO, can_push: canPush }];
  return app.request(PATH, { method: "POST", headers: { cookie: await authedCookie(login) } }, env);
}

const eventCount = async (): Promise<number> =>
  (await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM events`))[0].n;

afterEach(() => {
  _resetHubTestHooks();
});

describe("POST /r/:owner/:repo/admin/backfill — authority is requirePush, not isAdmin (issue #40)", () => {
  it("a push collaborator is allowed through the gate", async () => {
    await connect(REPO);
    const res = await post(LOGIN, true);
    // 503 (not 403/404) proves the gate passed and runBackfill actually ran — it
    // cannot reach GitHub in tests, which is the expected failure, not a gate denial.
    expect(res.status).toBe(503);
  });

  it("targets repoOf(c), NOT defaultRepo(env) — the #34 regression, server-side", async () => {
    await connect(REPO, 1); // hub repo IS connected and HAS an installation
    const res = await post(LOGIN, true);
    const body = (await res.json()) as { error: string };
    // Reaching the token mint proves the repo lookup found REPO. Had the route used
    // defaultRepo(env) ("" here), it would have failed at the lookup instead.
    expect(body.error).toContain("installation token mint failed");
    expect(body.error).not.toContain("repo not connected");
  });

  it("a read-only collaborator gets 403 and nothing is written", async () => {
    await connect(REPO);
    const before = await eventCount();
    const res = await post(LOGIN, false);
    expect(res.status).toBe(403);
    expect(await eventCount()).toBe(before); // fails closed
  });

  it("an ADMIN_LOGINS admin WITHOUT push on the repo still gets 403", async () => {
    // requirePush is the authority here; isAdmin gates the FLAT route and says nothing
    // about a tenant's hub. Pins that the two are genuinely independent.
    await connect(REPO);
    const res = await post(ADMIN, false);
    expect(res.status).toBe(403);
  });

  it("no session and no bearer → 401, gate first", async () => {
    await connect(REPO);
    const res = await app.request(PATH, { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("an unconnected repo → 404, leaking no existence", async () => {
    // REPO deliberately not connected. Same shape as a repo the principal cannot
    // reach, so a denial never distinguishes "absent" from "forbidden".
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(PATH, { method: "POST", headers: { cookie: await authedCookie(LOGIN) } }, env);
    expect(res.status).toBe(404);
  });
});
