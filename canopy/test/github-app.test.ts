import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { InstallationRow, RepoAccessRow } from "@shared/rows";
import type { Env } from "../src/env";
import { appJwt, installationToken, _clearInstallationTokenCache } from "../src/auth/app";

const b64urlDecode = (s: string): string => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + (b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : ""));
};

// A throwaway RSA keypair + an env carrying its private key as a PKCS#8 PEM, so the
// App-JWT signing path is exercised for real (and verifiable against the public key).
async function makeAppEnv(): Promise<{ appEnv: Env; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let raw = "";
  for (const b of pkcs8) raw += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(raw).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
  return { appEnv: { ...env, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: pem } as Env, publicKey: pair.publicKey };
}

// Phase 3 (GitHub App / connect-your-repos): the connection data model — repos.status
// (soft-disconnect), the installations registry, and the repo_access cache backing repoGate.
describe("GitHub App data model (0024)", () => {
  it("repos.status defaults to 'connected'", async () => {
    await env.DB.prepare(`INSERT INTO repos (repo, added_at) VALUES ('acme/app', '2026-07-11T00:00:00Z')`).run();
    const row = await env.DB.prepare(`SELECT status FROM repos WHERE repo = 'acme/app'`).first<{ status: string }>();
    expect(row?.status).toBe("connected");
  });

  it("installations holds one row per install, keyed by installation_id", async () => {
    await env.DB.prepare(
      `INSERT INTO installations (installation_id, account_login, account_type, created_at) VALUES (?, ?, ?, ?)`
    ).bind(42, "octocat", "User", "2026-07-11T00:00:00Z").run();
    const row = await env.DB.prepare(`SELECT * FROM installations WHERE installation_id = 42`).first<InstallationRow>();
    expect(row?.account_login).toBe("octocat");
    expect(row?.account_type).toBe("User");
    expect(row?.suspended_at).toBeNull();
  });

  it("repo_access caches per-(user,repo) access; (login, repo) is the PK", async () => {
    await env.DB.prepare(
      `INSERT INTO repo_access (login, repo, can_push, checked_at) VALUES (?, ?, ?, ?)`
    ).bind("octocat", "acme/app", 1, "2026-07-11T00:00:00Z").run();
    const row = await env.DB.prepare(`SELECT * FROM repo_access WHERE login = 'octocat' AND repo = 'acme/app'`).first<RepoAccessRow>();
    expect(row?.can_push).toBe(1);
    // A second row for the same (login, repo) collides on the PK.
    await expect(
      env.DB.prepare(`INSERT INTO repo_access (login, repo, can_push, checked_at) VALUES ('octocat', 'acme/app', 0, 'x')`).run()
    ).rejects.toThrow();
  });
});

// Phase 3: the App client — App JWT (RS256) + per-installation token minting/caching.
describe("GitHub App client (auth/app.ts)", () => {
  it("appJwt signs a valid RS256 JWT the App public key verifies", async () => {
    const { appEnv, publicKey } = await makeAppEnv();
    const jwt = await appJwt(appEnv, 1_000_000);
    const [h, p, s] = jwt.split(".");

    expect(JSON.parse(b64urlDecode(h))).toMatchObject({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(b64urlDecode(p));
    expect(payload).toMatchObject({ iss: "12345", iat: 1_000_000 - 60, exp: 1_000_000 + 540 });

    const sig = Uint8Array.from(b64urlDecode(s), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`)
    );
    expect(ok).toBe(true);
  });

  it("appJwt throws when the App is not configured", async () => {
    await expect(appJwt({ ...env, GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: undefined } as Env)).rejects.toThrow("not configured");
  });

  it("installationToken mints via the App JWT and caches per installation", async () => {
    _clearInstallationTokenCache();
    const { appEnv } = await makeAppEnv();
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toContain("/app/installations/77/access_tokens");
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
      return new Response(
        JSON.stringify({ token: "ghs_test", expires_at: new Date((1_000_000 + 3600) * 1000).toISOString() }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const t1 = await installationToken(appEnv, 77, { fetchImpl, nowSec: 1_000_000 });
    const t2 = await installationToken(appEnv, 77, { fetchImpl, nowSec: 1_000_000 });
    expect(t1).toBe("ghs_test");
    expect(t2).toBe("ghs_test");
    expect(calls).toBe(1); // minted once, then served from cache
  });
});
