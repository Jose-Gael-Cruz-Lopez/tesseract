import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { InstallationRow, RepoRow } from "@shared/rows";
import type { Env } from "../src/env";
import { _clearInstallationTokenCache } from "../src/auth/app";
import { syncInstallationFromApp } from "../src/auth/connect";

// A throwaway RSA keypair + an env carrying its private key as a PKCS#8 PEM, so the
// App-JWT signing path (appJwt / installationToken) runs for real inside the sync.
async function makeAppEnv(): Promise<Env> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let raw = "";
  for (const b of pkcs8) raw += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(raw).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
  return { ...env, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: pem } as Env;
}

// Phase 3 (GitHub App / connect-your-repos): the post-install callback sync — pull the
// installation's account + repo list straight from the App API (not a webhook payload)
// and upsert both the installations registry and the repos connection rows.
describe("connect-your-repos install callback sync (auth/connect.ts)", () => {
  it("syncInstallationFromApp records the install and connects its repos", async () => {
    _clearInstallationTokenCache(); // don't inherit a cached token from another case
    const appEnv = await makeAppEnv();

    // URL-routing mock: token mint (POST), the App-level install lookup (GET), and the
    // installation's repo list (GET). Check /access_tokens before /app/installations/
    // since the mint URL contains that prefix.
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/access_tokens")) {
        return new Response(
          JSON.stringify({ token: "ghs_x", expires_at: new Date((1_000_000 + 3600) * 1000).toISOString() }),
          { status: 200 }
        );
      }
      if (u.includes("/installation/repositories")) {
        return new Response(
          JSON.stringify({ repositories: [{ full_name: "octocat/app" }, { full_name: "octocat/site" }] }),
          { status: 200 }
        );
      }
      if (u.includes("/app/installations/")) {
        return new Response(JSON.stringify({ account: { login: "octocat", type: "User" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const res = await syncInstallationFromApp(appEnv, env.DB, 555, "installer", "2026-07-11T00:00:00Z", {
      fetchImpl,
      nowSec: 1_000_000,
    });
    expect(res).toEqual({ repos: ["octocat/app", "octocat/site"] });

    // installations row upserted from the App-level account read.
    const inst = await env.DB.prepare(`SELECT * FROM installations WHERE installation_id = 555`).first<InstallationRow>();
    expect(inst).toMatchObject({ account_login: "octocat", account_type: "User", suspended_at: null });

    // Both repos connected under the installation.
    for (const repo of ["octocat/app", "octocat/site"]) {
      const row = await env.DB.prepare(`SELECT * FROM repos WHERE repo = ?`).bind(repo).first<RepoRow>();
      expect(row?.status).toBe("connected");
      expect(row?.installation_id).toBe(555);
    }
  });
});
