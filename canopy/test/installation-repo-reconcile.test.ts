import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
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

// One page of GET /installation/repositories: a list of full names (served 200) or a
// bare HTTP status (served as that failure). Pages are indexed by GitHub's ?page=N.
type RepoPage = string[] | number;

/**
 * A URL-routing GitHub mock covering the three calls the sync makes: the token mint
 * (POST), the App-level install lookup (GET), and the paged repo list. Any URL it
 * doesn't recognise THROWS rather than 404s, so a test can never silently reach the
 * network (the vitest pool has no fetch mock).
 */
function ghFetch(repoPages: RepoPage[], seen?: number[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    // Check the mint before the /app/installations/ prefix — the mint URL contains it.
    if (u.includes("/access_tokens")) {
      return new Response(
        JSON.stringify({ token: "ghs_x", expires_at: new Date((1_000_000 + 3600) * 1000).toISOString() }),
        { status: 200 }
      );
    }
    if (u.includes("/installation/repositories")) {
      const page = Number(new URL(u).searchParams.get("page") ?? "1");
      seen?.push(page);
      const spec = repoPages[page - 1];
      if (spec === undefined) return new Response("unexpected page", { status: 500 });
      if (typeof spec === "number") return new Response("boom", { status: spec });
      return new Response(JSON.stringify({ repositories: spec.map((full_name) => ({ full_name })) }), { status: 200 });
    }
    if (u.includes("/app/installations/")) {
      return new Response(JSON.stringify({ account: { login: "octocat", type: "User" } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
}

// Issue #33: the installation repo list is about to become the AUTHORITATIVE input to a
// reconcile, so it has to be complete first. A single-page read of an account with >100
// repos would make page 1 look like the whole truth — and everything past it like it had
// been de-scoped.
describe("installation repo list is fully paginated (issue #33)", () => {
  beforeEach(() => {
    _clearInstallationTokenCache(); // don't inherit a cached token across cases
  });

  const status = async (repo: string) =>
    (await env.DB.prepare(`SELECT status FROM repos WHERE repo = ?`).bind(repo).first<{ status: string }>())?.status;

  it("syncInstallationFromApp paginates past the first 100 repos", async () => {
    const appEnv = await makeAppEnv();
    const page1 = Array.from({ length: 100 }, (_, i) => `octocat/p${i}`);
    const page2 = ["octocat/tail-a", "octocat/tail-b"];
    const seen: number[] = [];

    const res = await syncInstallationFromApp(appEnv, env.DB, 100, "installer", "2026-07-11T00:00:00Z", {
      fetchImpl: ghFetch([page1, page2], seen),
      nowSec: 1_000_000,
    });

    expect(seen).toEqual([1, 2]); // a full page is followed, a short page terminates
    expect(res.repos).toHaveLength(102);
    expect(await status("octocat/p0")).toBe("connected");
    expect(await status("octocat/tail-b")).toBe("connected");
  });

  it("a failed page throws instead of returning a prefix — nothing partial reaches D1", async () => {
    const appEnv = await makeAppEnv();
    const page1 = Array.from({ length: 100 }, (_, i) => `octocat/p${i}`); // full page ⇒ page 2 follows

    await expect(
      syncInstallationFromApp(appEnv, env.DB, 100, "installer", "2026-07-11T00:00:00Z", {
        fetchImpl: ghFetch([page1, 500]),
        nowSec: 1_000_000,
      })
    ).rejects.toThrow();

    expect(await status("octocat/p0")).toBeUndefined(); // the half-read list was never written
  });
});
