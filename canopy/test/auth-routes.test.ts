import { describe, it, expect } from "vitest";
import { authApp } from "../src/auth/routes";
import { env } from "cloudflare:test";
import { hmacSeal } from "../src/auth/crypto";
import type { Env } from "../src/env";

// GITHUB_APP_CLIENT_ID isn't in vitest.config.ts's Miniflare bindings (the App user-auth
// flow is configured separately from the base env) — layer it onto the real test env for
// the success-path cases, same pattern as test/app-login.test.ts's appEnv.
const appEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient" } as Env;

describe("users schema", () => {
  it("no longer has a github_token column — the per-user sealed token is retired (Task 17)", async () => {
    const rows = await env.DB.prepare(
      `SELECT * FROM pragma_table_info('users') WHERE name = 'github_token'`
    ).all();
    expect(rows.results).toHaveLength(0);
  });
});

describe("GET /auth/login (flipped to the GitHub App flow, Task 10)", () => {
  it("503s app_not_configured when the App isn't configured (no GITHUB_APP_CLIENT_ID)", async () => {
    const res = await authApp.request("/login", {}, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("app_not_configured");
  });

  it("302-redirects to GitHub authorize with the App client_id, redirect_uri /auth/callback, no PKCE, no read:org scope, and sets the app_oauth_tx cookie", async () => {
    const res = await authApp.request("/login", {}, appEnv);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    // The App client_id (GITHUB_APP_CLIENT_ID), NOT the old OAuth GITHUB_CLIENT_ID.
    expect(loc.searchParams.get("client_id")).toBe("Iv1.testclient");
    // redirect_uri targets the PRIMARY callback (/auth/callback), not app-login's own
    // default alias (/auth/app/callback) — this is the redirect_uri/callback-path flip.
    expect(new URL(loc.searchParams.get("redirect_uri")!).pathname).toBe("/auth/callback");
    expect(loc.searchParams.get("state")).toBeTruthy();
    // No PKCE (the old OAuth login used code_challenge/code_challenge_method) and no
    // scope (App permissions govern instead of the old "read:org read:user").
    expect(loc.searchParams.get("code_challenge")).toBeNull();
    expect(loc.searchParams.get("code_challenge_method")).toBeNull();
    expect(loc.searchParams.get("scope")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain("app_oauth_tx=");
  });
});

describe("GET /auth/callback (flipped to the GitHub App flow, Task 10 — no org gate)", () => {
  it("returns 400 invalid_request when required params (code, state, tx cookie) are missing", async () => {
    // Hitting callback with no query params or tx cookie — should be 400 invalid_request.
    const res = await authApp.request("/callback", {}, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 403 state_mismatch when the tx cookie is tampered (not a valid HMAC seal)", async () => {
    // finishAppLogin has no distinct "bad_state" class (unlike the old OAuth callback) —
    // an unseal failure and a real state mismatch both surface as state_mismatch.
    const res = await authApp.request(
      "/callback?code=fake-code&state=fake-state",
      { headers: { cookie: "app_oauth_tx=not-a-valid-seal" } },
      env
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("state_mismatch");
  });

  it("returns 403 state_mismatch when the query state does not match the sealed tx state", async () => {
    // The App flow seals a bare state (no ".verifier" suffix — no PKCE), unlike the old
    // OAuth callback's `${state}.${verifier}` seal.
    const sealed = await hmacSeal("real-state", "test-cookie-secret");
    const res = await authApp.request(
      "/callback?code=fake-code&state=wrong-state",
      { headers: { cookie: `app_oauth_tx=${sealed}` } },
      env
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("state_mismatch");
  });

  // NOTE: no org gate on this path anymore — isAllowed/isActiveOrgMember are retired from
  // /callback (any GitHub user who completes the exchange gets a session). A successful
  // callback (code -> exchangeUserCode -> getUser -> storeUserToken -> createSession) is
  // NOT unit-tested here: getUser (src/auth/github.ts) calls the global fetch directly with
  // no injectable fetchImpl seam, and the Miniflare worker-sandbox fetch cannot be stubbed
  // from the test thread (same constraint noted in test/app-login.test.ts for /app/callback).
  // Covered by the Task 11 e2e.
});

