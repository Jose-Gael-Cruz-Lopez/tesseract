import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { InstallationRow, RepoAccessRow } from "@shared/rows";
import type { Env } from "../src/env";
import {
  appJwt,
  installationToken,
  _clearInstallationTokenCache,
  exchangeUserCode,
  refreshUserToken,
  accessibleRepos,
} from "../src/auth/app";
import { authorizeRepo } from "../src/auth/access";
import { handleInstallationEvent } from "../src/auth/connect";

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
  return {
    appEnv: {
      ...env,
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_CLIENT_ID: "Iv1.testclient",
      GITHUB_APP_CLIENT_SECRET: "testsecret",
    } as Env,
    publicKey: pair.publicKey,
  };
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

// Phase 3: the user-to-server side — code exchange, refresh, and the accessible-repos
// (collaborator) boundary read GitHub-native from /user/installations.
describe("GitHub App user-auth client (auth/app.ts)", () => {
  it("exchangeUserCode returns the user token, refresh token, and computed expiry", async () => {
    const { appEnv } = await makeAppEnv();
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/login/oauth/access_token");
      expect(JSON.parse(init!.body as string)).toMatchObject({ client_id: "Iv1.testclient", code: "abc123" });
      return new Response(JSON.stringify({ access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_y" }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await exchangeUserCode(appEnv, "abc123", { fetchImpl, nowSec: 1000 });
    expect(t).toEqual({ token: "ghu_x", refreshToken: "ghr_y", expiresAt: 1000 + 28800 });
  });

  it("refreshUserToken exchanges a refresh token for a fresh user token", async () => {
    const { appEnv } = await makeAppEnv();
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(init!.body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_old" });
      return new Response(JSON.stringify({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new" }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await refreshUserToken(appEnv, "ghr_old", { fetchImpl, nowSec: 2000 });
    expect(t).toMatchObject({ token: "ghu_new", refreshToken: "ghr_new", expiresAt: 2000 + 28800 });
  });

  it("accessibleRepos flattens repos across the user's installations, with push flags", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/user/installations?")) {
        return new Response(JSON.stringify({ installations: [
          { id: 1, account: { login: "octocat", type: "User" } },
          { id: 2, account: { login: "acme", type: "Organization" } },
        ] }), { status: 200 });
      }
      if (u.includes("/user/installations/1/repositories")) {
        return new Response(JSON.stringify({ repositories: [{ full_name: "octocat/app", permissions: { push: true } }] }), { status: 200 });
      }
      if (u.includes("/user/installations/2/repositories")) {
        return new Response(JSON.stringify({ repositories: [
          { full_name: "acme/site", permissions: { push: false } },
          { full_name: "acme/api" }, // no permissions block → can_push defaults false
        ] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const repos = await accessibleRepos("ghu_x", { fetchImpl });
    expect(repos).toEqual([
      { repo: "octocat/app", can_push: true },
      { repo: "acme/site", can_push: false },
      { repo: "acme/api", can_push: false },
    ]);
  });
});

// Phase 3: repoGate's authorization core — connected + collaborator, TTL-cached.
describe("repo access authorization (auth/access.ts)", () => {
  const connect = (repo: string) =>
    env.DB.prepare(`INSERT INTO repos (repo, added_at, status) VALUES (?, 'x', 'connected')`).bind(repo).run();

  it("denies a repo that isn't connected (no hub), without hitting GitHub", async () => {
    let refreshed = false;
    const r = await authorizeRepo(env.DB, "octocat", "acme/app", async () => {
      refreshed = true;
      return [{ repo: "acme/app", can_push: true }];
    });
    expect(r).toEqual({ allowed: false, canPush: false });
    expect(refreshed).toBe(false); // short-circuits on not-connected
  });

  it("allows a connected repo the user can access, and caches so refresh runs once within TTL", async () => {
    await connect("acme/app");
    let refreshes = 0;
    const refresh = async () => {
      refreshes++;
      return [{ repo: "acme/app", can_push: true }];
    };
    const r1 = await authorizeRepo(env.DB, "octocat", "acme/app", refresh, { now: "2026-07-11T00:00:00Z" });
    const r2 = await authorizeRepo(env.DB, "octocat", "acme/app", refresh, { now: "2026-07-11T00:01:00Z" });
    expect(r1).toEqual({ allowed: true, canPush: true });
    expect(r2).toEqual({ allowed: true, canPush: true });
    expect(refreshes).toBe(1); // second call served from cache
  });

  it("denies a connected repo the user cannot access, negative-cached via their access set", async () => {
    await connect("acme/app");    // the user CAN reach this
    await connect("acme/secret"); // the user CANNOT
    let refreshes = 0;
    const refresh = async () => {
      refreshes++;
      return [{ repo: "acme/app", can_push: true }]; // reaches acme/app only
    };
    // Probing the accessible repo populates the cache with a fresh checked_at.
    expect((await authorizeRepo(env.DB, "octocat", "acme/app", refresh, { now: "2026-07-11T00:00:00Z" })).allowed).toBe(true);
    // Probing the inaccessible repo within TTL: MAX(checked_at) is fresh → no re-fetch, denied.
    const no = await authorizeRepo(env.DB, "octocat", "acme/secret", refresh, { now: "2026-07-11T00:01:00Z" });
    expect(no.allowed).toBe(false);
    expect(refreshes).toBe(1); // the fresh access set already answered "not accessible"
  });

  it("re-syncs past the TTL and revokes access the user has lost", async () => {
    await connect("acme/app");
    await authorizeRepo(env.DB, "octocat", "acme/app", async () => [{ repo: "acme/app", can_push: false }], { now: "2026-07-11T00:00:00Z" });
    // an hour later, access is gone → refresh returns empty → hub closes
    const r = await authorizeRepo(env.DB, "octocat", "acme/app", async () => [], { now: "2026-07-11T01:00:00Z" });
    expect(r.allowed).toBe(false);
  });
});

// Phase 3: connect-your-repos — the installation-lifecycle webhook sync.
describe("connect-your-repos webhook sync (auth/connect.ts)", () => {
  const created = (id: number, repos: string[]) =>
    handleInstallationEvent(
      env.DB,
      "installation",
      { action: "created", installation: { id, account: { login: "octocat", type: "User" } }, repositories: repos.map((r) => ({ full_name: r })), sender: { login: "octocat" } },
      "2026-07-11T00:00:00Z"
    );
  const status = async (repo: string) =>
    (await env.DB.prepare(`SELECT status FROM repos WHERE repo = ?`).bind(repo).first<{ status: string }>())?.status;

  it("installation.created records the install and connects its repos", async () => {
    await created(100, ["octocat/app", "octocat/site"]);
    const inst = await env.DB.prepare(`SELECT * FROM installations WHERE installation_id = 100`).first<InstallationRow>();
    expect(inst).toMatchObject({ account_login: "octocat", account_type: "User", suspended_at: null });
    expect(await status("octocat/app")).toBe("connected");
    expect(await status("octocat/site")).toBe("connected");
  });

  it("installation_repositories added/removed connects and soft-disconnects", async () => {
    await created(100, ["octocat/app"]);
    await handleInstallationEvent(
      env.DB,
      "installation_repositories",
      { action: "added", installation: { id: 100 }, repositories_added: [{ full_name: "octocat/new" }], repositories_removed: [{ full_name: "octocat/app" }], sender: { login: "octocat" } },
      "2026-07-11T00:01:00Z"
    );
    expect(await status("octocat/new")).toBe("connected");
    expect(await status("octocat/app")).toBe("disconnected"); // soft — the row remains
  });

  it("installation.deleted soft-disconnects all the install's repos (rows retained)", async () => {
    await created(100, ["octocat/app", "octocat/site"]);
    await handleInstallationEvent(env.DB, "installation", { action: "deleted", installation: { id: 100 } }, "2026-07-11T00:05:00Z");
    const rows = await env.DB.prepare(`SELECT status FROM repos WHERE installation_id = 100`).all<{ status: string }>();
    expect((rows.results ?? []).length).toBe(2);
    expect((rows.results ?? []).every((r) => r.status === "disconnected")).toBe(true);
  });

  it("installation.suspend/unsuspend toggles suspended_at", async () => {
    await created(100, []);
    const suspendedAt = async () =>
      (await env.DB.prepare(`SELECT suspended_at FROM installations WHERE installation_id = 100`).first<{ suspended_at: string | null }>())?.suspended_at;
    await handleInstallationEvent(env.DB, "installation", { action: "suspend", installation: { id: 100, account: { login: "octocat", type: "User" } } }, "2026-07-11T00:05:00Z");
    expect(await suspendedAt()).toBe("2026-07-11T00:05:00Z");
    await handleInstallationEvent(env.DB, "installation", { action: "unsuspend", installation: { id: 100, account: { login: "octocat", type: "User" } } }, "2026-07-11T00:06:00Z");
    expect(await suspendedAt()).toBeNull();
  });
});
