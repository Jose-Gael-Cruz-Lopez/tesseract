import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { docRepo, adrRepo, milestoneProposalRepo, milestoneRepo, triageRepo } from "../src/tools/repo-ownership";
import { run, nowIso } from "../src/db";
import { route_triage, stage_milestone_proposal, promote_milestone_proposal } from "../src/tools/writes";

// Repo-ownership lookups: each resolves an id/slug-keyed row's owning repo, or null
// when the row doesn't exist. The hub mutation routes use null/mismatch to 404 a
// cross-repo id — these are the ONLY thing standing between a push-authorized user
// on repo A and a write against repo B's row, so each helper is verified directly
// against the real schema (not a mocked one).

describe("repo-ownership helpers", () => {
  it("docRepo returns the doc's repo, or null when the slug is absent", async () => {
    // Column shape copied from hub-routes.test.ts's seedDoc — do not invent columns.
    await run(
      env.DB,
      `INSERT INTO docs (repo, slug, section, title, body, current_version, updated_at, updated_by, space)
       VALUES (?, ?, 'reference', ?, ?, 1, ?, 'author', ?)`,
      "octo/hub", "arch", "arch", "body", nowIso(), "canopy"
    );
    expect(await docRepo(env.DB, "arch")).toBe("octo/hub");
    expect(await docRepo(env.DB, "no-such-slug")).toBeNull();
  });

  it("adrRepo returns the row's repo, or null when absent", async () => {
    // adrs has NO `body` column (context/decision/rationale instead) — shape copied
    // from hub-routes.test.ts's adrs-isolation test, not the brief's illustrative snippet.
    await run(
      env.DB,
      `INSERT INTO adrs (title, context, decision, rationale, status, confidence, created_at, created_by, repo)
       VALUES (?, 'ctx', 'dec', 'why', 'draft', 'high', ?, 'tester', ?)`,
      "t", nowIso(), "octo/hub"
    );
    const id = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
    expect(await adrRepo(env.DB, id.id)).toBe("octo/hub");
    expect(await adrRepo(env.DB, 999999)).toBeNull();
  });

  it("milestoneProposalRepo returns the proposal's repo, or null when absent", async () => {
    const id = await stage_milestone_proposal(
      env.DB,
      { title: "m", target_date: "2026-08-01", status: "upcoming", change_summary: "s", confidence: "high" },
      "author",
      null,
      "octo/hub"
    );
    expect(await milestoneProposalRepo(env.DB, id)).toBe("octo/hub");
    expect(await milestoneProposalRepo(env.DB, 999999)).toBeNull();
  });

  it("milestoneRepo returns the live milestone's repo, or null when absent", async () => {
    const pid = await stage_milestone_proposal(
      env.DB,
      { title: "m2", target_date: "2026-08-01", status: "upcoming", change_summary: "s", confidence: "high" },
      "author",
      null,
      "octo/hub"
    );
    const milestone = await promote_milestone_proposal(env.DB, pid, "author");
    expect(await milestoneRepo(env.DB, milestone.id)).toBe("octo/hub");
    expect(await milestoneRepo(env.DB, 999999)).toBeNull();
  });

  it("triageRepo returns the triage item's repo, or null when absent", async () => {
    const id = await route_triage(env.DB, { raw: "x", reason: "r", repo: "octo/hub" });
    expect(await triageRepo(env.DB, id)).toBe("octo/hub");
    expect(await triageRepo(env.DB, 999999)).toBeNull();
  });
});
