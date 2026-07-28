import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { RepoRow } from "@shared/rows";
import type { Env } from "../src/env";
import { _clearInstallationTokenCache } from "../src/auth/app";
import { handleInstallationEvent, reconcileInstallationRepos, syncInstallationFromApp } from "../src/auth/connect";

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

const status = async (repo: string) =>
  (await env.DB.prepare(`SELECT status FROM repos WHERE repo = ?`).bind(repo).first<{ status: string }>())?.status;

// Issue #33: the installation repo list is the AUTHORITATIVE input to the reconcile
// below, so it has to be complete first. A single-page read of an account with >100
// repos would make page 1 look like the whole truth — and everything past it like it had
// been de-scoped.
describe("installation repo list is fully paginated (issue #33)", () => {
  beforeEach(() => {
    _clearInstallationTokenCache(); // don't inherit a cached token across cases
  });

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

// Issue #33: narrowing an installation from "All repositories" to "Only select
// repositories" fires installation_repositories with action:"added" and an EMPTY
// repositories_removed — under "all" there was never an explicit list to remove FROM.
// Driving disconnection off that delta therefore left every de-scoped repo
// status='connected' forever, and the 6-hourly recomputeConnectedRepos kept minting
// doomed tokens for it. The handler now reconciles against the AUTHORITATIVE list.
describe("installation_repositories reconcile (issue #33)", () => {
  beforeEach(() => {
    _clearInstallationTokenCache();
  });

  const seed = async (installationId: number, repos: string[]) => {
    for (const repo of repos) {
      await env.DB.prepare(
        `INSERT INTO repos (repo, added_at, added_by, installation_id, status)
         VALUES (?, '2026-07-11T00:00:00Z', 'octocat', ?, 'connected')`
      ).bind(repo, installationId).run();
    }
  };
  const repoCount = async () => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM repos`).first<{ n: number }>())?.n;

  // The exact delivery GitHub sends on all→selected: only the newly-selected repos,
  // and an empty removed list.
  const narrowed = (installationId: number, selected: string[]) => ({
    action: "added",
    installation: { id: installationId },
    repositories_added: selected.map((full_name) => ({ full_name })),
    repositories_removed: [],
    sender: { login: "octocat" },
  });

  it("narrowing all→selected disconnects the de-scoped repos despite an empty repositories_removed", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/tesseract", "octocat/site"]);

    const res = await handleInstallationEvent(
      appEnv,
      env.DB,
      "installation_repositories",
      narrowed(100, ["octocat/canopy"]),
      "2026-07-11T00:01:00Z",
      { fetchImpl: ghFetch([["octocat/canopy"]]), nowSec: 1_000_000 }
    );

    expect(res).toMatchObject({ handled: true, reconciled: true, disconnected: 2 });
    expect(await status("octocat/canopy")).toBe("connected");
    expect(await status("octocat/tesseract")).toBe("disconnected");
    expect(await status("octocat/site")).toBe("disconnected");
  });

  it("the reconcile is soft — rows and their captured columns survive", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/tesseract"]);

    await handleInstallationEvent(appEnv, env.DB, "installation_repositories", narrowed(100, ["octocat/canopy"]), "2026-07-11T00:01:00Z", {
      fetchImpl: ghFetch([["octocat/canopy"]]),
      nowSec: 1_000_000,
    });

    expect(await repoCount()).toBe(2); // nothing deleted
    const row = await env.DB.prepare(`SELECT * FROM repos WHERE repo = 'octocat/tesseract'`).first<RepoRow>();
    expect(row).toMatchObject({ status: "disconnected", added_by: "octocat", added_at: "2026-07-11T00:00:00Z", installation_id: 100 });
  });

  it("the reconcile is scoped to the event's installation", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/gone"]);
    await seed(200, ["acme/app"]); // a different tenant's install — untouched

    await handleInstallationEvent(appEnv, env.DB, "installation_repositories", narrowed(100, ["octocat/canopy"]), "2026-07-11T00:01:00Z", {
      fetchImpl: ghFetch([["octocat/canopy"]]),
      nowSec: 1_000_000,
    });

    expect(await status("octocat/gone")).toBe("disconnected");
    expect(await status("acme/app")).toBe("connected");
  });

  // ── THE SAFETY GUARD ──────────────────────────────────────────────────────
  // "Disconnect everything not in the list" is catastrophic on a truncated or
  // half-failed fetch. The list is authoritative ONLY when every page came back 2xx
  // and said something; anything else must disconnect NOTHING.
  it("a mid-pagination failure disconnects NOTHING — a truncated list is never authoritative", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/tesseract", "octocat/site"]);
    const page1 = Array.from({ length: 100 }, (_, i) => `octocat/p${i}`); // full page ⇒ page 2 follows
    const seen: number[] = [];

    const res = await handleInstallationEvent(
      appEnv,
      env.DB,
      "installation_repositories",
      narrowed(100, ["octocat/canopy"]),
      "2026-07-11T00:01:00Z",
      { fetchImpl: ghFetch([page1, 500], seen), nowSec: 1_000_000 }
    );

    expect(seen).toEqual([1, 2]); // it really did try to page past the truncation point
    expect(res).toMatchObject({ handled: true, reconciled: false, disconnected: 0 });
    // Every repo connected before the event is STILL connected — including the two the
    // truncated page 1 would have "proved" were gone.
    for (const repo of ["octocat/canopy", "octocat/tesseract", "octocat/site"]) {
      expect(await status(repo)).toBe("connected");
    }
    expect(await status("octocat/p0")).toBeUndefined(); // …and the half-read page never reached D1
    expect(await repoCount()).toBe(3);
  });

  it("a first-page failure disconnects nothing", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/tesseract"]);

    const res = await handleInstallationEvent(
      appEnv,
      env.DB,
      "installation_repositories",
      narrowed(100, ["octocat/canopy"]),
      "2026-07-11T00:01:00Z",
      { fetchImpl: ghFetch([502]), nowSec: 1_000_000 }
    );

    expect(res).toMatchObject({ handled: true, reconciled: false, disconnected: 0 });
    expect(await status("octocat/canopy")).toBe("connected");
    expect(await status("octocat/tesseract")).toBe("connected");
  });

  it("an empty authoritative list disconnects nothing — it's indistinguishable from a malformed 200", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy", "octocat/tesseract"]);

    const res = await handleInstallationEvent(
      appEnv,
      env.DB,
      "installation_repositories",
      narrowed(100, []),
      "2026-07-11T00:01:00Z",
      { fetchImpl: ghFetch([[]]), nowSec: 1_000_000 }
    );

    expect(res).toMatchObject({ handled: true, reconciled: false, disconnected: 0 });
    expect(await status("octocat/canopy")).toBe("connected");
    expect(await status("octocat/tesseract")).toBe("connected");
  });

  it("reconcileInstallationRepos refuses on a failed fetch without touching D1", async () => {
    const appEnv = await makeAppEnv();
    await seed(100, ["octocat/canopy"]);

    const res = await reconcileInstallationRepos(appEnv, env.DB, 100, "octocat", "2026-07-11T00:01:00Z", {
      fetchImpl: ghFetch([503]),
      nowSec: 1_000_000,
    });

    expect(res).toEqual({ reconciled: false, disconnected: [] });
    expect(await status("octocat/canopy")).toBe("connected");
  });

  // ── Degrade, don't break ──────────────────────────────────────────────────
  it("without App config the reconcile is skipped and the payload delta still applies — no fetch attempted", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("the reconcile must not reach GitHub without App config");
    }) as unknown as typeof fetch;
    await seed(100, ["octocat/tesseract"]);

    const res = await handleInstallationEvent(
      env as Env, // no GITHUB_APP_ID / _PRIVATE_KEY in the test env
      env.DB,
      "installation_repositories",
      {
        action: "removed",
        installation: { id: 100 },
        repositories_added: [{ full_name: "octocat/new" }],
        repositories_removed: [{ full_name: "octocat/tesseract" }],
        sender: { login: "octocat" },
      },
      "2026-07-11T00:01:00Z",
      { fetchImpl, nowSec: 1_000_000 }
    );

    expect(res).toMatchObject({ handled: true, reconciled: false, disconnected: 0 });
    expect(calls).toBe(0);
    expect(await status("octocat/new")).toBe("connected"); // the payload delta still runs
    expect(await status("octocat/tesseract")).toBe("disconnected");
  });
});
