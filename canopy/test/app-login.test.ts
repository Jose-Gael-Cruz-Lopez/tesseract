import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { buildAppAuthorizeUrl } from "../src/auth/app-login";
import { authApp } from "../src/auth/routes";
import { app } from "../src/routes";
import { hmacSeal } from "../src/auth/crypto";
import type { Env } from "../src/env";

// GITHUB_APP_CLIENT_ID isn't in vitest.config.ts's Miniflare bindings (the App user-auth
// flow is additive/opt-in), so tests that need it configured layer it onto the real test
// env — same pattern as user-token.test.ts's appEnv.
const appEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient" } as Env;

describe("app-login", () => {
  it("builds the App authorize URL with client_id + state, no scope", () => {
    const url = new URL(buildAppAuthorizeUrl({ clientId: "Iv1.abc", redirectUri: "https://memo-sphere.com/auth/app/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://memo-sphere.com/auth/app/callback");
    expect(url.searchParams.get("scope")).toBeNull(); // App permissions govern; no OAuth scope
  });
});

describe("GET /auth/app/login", () => {
  it("503s app_not_configured when the App isn't configured (no GITHUB_APP_CLIENT_ID)", async () => {
    // Default test env (vitest.config.ts) never sets GITHUB_APP_CLIENT_ID — mirrors prod
    // before the App is provisioned.
    const res = await authApp.request("/app/login", {}, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("app_not_configured");
  });

  it("302-redirects to the App authorize URL, no PKCE params, and sets the tx + return cookies", async () => {
    const res = await authApp.request("/app/login", {}, appEnv);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("Iv1.testclient");
    expect(loc.searchParams.get("state")).toBeTruthy();
    expect(new URL(loc.searchParams.get("redirect_uri")!).pathname).toBe("/auth/app/callback");
    // No PKCE (unlike the old OAuth login) and no scope (App perms govern).
    expect(loc.searchParams.get("code_challenge")).toBeNull();
    expect(loc.searchParams.get("code_challenge_method")).toBeNull();
    expect(loc.searchParams.get("scope")).toBeNull();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("app_oauth_tx=");
  });

  it("stores a validated return path in the app_oauth_return cookie", async () => {
    const res = await authApp.request("/app/login?return=/some/where", {}, appEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("app_oauth_return=%2Fsome%2Fwhere");
  });
});

describe("GET /auth/app/callback", () => {
  it("returns 400 invalid_request when code, state, and the tx cookie are all missing", async () => {
    const res = await authApp.request("/app/callback", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 403 state_mismatch when the tx cookie is tampered (not a valid HMAC seal)", async () => {
    const res = await authApp.request(
      "/app/callback?code=fake-code&state=fake-state",
      { headers: { cookie: "app_oauth_tx=not-a-valid-seal" } },
      env
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("state_mismatch");
  });

  it("returns 403 state_mismatch when the query state does not match the sealed tx state", async () => {
    // The App flow seals a bare state (no ".verifier" suffix — no PKCE), unlike the old
    // OAuth callback's `${state}.${verifier}` seal.
    const sealed = await hmacSeal("real-state", "test-cookie-secret");
    const res = await authApp.request(
      "/app/callback?code=fake-code&state=wrong-state",
      { headers: { cookie: `app_oauth_tx=${sealed}` } },
      env
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("state_mismatch");
  });

  // A successful callback (code -> exchangeUserCode -> getUser -> storeUserToken ->
  // createSession) is NOT unit-tested here: getUser (src/auth/github.ts) calls the global
  // `fetch` directly with no injectable fetchImpl seam (same constraint noted in
  // auth-routes.test.ts for the OAuth /callback's non-member-redirect case), and the Miniflare
  // worker-sandbox fetch cannot be stubbed from the test thread. Covered by the Task 11 e2e.
});

describe("PUBLIC_PATHS: /auth/app/login and /auth/app/callback bypass sessionGate", () => {
  it("lets an unauthenticated request reach /auth/app/login through the full app (not 401)", async () => {
    // Through `app` (src/routes.ts), which has sessionGate mounted — unlike authApp.request
    // above, which calls the sub-router directly and never exercises the gate.
    const res = await app.request("/auth/app/login", {}, appEnv);
    expect(res.status).toBe(302); // handler ran (redirected), proving the gate let it through
  });

  it("lets an unauthenticated request reach /auth/app/callback through the full app (not 401)", async () => {
    const res = await app.request("/auth/app/callback", {}, env);
    expect(res.status).toBe(400); // handler ran (invalid_request), not gate-blocked 401
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });
});
