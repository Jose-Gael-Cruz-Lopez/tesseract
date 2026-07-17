import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env";
import { makeRepoGate } from "../src/auth/repo-gate";

// Phase 3 (GitHub App / connect-your-repos): repoGate — the per-repo hub middleware.
// A tiny app sets a fixed principal, mounts the gate with injected token + access-set
// stubs (so no user-token.ts / GitHub is needed), and echoes what the gate stashes on
// the context. Covers the allowed path and each denial (unconnected, no token, no access).

type GateVars = { Variables: { principal: { login: string }; repo: string; canPush: boolean } };
type GateDeps = Parameters<typeof makeRepoGate>[0];

// Build a fresh app: principal → repoGate → an echo handler. `overrides` swaps the
// injected deps per case; the defaults model a connected repo the user can push to.
function buildApp(overrides: Partial<GateDeps> = {}): Hono<GateVars> {
  const app = new Hono<GateVars>();
  app.use("*", (c, next) => {
    c.set("principal", { login: "octocat" });
    return next();
  });
  app.use(
    "/r/:owner/:repo/*",
    makeRepoGate({
      db: env.DB,
      env: env as unknown as Env,
      getUserToken: async () => "ghu_x",
      listRepos: async () => [{ repo: "acme/app", can_push: true }],
      ...overrides,
    })
  );
  app.get("/r/:owner/:repo/x", (c) => c.json({ repo: c.get("repo"), canPush: c.get("canPush") }));
  return app;
}

// Seed a connected repo (the only state authorizeRepo reads directly).
const connect = (repo: string) =>
  env.DB.prepare(`INSERT INTO repos (repo, added_at, status) VALUES (?, 'x', 'connected')`).bind(repo).run();

describe("repoGate middleware (auth/repo-gate.ts)", () => {
  it("allows a connected repo the user can reach — stashes repo + canPush, 200", async () => {
    await connect("acme/app");
    const res = await buildApp().request("/r/acme/app/x", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo: "acme/app", canPush: true });
  });

  it("404s a repo that isn't connected (no hub), without leaking existence", async () => {
    // repos is empty after the per-test reset, so acme/app is not connected.
    const res = await buildApp().request("/r/acme/app/x", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("401s (reauthorize) when the user has no stored token", async () => {
    await connect("acme/app"); // connected, yet the missing token gates first
    const res = await buildApp({ getUserToken: async () => null }).request("/r/acme/app/x", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "reauthorize" });
  });

  it("404s a connected repo the user cannot reach (empty access set), without leaking existence", async () => {
    await connect("acme/app");
    const res = await buildApp({ listRepos: async () => [] }).request("/r/acme/app/x", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

// Issue #22: every gate decision emits exactly one structured repo_gate line —
// allows via console.log, denies via console.error (level "error" in Workers Logs,
// what the auth-failure-spike alert counts). The log names the repo the caller
// ASKED for; the RESPONSE (asserted above) still never leaks existence.
describe("repoGate structured logs (issue #22)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const gateLines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(String(c[0])) as Record<string, unknown>;
        } catch {
          return null; // non-JSON console traffic is not a structured line
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null && r.event === "repo_gate");

  it("allow → one repo_gate line with login/repo/can_push on console.log", async () => {
    await connect("acme/app");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await buildApp().request("/r/acme/app/x", {}, env)).status).toBe(200);
    expect(gateLines(log)).toEqual([
      { event: "repo_gate", outcome: "allow", login: "octocat", repo: "acme/app", can_push: true },
    ]);
    expect(gateLines(error)).toEqual([]);
  });

  it("deny (404, not connected) → one repo_gate deny line on console.error with status + reason", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await buildApp().request("/r/acme/app/x", {}, env)).status).toBe(404);
    expect(gateLines(error)).toEqual([
      { event: "repo_gate", outcome: "deny", login: "octocat", repo: "acme/app", status: 404, reason: "not_connected_or_no_access" },
    ]);
  });

  it("deny (401, no stored token) → one repo_gate deny line on console.error", async () => {
    await connect("acme/app");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await buildApp({ getUserToken: async () => null }).request("/r/acme/app/x", {}, env)).status).toBe(401);
    expect(gateLines(error)).toEqual([
      { event: "repo_gate", outcome: "deny", login: "octocat", repo: "acme/app", status: 401, reason: "no_user_token" },
    ]);
  });
});
