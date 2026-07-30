import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../src/env";
import { _clearInstallationTokenCache } from "../src/auth/app";
import { handleInstallationEvent, syncInstallationFromApp } from "../src/auth/connect";

// Issue #36: `recordInstallation` wrote `suspended_at` unconditionally, so any caller
// that didn't pass one cleared it. `syncInstallationFromApp` is exactly such a caller,
// which made a plain re-sync silently un-suspend an installation GitHub still considers
// suspended. Latent when found (nothing reads the column yet) — pinned here so it stays
// fixed for whatever reads it first.

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

/** The three calls a sync makes: token mint, App-level install lookup, paged repo list. */
function ghFetch(repos: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/access_tokens")) {
      return new Response(
        JSON.stringify({ token: "ghs_x", expires_at: new Date((1_000_000 + 3600) * 1000).toISOString() }),
        { status: 200 }
      );
    }
    if (u.includes("/installation/repositories")) {
      const page = Number(new URL(u).searchParams.get("page") ?? "1");
      const body = page === 1 ? repos : [];
      return new Response(JSON.stringify({ repositories: body.map((full_name) => ({ full_name })) }), { status: 200 });
    }
    if (u.includes("/app/installations/")) {
      return new Response(JSON.stringify({ account: { login: "octocat", type: "User" } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
}

const suspendedAt = async (installationId: number) =>
  (
    await env.DB.prepare(`SELECT suspended_at FROM installations WHERE installation_id = ?`)
      .bind(installationId)
      .first<{ suspended_at: string | null }>()
  )?.suspended_at;

const SUSPENDED = "2026-07-11T00:00:00Z";

/** Drive the real suspend branch rather than seeding the row by hand. */
const suspend = (installationId: number) =>
  handleInstallationEvent(
    env as Env,
    env.DB,
    "installation",
    {
      action: "suspend",
      installation: { id: installationId, account: { login: "octocat", type: "User" } },
      sender: { login: "octocat" },
    },
    SUSPENDED
  );

describe("suspended_at survives a re-sync (issue #36)", () => {
  beforeEach(() => {
    _clearInstallationTokenCache(); // don't inherit a cached token across cases
  });

  // ── THE BUG ───────────────────────────────────────────────────────────────
  it("syncInstallationFromApp preserves a suspension it was never told about", async () => {
    const appEnv = await makeAppEnv();
    await suspend(100);
    expect(await suspendedAt(100)).toBe(SUSPENDED); // precondition: really suspended

    await syncInstallationFromApp(appEnv, env.DB, 100, "octocat", "2026-07-11T00:05:00Z", {
      fetchImpl: ghFetch(["octocat/canopy"]),
      nowSec: 1_000_000,
    });

    expect(await suspendedAt(100)).toBe(SUSPENDED); // GitHub still considers it suspended
  });

  // PR #35 routed the installation_repositories reconcile through syncInstallationFromApp,
  // giving the same flaw a second, webhook-driven trigger. It is genuinely reachable for a
  // suspended install: the account read succeeds before the token mint would fail.
  it("the installation_repositories reconcile preserves it too", async () => {
    const appEnv = await makeAppEnv();
    await suspend(100);

    const res = await handleInstallationEvent(
      appEnv,
      env.DB,
      "installation_repositories",
      {
        action: "added",
        installation: { id: 100 },
        repositories_added: [{ full_name: "octocat/canopy" }],
        repositories_removed: [],
        sender: { login: "octocat" },
      },
      "2026-07-11T00:05:00Z",
      { fetchImpl: ghFetch(["octocat/canopy"]), nowSec: 1_000_000 }
    );

    expect(res).toMatchObject({ handled: true, reconciled: true }); // the reconcile really ran
    expect(await suspendedAt(100)).toBe(SUSPENDED);
  });

  // ── The other direction, which a careless fix breaks ───────────────────────
  // Preserving must mean "the caller said nothing", NOT "the value was null". A blanket
  // COALESCE(excluded.suspended_at, suspended_at) would pass every test above and leave a
  // suspension that can never be lifted.
  it("unsuspend still clears it — an explicit null is not a plain re-sync", async () => {
    await suspend(100);

    await handleInstallationEvent(
      env as Env,
      env.DB,
      "installation",
      {
        action: "unsuspend",
        installation: { id: 100, account: { login: "octocat", type: "User" } },
        sender: { login: "octocat" },
      },
      "2026-07-11T00:05:00Z"
    );

    expect(await suspendedAt(100)).toBeNull();
  });

  it("a re-sync of a never-suspended installation leaves it null", async () => {
    const appEnv = await makeAppEnv();
    await syncInstallationFromApp(appEnv, env.DB, 100, "octocat", "2026-07-11T00:00:00Z", {
      fetchImpl: ghFetch(["octocat/canopy"]),
      nowSec: 1_000_000,
    });
    expect(await suspendedAt(100)).toBeNull();

    await syncInstallationFromApp(appEnv, env.DB, 100, "octocat", "2026-07-11T00:05:00Z", {
      fetchImpl: ghFetch(["octocat/canopy"]),
      nowSec: 1_000_000,
    });

    expect(await suspendedAt(100)).toBeNull(); // preserving null is still null
  });

  // installation.created deliberately keeps CLEARING rather than preserving: GitHub
  // reporting the install as just-created contradicts a stored suspension.
  it("installation.created clears a stale suspension on the same id", async () => {
    await suspend(100);

    await handleInstallationEvent(
      env as Env,
      env.DB,
      "installation",
      {
        action: "created",
        installation: { id: 100, account: { login: "octocat", type: "User" } },
        repositories: [{ full_name: "octocat/canopy" }],
        sender: { login: "octocat" },
      },
      "2026-07-11T00:05:00Z"
    );

    expect(await suspendedAt(100)).toBeNull();
  });

  it("a re-sync does not disturb the account columns it does own", async () => {
    const appEnv = await makeAppEnv();
    await suspend(100);

    await syncInstallationFromApp(appEnv, env.DB, 100, "octocat", "2026-07-11T00:05:00Z", {
      fetchImpl: ghFetch(["octocat/canopy"]),
      nowSec: 1_000_000,
    });

    const row = await env.DB.prepare(`SELECT * FROM installations WHERE installation_id = ?`)
      .bind(100)
      .first<{ account_login: string; account_type: string; suspended_at: string | null }>();
    expect(row).toMatchObject({ account_login: "octocat", account_type: "User", suspended_at: SUSPENDED });
  });
});
