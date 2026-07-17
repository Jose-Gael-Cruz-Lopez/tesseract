import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  createD1RateLimiter,
  createD1FailureTracker,
  loginAllowed,
  CALLBACK_RATE,
  AUTH_FAILURE_LOCKOUT,
  type RateLimitPolicy,
  type LockoutPolicy,
} from "../src/auth/rate-limit";
import type { Env } from "../src/env";

// A controllable clock: the limiter/tracker take an injectable `now`, so all window
// and lockout arithmetic is tested deterministically against the real Miniflare D1.
function fakeClock(startMs: number) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

// Anchored at an exact window boundary (divisible by every windowMs used below) so
// remaining-window math is predictable.
const ANCHOR = 1_800_000_000_000;

const POLICY: RateLimitPolicy = { name: "test", limit: 3, windowMs: 60_000 };

describe("createD1RateLimiter", () => {
  it("allows up to `limit` hits in a window, then denies with the window's remainder as Retry-After", async () => {
    const clock = fakeClock(ANCHOR);
    const limiter = createD1RateLimiter(env.DB, { now: clock.now });
    for (let i = 0; i < POLICY.limit; i++) {
      expect(await limiter.hit(POLICY, "1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    clock.advance(10_000); // 50s of the 60s window left
    const denied = await limiter.hit(POLICY, "1.2.3.4");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(50);
  });

  it("resets the counter when the window rolls over", async () => {
    const clock = fakeClock(ANCHOR);
    const limiter = createD1RateLimiter(env.DB, { now: clock.now });
    for (let i = 0; i < POLICY.limit; i++) await limiter.hit(POLICY, "k");
    expect((await limiter.hit(POLICY, "k")).allowed).toBe(false);
    clock.advance(POLICY.windowMs); // guaranteed into the next fixed window
    expect((await limiter.hit(POLICY, "k")).allowed).toBe(true);
  });

  it("buckets keys independently", async () => {
    const clock = fakeClock(ANCHOR);
    const limiter = createD1RateLimiter(env.DB, { now: clock.now });
    for (let i = 0; i <= POLICY.limit; i++) await limiter.hit(POLICY, "a");
    expect((await limiter.hit(POLICY, "a")).allowed).toBe(false);
    expect((await limiter.hit(POLICY, "b")).allowed).toBe(true);
  });

  it("buckets policy names independently for the same key", async () => {
    const clock = fakeClock(ANCHOR);
    const limiter = createD1RateLimiter(env.DB, { now: clock.now });
    for (let i = 0; i <= POLICY.limit; i++) await limiter.hit(POLICY, "shared");
    expect((await limiter.hit(POLICY, "shared")).allowed).toBe(false);
    const other: RateLimitPolicy = { name: "other", limit: 3, windowMs: 60_000 };
    expect((await limiter.hit(other, "shared")).allowed).toBe(true);
  });

  it("reports at least 1 second of Retry-After even at the window's edge", async () => {
    const clock = fakeClock(ANCHOR);
    const limiter = createD1RateLimiter(env.DB, { now: clock.now });
    for (let i = 0; i < POLICY.limit; i++) await limiter.hit(POLICY, "edge");
    clock.advance(POLICY.windowMs - 1); // 1ms of window left
    const denied = await limiter.hit(POLICY, "edge");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
  });
});

// Small values so escalation is cheap to walk: 3 failures in 10 min → 60s lockout,
// doubling per further failure, capped at 240s.
const LOCKOUT: LockoutPolicy = { name: "t", maxFailures: 3, windowMs: 600_000, baseLockoutMs: 60_000, maxLockoutMs: 240_000 };

describe("createD1FailureTracker", () => {
  it("stays allowed below the failure threshold", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    await fails.recordFailure(LOCKOUT, "ip");
    await fails.recordFailure(LOCKOUT, "ip");
    expect(await fails.status(LOCKOUT, "ip")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("locks at the threshold for the base duration, and unlocks once it elapses", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await fails.recordFailure(LOCKOUT, "ip");
    const locked = await fails.status(LOCKOUT, "ip");
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBe(60);
    clock.advance(60_001);
    expect((await fails.status(LOCKOUT, "ip")).allowed).toBe(true);
  });

  it("doubles the lockout per failure past the threshold, capped at maxLockoutMs", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await fails.recordFailure(LOCKOUT, "ip"); // 3rd → 60s
    await fails.recordFailure(LOCKOUT, "ip"); // 4th → 120s
    expect((await fails.status(LOCKOUT, "ip")).retryAfterSeconds).toBe(120);
    await fails.recordFailure(LOCKOUT, "ip"); // 5th → 240s (the cap)
    expect((await fails.status(LOCKOUT, "ip")).retryAfterSeconds).toBe(240);
    await fails.recordFailure(LOCKOUT, "ip"); // 6th → still 240s (capped, never 480)
    expect((await fails.status(LOCKOUT, "ip")).retryAfterSeconds).toBe(240);
  });

  it("clear() wipes the record entirely — the count restarts from zero", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    await fails.recordFailure(LOCKOUT, "ip");
    await fails.recordFailure(LOCKOUT, "ip");
    await fails.clear(LOCKOUT, "ip");
    // Two more failures: without the clear these would be #3/#4 and lock; with it they're #1/#2.
    await fails.recordFailure(LOCKOUT, "ip");
    await fails.recordFailure(LOCKOUT, "ip");
    expect((await fails.status(LOCKOUT, "ip")).allowed).toBe(true);
    await fails.recordFailure(LOCKOUT, "ip"); // the new #3 → locks
    expect((await fails.status(LOCKOUT, "ip")).allowed).toBe(false);
  });

  it("restarts the count — and wipes a stale lock — when the failure window expires", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await fails.recordFailure(LOCKOUT, "ip"); // locked 60s
    clock.advance(LOCKOUT.windowMs); // both the window and the lockout are long past
    await fails.recordFailure(LOCKOUT, "ip"); // a fresh window: count restarts at 1
    expect((await fails.status(LOCKOUT, "ip")).allowed).toBe(true);
  });

  it("tracks failure keys independently", async () => {
    const clock = fakeClock(ANCHOR);
    const fails = createD1FailureTracker(env.DB, { now: clock.now });
    for (let i = 0; i < LOCKOUT.maxFailures; i++) await fails.recordFailure(LOCKOUT, "bad-ip");
    expect((await fails.status(LOCKOUT, "bad-ip")).allowed).toBe(false);
    expect((await fails.status(LOCKOUT, "good-ip")).allowed).toBe(true);
  });
});

describe("wired policy invariants", () => {
  it("keeps the lockout threshold below the callback rate limit, so a failure burst hits the lockout first", () => {
    expect(AUTH_FAILURE_LOCKOUT.maxFailures).toBeLessThan(CALLBACK_RATE.limit);
  });
});

describe("loginAllowed (soft-rollout allow-list)", () => {
  const withList = (v: string | undefined): Env => ({ ...env, LOGIN_ALLOWLIST: v } as unknown as Env);

  it("treats an empty or absent LOGIN_ALLOWLIST as open signup", () => {
    expect(loginAllowed(withList(undefined), "anyone")).toBe(true);
    expect(loginAllowed(withList(""), "anyone")).toBe(true);
    expect(loginAllowed(withList("  ,  "), "anyone")).toBe(true); // whitespace-only entries don't close signup
  });

  it("permits listed logins, case-insensitively and whitespace-tolerantly", () => {
    const e = withList(" alice , Bob ");
    expect(loginAllowed(e, "alice")).toBe(true);
    expect(loginAllowed(e, "ALICE")).toBe(true);
    expect(loginAllowed(e, "bob")).toBe(true);
  });

  it("denies logins not on a non-empty list", () => {
    expect(loginAllowed(withList("alice,bob"), "mallory")).toBe(false);
  });
});
