import { env } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/index";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";
import { mintToken } from "../src/auth/tokens";
import { runSelfCheck, _selfCheckTestHooks, _resetSelfCheckTestHooks } from "../src/auth/selfcheck";
import type { Env } from "../src/env";

// Spec: specs/secret-selfcheck.md
//
// Functionally exercises each configured secret so a present-but-WRONG credential is
// caught. Three of the five production bugs found on 2026-07-28 were exactly that:
// `wrangler secret list` reported the name, the value was junk, and nothing noticed
// for up to 10 days.

const APP_ENV = (over: Partial<Env> = {}): Env =>
  ({
    ...env,
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-key\n-----END RSA PRIVATE KEY-----",
    GITHUB_APP_CLIENT_ID: "Iv1.testclient",
    GITHUB_APP_CLIENT_SECRET: "test-app-secret",
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    ...over,
  }) as Env;

/** A fetch stub answering the token endpoint with `error`, and /app with `appStatus`. */
const stubFetch = (opts: { tokenError?: string; tokenStatus?: number; appStatus?: number }): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("login/oauth/access_token")) {
      if (opts.tokenStatus && opts.tokenStatus >= 400) return new Response("nope", { status: opts.tokenStatus });
      return new Response(JSON.stringify({ error: opts.tokenError ?? "bad_verification_code" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ slug: "memo-sphere" }), {
      status: opts.appStatus ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

const find = (r: Awaited<ReturnType<typeof runSelfCheck>>, secret: string) =>
  r.secrets.find((s) => s.secret === secret)!;

/**
 * A REAL RSA private key in the PKCS#8 PEM form `appJwt` expects. Without this the App
 * probe is untestable past its first line: `importPrivateKey` (src/auth/app.ts) rejects
 * any fake PEM, so the probe returns `indeterminate` before it ever fetches, and the
 * pass/fail verdicts of R2 would go unverified.
 */
async function realPrivateKeyPem(): Promise<string> {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  // exportKey is typed ArrayBuffer | JsonWebKey; the "pkcs8" format always yields the former.
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const body = btoa(bin).match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

afterEach(() => {
  _resetSelfCheckTestHooks();
  vi.restoreAllMocks();
});

describe("runSelfCheck — client-credential probe (DoD 5, 6, 7)", () => {
  it("incorrect_client_credentials → fail for GITHUB_APP_CLIENT_SECRET", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({ tokenError: "incorrect_client_credentials" }) });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("bad_verification_code → pass (credentials accepted, only the code was rejected)", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({ tokenError: "bad_verification_code" }) });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("pass");
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").verified).toBe(true);
  });

  it("HTTP 503 from GitHub → indeterminate, never fail", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({ tokenStatus: 503 }) });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("indeterminate");
  });

  it("an unrecognised error value → indeterminate, never pass", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({ tokenError: "something_new" }) });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("indeterminate");
  });
});

describe("runSelfCheck — App JWT probe (R2)", () => {
  // Uses a genuine key so appJwt succeeds and the probe actually reaches GitHub —
  // otherwise only the throw→indeterminate arm is ever exercised.
  it("GET /app returning 200 → pass for both App secrets", async () => {
    const env2 = APP_ENV({ GITHUB_APP_PRIVATE_KEY: await realPrivateKeyPem() });
    const r = await runSelfCheck(env2, { fetchImpl: stubFetch({ appStatus: 200 }) });
    expect(find(r, "GITHUB_APP_ID").status).toBe("pass");
    expect(find(r, "GITHUB_APP_PRIVATE_KEY").status).toBe("pass");
    expect(find(r, "GITHUB_APP_PRIVATE_KEY").verified).toBe(true);
  });

  it("GET /app returning 401 → fail (GitHub rejected the JWT)", async () => {
    const env2 = APP_ENV({ GITHUB_APP_PRIVATE_KEY: await realPrivateKeyPem() });
    const r = await runSelfCheck(env2, { fetchImpl: stubFetch({ appStatus: 401 }) });
    expect(find(r, "GITHUB_APP_ID").status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("GET /app returning 500 → indeterminate, never fail", async () => {
    const env2 = APP_ENV({ GITHUB_APP_PRIVATE_KEY: await realPrivateKeyPem() });
    const r = await runSelfCheck(env2, { fetchImpl: stubFetch({ appStatus: 500 }) });
    expect(find(r, "GITHUB_APP_ID").status).toBe("indeterminate");
  });
});

describe("runSelfCheck — COOKIE_SECRET (DoD 8)", () => {
  it("a working value round-trips → pass", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({}) });
    expect(find(r, "COOKIE_SECRET").status).toBe("pass");
  });

  it("an empty COOKIE_SECRET → fail", async () => {
    const r = await runSelfCheck(APP_ENV({ COOKIE_SECRET: "" }), { fetchImpl: stubFetch({}) });
    expect(find(r, "COOKIE_SECRET").status).toBe("fail");
  });
});

describe("runSelfCheck — optional and unverifiable secrets (DoD 9, 10)", () => {
  it("GEMINI_API_KEY absent → degraded, never fail", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({}) });
    expect(find(r, "GEMINI_API_KEY").status).toBe("degraded");
    expect(r.ok).toBe(true); // degraded must not sink the overall verdict
  });

  it("GEMINI_API_KEY present → pass, marked unverified (presence only)", async () => {
    const r = await runSelfCheck(APP_ENV({ GEMINI_API_KEY: "a-key" }), { fetchImpl: stubFetch({}) });
    expect(find(r, "GEMINI_API_KEY").status).toBe("pass");
    expect(find(r, "GEMINI_API_KEY").verified).toBe(false);
  });

  it("GITHUB_WEBHOOK_SECRET present → pass but explicitly NOT verified", async () => {
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({}) });
    const w = find(r, "GITHUB_WEBHOOK_SECRET");
    expect(w.status).toBe("pass");
    expect(w.verified).toBe(false); // presence is not correctness — the whole point
  });

  it("GITHUB_WEBHOOK_SECRET absent → fail", async () => {
    const r = await runSelfCheck(APP_ENV({ GITHUB_WEBHOOK_SECRET: "" }), { fetchImpl: stubFetch({}) });
    expect(find(r, "GITHUB_WEBHOOK_SECRET").status).toBe("fail");
  });
});

describe("runSelfCheck — empty means absent (DoD 11)", () => {
  it("a whitespace-only required secret is fail, never pass", async () => {
    const r = await runSelfCheck(APP_ENV({ GITHUB_APP_CLIENT_SECRET: "   " }), { fetchImpl: stubFetch({}) });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("fail");
  });
});

describe("runSelfCheck — alerting contract (DoD 12, 13)", () => {
  const jsonLines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(String(c[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null && r.event === "selfcheck");

  it("a fail emits exactly one error-level selfcheck line naming the secret", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runSelfCheck(APP_ENV(), { fetchImpl: stubFetch({ tokenError: "incorrect_client_credentials" }) });
    const lines = jsonLines(error).filter((l) => l.secret === "GITHUB_APP_CLIENT_SECRET");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "selfcheck", secret: "GITHUB_APP_CLIENT_SECRET" });
    expect(typeof lines[0].outcome).toBe("string");
    expect(typeof lines[0].reason).toBe("string");
  });

  it("degraded and indeterminate never reach console.error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // 503 everywhere → indeterminate; GEMINI_API_KEY unset → degraded. No fails.
    await runSelfCheck(APP_ENV({ GITHUB_WEBHOOK_SECRET: "present" }), {
      fetchImpl: stubFetch({ tokenStatus: 503, appStatus: 503 }),
    });
    expect(jsonLines(error)).toEqual([]);
  });
});

describe("runSelfCheck — output safety (DoD 17)", () => {
  it("never leaks a secret's value, a 4+ char substring of it, or its length", async () => {
    // Deliberately free of dictionary fragments: the report's own schema uses the field
    // name "secret" (spec R18), so a sentinel containing "secr" would fail this
    // assertion no matter how the implementation behaved. This value shares no 4-char
    // run with the schema, so the assertion tests leakage and nothing else.
    const value = "zq7xk9vw3mtj5pnr8bdf2hgy4cls6a";
    const r = await runSelfCheck(APP_ENV({ GITHUB_APP_CLIENT_SECRET: value }), {
      fetchImpl: stubFetch({ tokenError: "incorrect_client_credentials" }),
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(value);
    for (let i = 0; i + 4 <= value.length; i++) {
      expect(serialized).not.toContain(value.slice(i, i + 4));
    }
    expect(serialized).not.toContain(String(value.length));
  });
});

describe("runSelfCheck — containment (DoD 15, 16)", () => {
  it("a probe that throws yields indeterminate and does not stop the others", async () => {
    const boom: typeof fetch = (async () => {
      throw new Error("network exploded");
    }) as unknown as typeof fetch;
    const r = await runSelfCheck(APP_ENV(), { fetchImpl: boom });
    expect(find(r, "GITHUB_APP_CLIENT_SECRET").status).toBe("indeterminate");
    // Local probes are unaffected by a network fault.
    expect(find(r, "COOKIE_SECRET").status).toBe("pass");
  });
});

describe("scheduled() isolation — the self-check can never break the cron (DoD 15, 16)", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const controller = {} as ScheduledController;

  it("runs the self-check and still completes the cron when every probe throws", async () => {
    _selfCheckTestHooks.fetchImpl = (async () => {
      throw new Error("every probe explodes");
    }) as unknown as typeof fetch;

    // Seed an abuse-control row: evictStaleAbuseState runs in the same handler, so its
    // effect is observable proof the cron completed rather than dying in the check.
    await env.DB.prepare(`INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, 0, 1)`)
      .bind("selfcheck-cron-probe")
      .run();

    const noApp = { ...env, GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: undefined } as unknown as Env;
    await expect(worker.scheduled(controller, noApp, ctx)).resolves.toBeUndefined();

    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_limits`).first<{ n: number }>();
    expect(left?.n).toBe(0); // eviction still ran — the self-check did not abort the cron
  });
});

describe("GET /admin/selfcheck — authorization (DoD 1, 2, 3, 4)", () => {
  it("401 without any credentials", async () => {
    const res = await app.request("/admin/selfcheck", {}, APP_ENV());
    expect(res.status).toBe(401);
  });

  it("403 for a valid non-admin session", async () => {
    _selfCheckTestHooks.fetchImpl = stubFetch({});
    const res = await app.request("/admin/selfcheck", { headers: { cookie: await authedCookie("nobody") } }, APP_ENV());
    expect(res.status).toBe(403);
  });

  it("200 with a full report for an admin session", async () => {
    _selfCheckTestHooks.fetchImpl = stubFetch({});
    const res = await app.request(
      "/admin/selfcheck",
      { headers: { cookie: await authedCookie("admin-user") } },
      APP_ENV()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Awaited<ReturnType<typeof runSelfCheck>>;
    const names = body.secrets.map((s) => s.secret);
    for (const s of [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "COOKIE_SECRET",
      "GEMINI_API_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]) {
      expect(names).toContain(s);
    }
  });

  it("200 for a bearer token even while the App credentials are broken (break-glass)", async () => {
    // The scenario this route exists for: App creds are wrong, so no session can be
    // obtained at all. A pre-existing bearer must still get the report.
    _selfCheckTestHooks.fetchImpl = stubFetch({ tokenError: "incorrect_client_credentials" });
    // mcp_tokens references users(github_login) — seed the row before minting.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (github_login, name, avatar_url, created_at) VALUES (?, ?, NULL, ?)`
    )
      .bind("someone", "someone", "2026-01-01T00:00:00Z")
      .run();
    const { raw } = await mintToken(env.DB, "someone");
    const res = await app.request("/admin/selfcheck", { headers: { authorization: `Bearer ${raw}` } }, APP_ENV());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Awaited<ReturnType<typeof runSelfCheck>>;
    expect(body.ok).toBe(false);
    expect(body.secrets.find((s) => s.secret === "GITHUB_APP_CLIENT_SECRET")!.status).toBe("fail");
  });

  it("401 for a bearer that does not resolve", async () => {
    const res = await app.request(
      "/admin/selfcheck",
      { headers: { authorization: "Bearer canopy_mcp_nope" } },
      APP_ENV()
    );
    expect(res.status).toBe(401);
  });
});
