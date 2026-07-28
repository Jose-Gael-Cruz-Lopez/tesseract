import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { authApp } from "../src/auth/routes";
import {
  createD1RateLimiter,
  createD1FailureTracker,
  LOGIN_RATE,
  AUTH_FAILURE_LOCKOUT,
} from "../src/auth/rate-limit";
import type { AppEnv } from "../src/auth/principal";
import type { Env } from "../src/env";
import type { DB } from "../src/db";

// Regression cover for the 2026-07-17 production outage (found running issue #9's
// e2e checklist): migration 0028 was never applied to prod D1, so `rate_limits` /
// `auth_failures` did not exist. Every D1 call in the limiter was unwrapped, so the
// throw escaped `startAppLogin` / `finishAppLogin` — and with no Hono onError, the
// ENTIRE login surface returned a bare 500 for ~10 days.
//
// Policy (decided with the maintainer): the abuse controls fail OPEN. A rate limiter
// is not an authenticator — when its backing store is unreachable it must degrade to
// "allow, and shout in the logs", never take sign-in down with it.

/**
 * A D1 stub that fails the way a missing table does: at statement execution, and
 * ASYNCHRONOUSLY. The `await Promise.resolve()` matters — real D1 rejects a tick
 * later, so the caller's handler is always attached first. A stub that threw
 * synchronously would surface a spurious "unhandled rejection" through `db.run`
 * (which returns its promise rather than awaiting it), which is a property of the
 * double, not of production: verified against a real Miniflare D1 with the table
 * genuinely dropped, which degrades open with no unhandled rejection.
 */
const MISSING_TABLE = "D1_ERROR: no such table: rate_limits";
const reject = async () => {
  await Promise.resolve();
  throw new Error(MISSING_TABLE);
};
const brokenDb = {
  prepare: () => ({
    bind: () => ({ first: reject, run: reject, all: reject }),
  }),
} as unknown as DB;

const brokenEnv: Env = {
  ...env,
  DB: brokenDb,
  GITHUB_APP_CLIENT_ID: "Iv1.testclient",
} as Env;

const mount = () => {
  const a = new Hono<AppEnv>();
  a.route("/auth", authApp);
  return a;
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("rate limiter degrades open when its D1 tables are unreachable", () => {
  it("hit() allows the request instead of throwing", async () => {
    const decision = await createD1RateLimiter(brokenDb).hit(LOGIN_RATE, "1.2.3.4");
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it("status() reports not-locked-out instead of throwing", async () => {
    const decision = await createD1FailureTracker(brokenDb).status(AUTH_FAILURE_LOCKOUT, "1.2.3.4");
    expect(decision.allowed).toBe(true);
  });

  it("recordFailure() swallows the backend error", async () => {
    await expect(
      createD1FailureTracker(brokenDb).recordFailure(AUTH_FAILURE_LOCKOUT, "1.2.3.4")
    ).resolves.toBeUndefined();
  });

  it("clear() swallows the backend error", async () => {
    await expect(
      createD1FailureTracker(brokenDb).clear(AUTH_FAILURE_LOCKOUT, "1.2.3.4")
    ).resolves.toBeUndefined();
  });

  it("emits an error-level structured line so the degradation is alertable", async () => {
    await createD1RateLimiter(brokenDb).hit(LOGIN_RATE, "1.2.3.4");
    expect(errorSpy).toHaveBeenCalled();
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      event: "rate_limit",
      outcome: "error",
      reason: "backend_error",
      policy: LOGIN_RATE.name,
    });
    // Never leak the client identity or raw SQL into the log line.
    expect(JSON.stringify(line)).not.toContain("1.2.3.4");
  });
});

describe("the login surface survives a broken rate-limit backend", () => {
  it("GET /auth/login still redirects to GitHub (was: bare 500)", async () => {
    const res = await mount().request("/auth/login", {}, brokenEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("github.com/login/oauth/authorize");
  });

  it("GET /auth/callback still returns its real 400 (was: bare 500)", async () => {
    const res = await mount().request("/auth/callback", {}, brokenEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });
});
