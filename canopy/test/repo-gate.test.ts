import { describe, it, expect } from "vitest";
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
