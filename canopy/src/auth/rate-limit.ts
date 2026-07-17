import type { Context } from "hono";
import { type DB, first, run } from "../db";
import type { Env } from "../env";

// Abuse controls for the open-login surface (issue #21). D1-backed fixed-window
// counters + an escalating auth-failure lockout, chosen over the Cloudflare
// rate-limiting binding because they are unit-testable against the real Miniflare
// D1 with an injectable clock and add nothing to wrangler.toml (wrangler dev and
// deploy are untouched). Per-tenant limits (repos per account, request quotas)
// are issue #13's scope, not here.
//
// The tables (migration 0028) are origin-level control state keyed by
// "<policy>:<client>" (client = IP-derived bucket or login) — NOT tenant data, so
// no `repo` column (the same class as sessions / mcp_tokens). Rows are one per
// bucket and reused across windows via upsert; spent rows are evicted by the
// scheduled() cron (evictStaleAbuseState below), so the tables stay bounded even
// against a client minting fresh keys. Denied hits are refused on a READ — the
// upsert only runs when it could change the outcome — so a flood of an already
// over-limit bucket burns cheap D1 reads, never writes. (Cloudflare WAF/native
// rate-limiting rules in front of /auth/* remain a worthwhile non-D1 first layer;
// that's deployment config, not Worker code.)

/** One named fixed-window policy: at most `limit` hits per `windowMs` per key. */
export interface RateLimitPolicy {
  name: string; // key namespace, e.g. "login" — distinct policies never share buckets
  limit: number;
  windowMs: number;
}

/** Escalating lockout policy for repeated auth failures. */
export interface LockoutPolicy {
  name: string; // key namespace
  maxFailures: number; // failures within windowMs before the lockout engages
  windowMs: number; // failure-counting window, anchored at the first failure
  baseLockoutMs: number; // first lockout; doubles per further failure past the threshold
  maxLockoutMs: number; // backoff cap
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds the client should wait before retrying; 0 when allowed. */
  retryAfterSeconds: number;
}

// Wired policies. Login/callback are per-IP (pre-identity); session creation and
// token minting are per-login (post-identity). Generous for humans — a person
// re-signing-in or re-minting a lost token never notices — tight enough to blunt
// scripted probing now that any GitHub user can start a sign-in.
export const LOGIN_RATE: RateLimitPolicy = { name: "login", limit: 10, windowMs: 60_000 };
export const CALLBACK_RATE: RateLimitPolicy = { name: "callback", limit: 10, windowMs: 60_000 };
export const SESSION_RATE: RateLimitPolicy = { name: "session", limit: 10, windowMs: 3_600_000 };
export const MCP_TOKEN_RATE: RateLimitPolicy = { name: "mcp-token", limit: 10, windowMs: 3_600_000 };

// Repeated auth failures at the callback (garbage requests, tampered state,
// rejected/replayed codes) lock the client out: 5 failures within 15 minutes →
// 1 minute, doubling per further failure, capped at 1 hour. A successful sign-in
// clears the record, so a human who refreshed the callback page a few times
// recovers instantly. NOTE: maxFailures must stay below CALLBACK_RATE.limit so
// the lockout — not the coarse per-IP cap — is what answers a failure burst.
export const AUTH_FAILURE_LOCKOUT: LockoutPolicy = {
  name: "auth",
  maxFailures: 5,
  windowMs: 15 * 60_000,
  baseLockoutMs: 60_000,
  maxLockoutMs: 3_600_000,
};

export interface RateLimiter {
  /** Record one hit for `key` under `policy` and decide allow/deny. */
  hit(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision>;
}

export interface FailureTracker {
  /** Is `key` currently locked out? Never records anything. */
  status(policy: LockoutPolicy, key: string): Promise<RateLimitDecision>;
  /** Record one auth failure for `key`; engages/escalates the lockout at the threshold. */
  recordFailure(policy: LockoutPolicy, key: string): Promise<void>;
  /** A successful auth clears `key`'s failure record entirely. */
  clear(policy: LockoutPolicy, key: string): Promise<void>;
}

// Test seam (mirrors _mcpTestHooks in src/index.ts): when set, overrides the clock
// the D1-backed limiter/tracker read, so route-level tests pin window arithmetic
// without fake timers. Production never sets it; unit tests pass opts.now directly.
export const _rateLimitTestHooks: { now?: () => number } = {};

export function _resetRateLimitTestHooks(): void {
  _rateLimitTestHooks.now = undefined;
}

const retryAfter = (untilMs: number, nowMs: number): number => Math.max(1, Math.ceil((untilMs - nowMs) / 1000));

export function createD1RateLimiter(db: DB, opts: { now?: () => number } = {}): RateLimiter {
  const now = (): number => (opts.now ?? _rateLimitTestHooks.now ?? Date.now)();
  return {
    async hit(policy, key) {
      const t = now();
      const windowStart = t - (t % policy.windowMs);
      const k = `${policy.name}:${key}`;
      // Deny-before-write: a bucket already at its limit for this window can only be
      // refused, so answer from a read and skip the upsert. Without this, every denied
      // request is a guaranteed D1 row-write — a flood of an over-limit key would burn
      // write quota at attack rate. The counter is monotone within a window (it only
      // resets on rollover), so this shortcut can never wrongly deny; the atomic upsert
      // below still makes the exact allow/deny call for every hit that writes.
      const existing = await first<{ window_start: number; count: number }>(
        db, `SELECT window_start, count FROM rate_limits WHERE key = ?`, k);
      if (existing && existing.window_start === windowStart && existing.count >= policy.limit) {
        return { allowed: false, retryAfterSeconds: retryAfter(windowStart + policy.windowMs, t) };
      }
      // One atomic upsert: same window → count + 1; a new window resets to 1.
      // (Unqualified columns in DO UPDATE read the existing row; excluded.* the new one.)
      const row = await first<{ count: number }>(
        db,
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
           window_start = excluded.window_start
         RETURNING count`,
        k,
        windowStart
      );
      const count = row?.count ?? 1;
      if (count <= policy.limit) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: retryAfter(windowStart + policy.windowMs, t) };
    },
  };
}

export function createD1FailureTracker(db: DB, opts: { now?: () => number } = {}): FailureTracker {
  const now = (): number => (opts.now ?? _rateLimitTestHooks.now ?? Date.now)();
  return {
    async status(policy, key) {
      const t = now();
      const row = await first<{ locked_until: number | null }>(
        db,
        `SELECT locked_until FROM auth_failures WHERE key = ?`,
        `${policy.name}:${key}`
      );
      if (!row?.locked_until || row.locked_until <= t) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: retryAfter(row.locked_until, t) };
    },

    async recordFailure(policy, key) {
      const t = now();
      const k = `${policy.name}:${key}`;
      // Atomic count: within the window → failures + 1; a stale window starts over
      // (and wipes any stale lock so an old lockout can't outlive its window).
      const row = await first<{ failures: number }>(
        db,
        `INSERT INTO auth_failures (key, failures, window_start, locked_until) VALUES (?, 1, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET
           failures = CASE WHEN ? - window_start < ? THEN failures + 1 ELSE 1 END,
           locked_until = CASE WHEN ? - window_start < ? THEN locked_until ELSE NULL END,
           window_start = CASE WHEN ? - window_start < ? THEN window_start ELSE ? END
         RETURNING failures`,
        k, t, t, policy.windowMs, t, policy.windowMs, t, policy.windowMs, t
      );
      const failures = row?.failures ?? 1;
      if (failures < policy.maxFailures) return;
      // Escalating backoff: the base doubles per failure past the threshold, capped.
      // A separate statement — a lost race slightly under-locks, never over-locks.
      const lockMs = Math.min(policy.baseLockoutMs * 2 ** (failures - policy.maxFailures), policy.maxLockoutMs);
      await run(db, `UPDATE auth_failures SET locked_until = ? WHERE key = ?`, t + lockMs, k);
    },

    async clear(policy, key) {
      await run(db, `DELETE FROM auth_failures WHERE key = ?`, `${policy.name}:${key}`);
    },
  };
}

/**
 * The rate-limit identity of an unauthenticated client: Cloudflare's
 * CF-Connecting-IP, set on every request that traverses Cloudflare (including
 * wrangler dev), bucketed by `bucketIp`. The "unknown" fallback only aggregates
 * non-Cloudflare traffic (e.g. direct sub-app invocations in tests) into one
 * shared bucket — sharing a bucket can only tighten, never widen, access.
 */
export function clientIp(c: Context): string {
  return bucketIp(c.req.header("cf-connecting-ip") ?? "unknown");
}

/**
 * Collapse a client address into its rate-limit bucket key. IPv4 addresses (and
 * the non-IP "unknown" fallback) key as-is. IPv6 clients are bucketed by their
 * routed /64 prefix: a single host routinely controls an entire /64, so keying by
 * the full 128-bit address would let one machine mint unbounded distinct buckets —
 * trivially bypassing every per-IP limit AND growing rate_limits/auth_failures one
 * permanent-until-evicted row per probe. Compressed ("::") and zero-padded forms
 * of the same address normalize to the same bucket.
 */
export function bucketIp(raw: string): string {
  // No colon → IPv4 or the "unknown" fallback. A dot alongside colons is an
  // IPv4-mapped/embedded form (e.g. "::ffff:1.2.3.4") — key it verbatim rather
  // than mis-parse it (Cloudflare sends plain dotted-quad for IPv4 clients).
  if (!raw.includes(":") || raw.includes(".")) return raw;
  const [head = "", tail = ""] = raw.split("::"); // at most one "::" in a valid address
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  const prefix = groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "") || "0").join(":");
  return `${prefix}::/64`;
}

// The longest wired fixed window: a rate_limits row whose window started earlier
// than this can never influence a decision again (per-policy horizons would be
// tighter, but one conservative bound keeps eviction a single statement).
export const MAX_POLICY_WINDOW_MS = Math.max(
  LOGIN_RATE.windowMs, CALLBACK_RATE.windowMs, SESSION_RATE.windowMs, MCP_TOKEN_RATE.windowMs
);

/**
 * Evict spent abuse-control rows — called from the scheduled() cron (src/index.ts),
 * unconditionally (it must run even where the GitHub App isn't configured). Without
 * eviction every distinct client key leaves a permanent row, so a host rotating
 * through addresses (see bucketIp) could grow these tables without bound.
 * Deletes only state that can no longer influence any decision: rate_limits rows
 * whose window is fully past every wired policy's horizon, and auth_failures rows
 * whose counting window expired AND whose lockout (if any) has elapsed.
 */
export async function evictStaleAbuseState(db: DB, opts: { now?: () => number } = {}): Promise<void> {
  const t = (opts.now ?? _rateLimitTestHooks.now ?? Date.now)();
  await run(db, `DELETE FROM rate_limits WHERE window_start < ?`, t - MAX_POLICY_WINDOW_MS);
  await run(db,
    `DELETE FROM auth_failures WHERE window_start < ? AND (locked_until IS NULL OR locked_until <= ?)`,
    t - AUTH_FAILURE_LOCKOUT.windowMs, t);
}

/**
 * Soft-rollout signup gate (issue #21): LOGIN_ALLOWLIST is a comma-separated list
 * of GitHub logins allowed in. Empty/absent ⇒ open signup (any GitHub user) — the
 * Phase B default. Case-insensitive, because GitHub logins are. Enforced in TWO
 * places, and both are required for the toggle to work as an abuse brake:
 *  - the sign-in callback, AFTER the user is identified (a friendly 403 before
 *    anything is provisioned), and
 *  - every principal resolution — sessionGate (session cookie + bearer fallback)
 *    and the /mcp bearer path in src/index.ts — so flipping the list on ALSO cuts
 *    off already-minted 30-day sessions and never-expiring mcp_tokens for
 *    non-listed logins, not just new sign-ins. Cheap: an in-memory string check,
 *    no extra DB work.
 */
export function loginAllowed(env: Env, login: string): boolean {
  const allow = (env.LOGIN_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.length === 0 || allow.includes(login.toLowerCase());
}

/** The uniform refusal for every limited surface: 429 + Retry-After (seconds). */
export function tooManyRequests(c: Context, decision: RateLimitDecision): Response {
  return c.json({ error: "rate_limited" }, 429, { "Retry-After": String(decision.retryAfterSeconds) });
}
