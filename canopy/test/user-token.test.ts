import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../src/env";
import { storeUserToken, getUserToken } from "../src/auth/user-token";

// An Env carrying just the App OAuth client id/secret — all getUserToken's refresh path
// needs (mirrors github-app.test's makeAppEnv, minus the JWT signing key).
const appEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient", GITHUB_APP_CLIENT_SECRET: "testsecret" } as Env;

// Fixed ISO clocks for determinism.
const NOW = "2026-07-11T00:00:00Z";
const epochSec = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

// Phase 3: user-token storage backing repoGate's access refresh — upsert + read, with a
// GitHub-native refresh when the stored token is at/near expiry.
describe("user-token storage (auth/user-token.ts)", () => {
  it("store then get returns the stored token", async () => {
    await storeUserToken(env.DB, "octocat", { token: "ghu_x", refreshToken: "ghr_x", expiresAt: null }, NOW);
    expect(await getUserToken(env.DB, appEnv, "octocat", { now: NOW })).toBe("ghu_x");
  });

  it("get on a not-yet-expired token does NOT refresh", async () => {
    // Expires an hour out — well beyond the 60s near-expiry window.
    await storeUserToken(
      env.DB,
      "octocat",
      { token: "ghu_fresh", refreshToken: "ghr_x", expiresAt: epochSec("2026-07-11T01:00:00Z") },
      NOW
    );
    const fetchImpl = (async () => {
      throw new Error("refresh must not run for a fresh token");
    }) as unknown as typeof fetch;
    expect(await getUserToken(env.DB, appEnv, "octocat", { now: NOW, fetchImpl })).toBe("ghu_fresh");
  });

  it("get on an expired token with a refresh token refreshes, stores, and returns the fresh token", async () => {
    // Already past expiry at NOW.
    await storeUserToken(
      env.DB,
      "octocat",
      { token: "ghu_old", refreshToken: "ghr_old", expiresAt: epochSec("2026-07-10T23:59:00Z") },
      "2026-07-10T00:00:00Z"
    );
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toContain("/login/oauth/access_token");
      expect(JSON.parse(init!.body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_old" });
      return new Response(
        JSON.stringify({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const t = await getUserToken(env.DB, appEnv, "octocat", { now: NOW, fetchImpl });
    expect(t).toBe("ghu_new");
    expect(calls).toBe(1);

    // The fresh token + refresh token were persisted.
    const stored = await env.DB.prepare(`SELECT token, refresh_token FROM user_tokens WHERE login = 'octocat'`).first<{
      token: string;
      refresh_token: string;
    }>();
    expect(stored?.token).toBe("ghu_new");
    expect(stored?.refresh_token).toBe("ghr_new");
  });

  it("get with no row returns null", async () => {
    expect(await getUserToken(env.DB, appEnv, "nobody", { now: NOW })).toBeNull();
  });
});
