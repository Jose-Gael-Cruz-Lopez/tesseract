import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { bootstrapRepo, defaultRepo, _resetBootstrapForTests, REPO_TABLES } from "../src/db";
import { repoFromDelivery } from "../src/webhook";
import { ingestEvent, ingestFeedEntry } from "../src/consumer";
import { route_triage } from "../src/tools/writes";
import { list_needs_triage } from "../src/tools/reads";

// Phase 2a: the repos registry + an additive `repo` column on every per-repo table,
// with the transient repo='' sentinel backfilled to GITHUB_REPO at runtime.
describe("repos registry + repo column (0020)", () => {
  beforeEach(() => _resetBootstrapForTests());

  it("every per-repo table has a `repo` column", async () => {
    for (const t of REPO_TABLES) {
      const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{ name: string }>();
      const names = (results ?? []).map((r) => r.name);
      expect(names, `${t} is missing the repo column`).toContain("repo");
    }
  });

  it("the repos registry table exists and starts empty (reset truncates it)", async () => {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM repos`).first<{ n: number }>();
    expect(r?.n).toBe(0);
  });

  it("bootstrapRepo registers GITHUB_REPO and backfills the repo='' sentinel", async () => {
    const repo = defaultRepo(env);
    expect(repo).toBeTruthy();

    // A legacy row: inserted with no repo → gets the '' sentinel default.
    await env.DB.prepare(`INSERT INTO feed (author, summary, created_at) VALUES (?, ?, ?)`)
      .bind("octocat", "did a thing", "1970-01-01T00:00:00.000Z").run();
    const before = await env.DB.prepare(`SELECT repo FROM feed WHERE author='octocat'`).first<{ repo: string }>();
    expect(before?.repo).toBe("");

    await bootstrapRepo(env, env.DB);

    const reg = await env.DB.prepare(`SELECT repo FROM repos WHERE repo = ?`).bind(repo).first<{ repo: string }>();
    expect(reg?.repo).toBe(repo);
    const after = await env.DB.prepare(`SELECT repo FROM feed WHERE author='octocat'`).first<{ repo: string }>();
    expect(after?.repo).toBe(repo);
  });

  it("bootstrapRepo is idempotent — a second run neither throws nor duplicates the registry row", async () => {
    await bootstrapRepo(env, env.DB);
    _resetBootstrapForTests();
    await bootstrapRepo(env, env.DB);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM repos`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

// Phase 2b (events path): the webhook routes by the delivery's own repo, and
// ingestEvent tags each event row with it.
describe("events are tagged by repo (2b)", () => {
  it("repoFromDelivery reads repository.full_name (or '' when absent)", () => {
    expect(repoFromDelivery({ repository: { full_name: "acme/app" } })).toBe("acme/app");
    expect(repoFromDelivery({ pull_request: {} })).toBe("");
    expect(repoFromDelivery(null)).toBe("");
  });

  it("ingestEvent tags the event row with its repo", async () => {
    await ingestEvent(
      env.DB,
      {
        semantic_key: "gh:pr:7:merged", event_type: "pr_merged", ref_number: 7,
        subject_login: "octocat", raw: "{}", provenance: "webhook",
      },
      "github-webhook",
      "acme/app",
    );
    const row = await env.DB.prepare(`SELECT repo FROM events WHERE semantic_key = ?`)
      .bind("gh:pr:7:merged").first<{ repo: string }>();
    expect(row?.repo).toBe("acme/app");
  });
});

// Phase 2b (gate): the ingest gate tags created content with its repo.
describe("the ingest gate tags content by repo (2b)", () => {
  it("a feed entry created via the gate carries its repo", async () => {
    const entry = { summary: "shipped the thing", body: "", tags: ["infra"], artifacts: { prs: [], commits: [], issues: [] } };
    const r = await ingestFeedEntry(env.DB, entry, "octocat", "acme/app");
    expect(r.outcome).toBe("written");
    const row = await env.DB.prepare(`SELECT repo FROM feed WHERE summary = 'shipped the thing'`).first<{ repo: string }>();
    expect(row?.repo).toBe("acme/app");
    // its tag row is scoped to the same repo
    const tag = await env.DB.prepare(`SELECT repo FROM entry_tags WHERE entry_type = 'feed' AND tag = 'infra'`).first<{ repo: string }>();
    expect(tag?.repo).toBe("acme/app");
  });
});

// Phase 2c (reads): reads take an optional repo — scoped when given, all when omitted.
describe("reads scope by repo (2c)", () => {
  it("list_needs_triage returns only the requested repo (and all when omitted)", async () => {
    await route_triage(env.DB, { raw: "x", reason: "r1", repo: "acme/a" });
    await route_triage(env.DB, { raw: "y", reason: "r2", repo: "acme/b" });

    const both = await list_needs_triage(env.DB);            // no repo → both
    expect(both.length).toBe(2);

    const onlyA = await list_needs_triage(env.DB, "acme/a"); // scoped → one
    expect(onlyA.length).toBe(1);
    expect(onlyA[0].repo).toBe("acme/a");
  });
});
