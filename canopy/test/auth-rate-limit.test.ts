import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { app } from "../src/routes";
import { authApp } from "../src/auth/routes";
import { finishAppLogin } from "../src/auth/app-login";
import { hmacSeal } from "../src/auth/crypto";
import { authedCookie } from "./helpers/session";
import type { AppEnv } from "../src/auth/principal";
import type { Env } from "../src/env";
import {
  _rateLimitTestHooks,
  _resetRateLimitTestHooks,
  LOGIN_RATE,
  CALLBACK_RATE,
  SESSION_RATE,
  MCP_TOKEN_RATE,
  AUTH_FAILURE_LOCKOUT,
} from "../src/auth/rate-limit";

// Route-level coverage for issue #21: the abuse controls as wired into the real
// handlers. Window/lockout arithmetic is unit-tested in test/rate-limit.test.ts;
// here the clock is pinned via the test seam so a burst of requests can never
// straddle a fixed-window boundary mid-test.
const ANCHOR = 1_800_000_000_000; // an exact boundary of every wired window

beforeEach(() => {
  _rateLimitTestHooks.now = () => ANCHOR;
});
afterEach(() => {
  _resetRateLimitTestHooks();
});

// GITHUB_APP_CLIENT_ID isn't in vitest.config.ts's Miniflare bindings — layer it on,
// same pattern as test/app-login.test.ts's appEnv / exchangeEnv.
const appEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient" } as Env;
const exchangeEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient", GITHUB_APP_CLIENT_SECRET: "test-app-secret" } as Env;

/**
 * A seam app that drives finishAppLogin's SUCCESS path: fetchImpl stubs the token
 * exchange, getUserImpl stubs the identity fetch (getUser hits the global fetch,
 * which the Miniflare pool can't stub — see app-login.test.ts). `loginFor` picks
 * the GitHub login per call so per-login policies can be isolated from per-IP ones.
 */
function successApp(loginFor: () => string): Hono<AppEnv> {
  const goodExchange: typeof fetch = async () =>
    new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200, headers: { "content-type": "application/json" } });
  const seam = new Hono<AppEnv>();
  seam.get("/callback", (c) =>
    finishAppLogin(c, {
      fetchImpl: goodExchange,
      getUserImpl: async () => ({ login: loginFor(), name: null, avatar_url: null }),
    })
  );
  return seam;
}

const txCookie = async (state: string): Promise<string> => `app_oauth_tx=${await hmacSeal(state, "test-cookie-secret")}`;

describe("GET /auth/login — per-IP rate limit", () => {
  it(`429s with Retry-After after ${LOGIN_RATE.limit} starts in a window; other IPs are unaffected`, async () => {
    for (let i = 0; i < LOGIN_RATE.limit; i++) {
      const res = await authApp.request("/login", { headers: { "cf-connecting-ip": "203.0.113.1" } }, appEnv);
      expect(res.status).toBe(302);
    }
    const blocked = await authApp.request("/login", { headers: { "cf-connecting-ip": "203.0.113.1" } }, appEnv);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toBe("rate_limited");
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_RATE.windowMs / 1000);
    // The alias login path shares the same bucket — a blocked probe can't just switch paths.
    const alias = await authApp.request("/app/login", { headers: { "cf-connecting-ip": "203.0.113.1" } }, appEnv);
    expect(alias.status).toBe(429);
    // A different client is a different bucket.
    const other = await authApp.request("/login", { headers: { "cf-connecting-ip": "203.0.113.2" } }, appEnv);
    expect(other.status).toBe(302);
  });
});

describe("GET /auth/callback — per-IP rate limit", () => {
  it(`429s after ${CALLBACK_RATE.limit} callback attempts from one IP, even when every attempt succeeds`, async () => {
    let n = 0;
    const seam = successApp(() => `cb-user-${n++}`); // distinct logins: the per-login session cap never engages
    const cookie = await txCookie("st");
    for (let i = 0; i < CALLBACK_RATE.limit; i++) {
      const res = await seam.request("/callback?code=c&state=st", { headers: { cookie, "cf-connecting-ip": "192.0.2.9" } }, exchangeEnv);
      expect(res.status).toBe(302);
    }
    const blocked = await seam.request("/callback?code=c&state=st", { headers: { cookie, "cf-connecting-ip": "192.0.2.9" } }, exchangeEnv);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /auth/callback — lockout after repeated auth failures", () => {
  it(`429s the client after ${AUTH_FAILURE_LOCKOUT.maxFailures} auth failures; other clients are unaffected`, async () => {
    const hdr = { "cf-connecting-ip": "198.51.100.7" };
    for (let i = 0; i < AUTH_FAILURE_LOCKOUT.maxFailures; i++) {
      const res = await authApp.request("/callback", { headers: hdr }, env); // no code/state/tx → invalid_request, a recorded failure
      expect(res.status).toBe(400);
    }
    // maxFailures < CALLBACK_RATE.limit (asserted in test/rate-limit.test.ts), so this
    // refusal is the LOCKOUT engaging — the per-IP callback cap is still far away.
    const blocked = await authApp.request("/callback", { headers: hdr }, env);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBe(AUTH_FAILURE_LOCKOUT.baseLockoutMs / 1000);
    const other = await authApp.request("/callback", { headers: { "cf-connecting-ip": "198.51.100.8" } }, env);
    expect(other.status).toBe(400); // still just an invalid request, not locked
  });

  it("a successful sign-in clears the client's failure count", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < AUTH_FAILURE_LOCKOUT.maxFailures - 1; i++) {
      const res = await authApp.request("/callback", { headers: { "cf-connecting-ip": ip } }, env);
      expect(res.status).toBe(400); // one failure short of the lockout
    }
    const seam = successApp(() => "recovered-user");
    const ok = await seam.request("/callback?code=c&state=st", { headers: { cookie: await txCookie("st"), "cf-connecting-ip": ip } }, exchangeEnv);
    expect(ok.status).toBe(302); // success — clears the record
    // Two more failures: without the clear these would be #5 (engaging the lockout)
    // and #6 (refused 429); with it they're #1 and #2 — both plain 400s.
    expect((await authApp.request("/callback", { headers: { "cf-connecting-ip": ip } }, env)).status).toBe(400);
    expect((await authApp.request("/callback", { headers: { "cf-connecting-ip": ip } }, env)).status).toBe(400);
  });
});

describe("session creation — per-login cap at the callback", () => {
  it(`429s the ${SESSION_RATE.limit + 1}th session for one GitHub account in a window and mints no session`, async () => {
    const seam = successApp(() => "dup-user");
    const cookie = await txCookie("st");
    for (let i = 0; i < SESSION_RATE.limit; i++) {
      // Distinct IPs so the per-IP limits and the lockout never engage — the refusal
      // below can only be the per-login session cap.
      const res = await seam.request("/callback?code=c&state=st", { headers: { cookie, "cf-connecting-ip": `10.0.0.${i + 1}` } }, exchangeEnv);
      expect(res.status).toBe(302);
    }
    const blocked = await seam.request("/callback?code=c&state=st", { headers: { cookie, "cf-connecting-ip": "10.0.0.99" } }, exchangeEnv);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(blocked.headers.get("set-cookie") ?? "").not.toContain("session=");
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user = ?`).bind("dup-user").first<{ n: number }>();
    expect(row?.n).toBe(SESSION_RATE.limit); // the blocked attempt minted nothing
  });
});

describe("LOGIN_ALLOWLIST — soft-rollout allow-list at the callback", () => {
  const listEnv: Env = { ...exchangeEnv, LOGIN_ALLOWLIST: "alice, Bob" } as Env;

  it("403s a GitHub user not on a non-empty allow-list, opening no session and provisioning nothing", async () => {
    const seam = successApp(() => "mallory");
    const res = await seam.request("/callback?code=c&state=st", { headers: { cookie: await txCookie("st"), "cf-connecting-ip": "192.0.2.20" } }, listEnv);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("login_not_allowed");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session=");
    // Denied means denied: no user row, no stored user token.
    expect(await env.DB.prepare(`SELECT 1 FROM users WHERE github_login = ?`).bind("mallory").first()).toBeNull();
    expect(await env.DB.prepare(`SELECT 1 FROM user_tokens WHERE login = ?`).bind("mallory").first()).toBeNull();
  });

  it("admits an allow-listed login case-insensitively", async () => {
    const seam = successApp(() => "BOB");
    const res = await seam.request("/callback?code=c&state=st", { headers: { cookie: await txCookie("st"), "cf-connecting-ip": "192.0.2.21" } }, listEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
  });

  it("keeps signup open (any GitHub user) when the allow-list is empty/unset", async () => {
    const seam = successApp(() => "anyone-at-all");
    const res = await seam.request("/callback?code=c&state=st", { headers: { cookie: await txCookie("st"), "cf-connecting-ip": "192.0.2.22" } }, exchangeEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
  });
});

describe("POST /auth/mcp-token — per-login mint cap", () => {
  it(`mints up to ${MCP_TOKEN_RATE.limit} tokens in a window, then 429s with Retry-After`, async () => {
    const cookie = await authedCookie("token-user");
    for (let i = 0; i < MCP_TOKEN_RATE.limit; i++) {
      const res = await app.request("/auth/mcp-token", { method: "POST", headers: { cookie } }, env);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { token: string }).token).toMatch(/^canopy_mcp_/);
    }
    const blocked = await app.request("/auth/mcp-token", { method: "POST", headers: { cookie } }, env);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // Rate-limited ≠ locked out of the product: a different login still mints.
    const otherCookie = await authedCookie("other-user");
    const ok = await app.request("/auth/mcp-token", { method: "POST", headers: { cookie: otherCookie } }, env);
    expect(ok.status).toBe(200);
  });
});
