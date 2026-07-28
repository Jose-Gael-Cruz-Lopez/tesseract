import type { Env } from "../env";
import { logEvent } from "../log";
import { hmacSeal, hmacUnseal } from "./crypto";
import { appJwt } from "./app";

// Secret self-check — specs/secret-selfcheck.md
//
// `wrangler secret list` proves a NAME exists. It says nothing about the VALUE, and on
// 2026-07-28 that gap accounted for three of five production bugs: a client secret that
// didn't match the App (sign-in impossible), a webhook secret that didn't match (every
// delivery 401, `events` stuck at 0), and — historically — an empty GITHUB_APP_CLIENT_ID
// stored by an interactive `secret put` that still printed "Success!". Each was invisible
// for hours to days.
//
// So this exercises secrets FUNCTIONALLY, and is scrupulous about the difference between
// "verified working" and "merely present": conflating those is the exact failure mode it
// exists to end. Every report entry carries `verified` for that reason.

export type SecretStatus = "pass" | "fail" | "indeterminate" | "degraded";

export interface SecretReport {
  secret: string;
  status: SecretStatus;
  /** true = a functional probe backs this status; false = presence only. */
  verified: boolean;
  note: string;
}

export interface SelfCheckReport {
  /** True iff nothing is `fail`. `degraded` and `indeterminate` do not sink it. */
  ok: boolean;
  summary: Record<SecretStatus, number>;
  secrets: SecretReport[];
}

// Test seam, mirroring _mcpTestHooks / _rateLimitTestHooks. Production never sets it.
export const _selfCheckTestHooks: { fetchImpl?: typeof fetch } = {};

export function _resetSelfCheckTestHooks(): void {
  _selfCheckTestHooks.fetchImpl = undefined;
}

/** Bounded so a hung probe can never stall the cron it rides on. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * A deliberately invalid code for the client-credential probe. GitHub validates
 * client_id/client_secret BEFORE the code, so the error it returns discriminates the
 * two: `bad_verification_code` means the credentials were accepted. Nothing is minted,
 * no session opens, no row is written — the probe is side-effect free.
 */
const INVALID_CODE = "canopy-selfcheck-invalid-code";

const SENTINEL = "canopy-selfcheck";

/**
 * Empty or whitespace-only counts as ABSENT. This is the runbook's central gotcha:
 * interactive `wrangler secret put` through an automation shell stores an empty value
 * and still prints "Success!", while `secret list` shows the name as present.
 */
const present = (v: string | undefined): boolean => typeof v === "string" && v.trim() !== "";

interface ProbeOutcome {
  status: SecretStatus;
  verified: boolean;
  note: string;
  reason: string;
}

const absent = (): ProbeOutcome => ({
  status: "fail",
  verified: true,
  note: "not set (or set to an empty value)",
  reason: "absent",
});

const unreachable = (reason: string, note: string): ProbeOutcome => ({
  status: "indeterminate",
  verified: true,
  note,
  reason,
});

async function withTimeout(fn: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY — mint an App JWT and spend it on GET /app. */
async function probeAppJwt(env: Env, doFetch: typeof fetch): Promise<ProbeOutcome> {
  if (!present(env.GITHUB_APP_ID) || !present(env.GITHUB_APP_PRIVATE_KEY)) return absent();
  try {
    const jwt = await appJwt(env);
    const res = await withTimeout((signal) =>
      doFetch("https://api.github.com/app", {
        headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "canopy" },
        signal,
      })
    );
    if (res.status === 200) return { status: "pass", verified: true, note: "GitHub accepted the App JWT", reason: "ok" };
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", verified: true, note: "GitHub rejected the App JWT", reason: `http_${res.status}` };
    }
    return unreachable(`http_${res.status}`, `GitHub returned ${res.status}`);
  } catch {
    // A malformed key throws at import time; a fault throws at fetch. Neither PROVES
    // the credential is wrong, so neither may alert.
    return unreachable("probe_error", "could not complete the App JWT probe");
  }
}

/** GITHUB_APP_CLIENT_ID + GITHUB_APP_CLIENT_SECRET — the bug #3 probe. */
async function probeClientCredentials(env: Env, doFetch: typeof fetch): Promise<ProbeOutcome> {
  if (!present(env.GITHUB_APP_CLIENT_ID) || !present(env.GITHUB_APP_CLIENT_SECRET)) return absent();
  try {
    const res = await withTimeout((signal) =>
      doFetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": "canopy" },
        body: JSON.stringify({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code: INVALID_CODE,
        }),
        signal,
      })
    );
    if (!res.ok) return unreachable(`http_${res.status}`, `GitHub returned ${res.status}`);
    const body = (await res.json()) as { error?: string };
    if (body.error === "bad_verification_code") {
      return { status: "pass", verified: true, note: "GitHub accepted the client credentials", reason: "ok" };
    }
    if (body.error === "incorrect_client_credentials") {
      return {
        status: "fail",
        verified: true,
        note: "GitHub rejected the client credentials — the stored value does not match the App",
        reason: "incorrect_client_credentials",
      };
    }
    // Never assume good from a shape we don't recognise.
    return unreachable("unexpected_response", "unrecognised response from GitHub");
  } catch {
    return unreachable("probe_error", "could not complete the client-credential probe");
  }
}

/** COOKIE_SECRET — purely local: seal a sentinel and unseal it again. */
async function probeCookieSecret(env: Env): Promise<ProbeOutcome> {
  if (!present(env.COOKIE_SECRET)) return absent();
  try {
    const sealed = await hmacSeal(SENTINEL, env.COOKIE_SECRET);
    const back = await hmacUnseal(sealed, env.COOKIE_SECRET);
    if (back === SENTINEL) return { status: "pass", verified: true, note: "seals and unseals correctly", reason: "ok" };
    return { status: "fail", verified: true, note: "seal/unseal round-trip did not match", reason: "roundtrip_failed" };
  } catch {
    return { status: "fail", verified: true, note: "seal/unseal threw", reason: "roundtrip_threw" };
  }
}

/** GEMINI_API_KEY — optional by design; absent means degraded summaries, not breakage. */
function probeGemini(env: Env): ProbeOutcome {
  if (present(env.GEMINI_API_KEY)) {
    return { status: "pass", verified: false, note: "set (not exercised)", reason: "present" };
  }
  return {
    status: "degraded",
    verified: false,
    note: "not set — PR/issue summaries fall back to the excerpt path; PR cards show no summary",
    reason: "optional_absent",
  };
}

/**
 * GITHUB_WEBHOOK_SECRET — presence ONLY. GitHub never exposes its copy, so the Worker
 * has nothing to compare against; a matching-or-not verdict is impossible here. Real
 * coverage is the webhook's own alerting: a mismatch emits
 * {"event":"webhook","outcome":"unauthorized"} at error level on EVERY delivery.
 * Reporting this as verified would recreate exactly the false confidence that
 * `wrangler secret list` gave us during bug #5.
 */
function probeWebhookSecret(env: Env): ProbeOutcome {
  if (!present(env.GITHUB_WEBHOOK_SECRET)) return absent();
  return {
    status: "pass",
    verified: false,
    note: "set, but NOT verified against GitHub — a mismatch surfaces as webhook unauthorized lines",
    reason: "present_unverified",
  };
}

const OUTCOME: Record<SecretStatus, "success" | "failure" | "indeterminate" | "degraded"> = {
  pass: "success",
  fail: "failure", // the only failure-class outcome → console.error → alertable
  indeterminate: "indeterminate",
  degraded: "degraded",
};

/**
 * Run every probe and report. Never throws: a probe that fails to answer degrades to
 * `indeterminate` rather than propagating, because this runs on the same cron as the
 * progress recompute and must not be able to take it down.
 */
export async function runSelfCheck(env: Env, opts?: { fetchImpl?: typeof fetch }): Promise<SelfCheckReport> {
  const doFetch = opts?.fetchImpl ?? _selfCheckTestHooks.fetchImpl ?? fetch;

  const [appOutcome, clientOutcome, cookieOutcome] = await Promise.all([
    probeAppJwt(env, doFetch),
    probeClientCredentials(env, doFetch),
    probeCookieSecret(env),
  ]);

  // One probe can cover a pair of secrets: a rejected client credential could be either
  // half, so both are reported with the same verdict rather than guessing which is wrong.
  const groups: Array<{ secrets: string[]; outcome: ProbeOutcome }> = [
    { secrets: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"], outcome: appOutcome },
    { secrets: ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"], outcome: clientOutcome },
    { secrets: ["COOKIE_SECRET"], outcome: cookieOutcome },
    { secrets: ["GEMINI_API_KEY"], outcome: probeGemini(env) },
    { secrets: ["GITHUB_WEBHOOK_SECRET"], outcome: probeWebhookSecret(env) },
  ];

  const secrets: SecretReport[] = [];
  const summary: Record<SecretStatus, number> = { pass: 0, fail: 0, indeterminate: 0, degraded: 0 };

  for (const { secrets: names, outcome } of groups) {
    for (const secret of names) {
      secrets.push({ secret, status: outcome.status, verified: outcome.verified, note: outcome.note });
      summary[outcome.status] += 1;
      // One line per non-passing secret, so a spike of one shape is attributable to one
      // credential. `fail` lands at error level (alertable); the rest at info, so a
      // GitHub outage or an intentionally-unset optional key can never page anyone.
      if (outcome.status !== "pass") {
        logEvent({ event: "selfcheck", outcome: OUTCOME[outcome.status], secret, reason: outcome.reason });
      }
    }
  }

  return { ok: summary.fail === 0, summary, secrets };
}
