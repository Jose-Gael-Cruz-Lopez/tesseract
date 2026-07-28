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

