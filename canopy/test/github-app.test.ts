import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { InstallationRow, RepoAccessRow } from "@shared/rows";

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
