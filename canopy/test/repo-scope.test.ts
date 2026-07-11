import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { bootstrapRepo, defaultRepo, _resetBootstrapForTests, REPO_TABLES } from "../src/db";
import { repoFromDelivery } from "../src/webhook";
import { ingestEvent, ingestFeedEntry } from "../src/consumer";
import { route_triage, propose_doc_update } from "../src/tools/writes";
import { list_needs_triage, get_doc } from "../src/tools/reads";
import { list_events } from "../src/tools/mywork";

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

  it("list_events scopes captured events by repo", async () => {
    await ingestEvent(env.DB, { semantic_key: "gh:pr:1:merged", event_type: "pr_merged", ref_number: 1, subject_login: "a", raw: "{}", provenance: "webhook" }, "wh", "acme/a");
    await ingestEvent(env.DB, { semantic_key: "gh:pr:2:merged", event_type: "pr_merged", ref_number: 2, subject_login: "b", raw: "{}", provenance: "webhook" }, "wh", "acme/b");

    expect((await list_events(env.DB)).length).toBe(2);
    const onlyA = await list_events(env.DB, {}, "acme/a");
    expect(onlyA.length).toBe(1);
    expect(onlyA[0].repo).toBe("acme/a");
  });
});

// Phase 2 recreations (0021): per-repo event dedupe — the same PR/issue number
// coexists across repos (before 0021 the second was dropped as a semantic_key dup).
describe("per-repo event uniqueness (0021)", () => {
  const pr42 = { semantic_key: "gh:pr:42:merged", event_type: "pr_merged" as const, ref_number: 42, subject_login: "octocat", raw: "{}", provenance: "webhook" as const };

  it("the same PR #42 in two repos captures as two distinct events", async () => {
    const a = await ingestEvent(env.DB, pr42, "wh", "acme/a");
    const b = await ingestEvent(env.DB, pr42, "wh", "acme/b");
    expect(a.outcome).toBe("written");
    expect(b.outcome).toBe("written"); // NOT dropped as a dup — different repo

    const rows = await env.DB.prepare(`SELECT repo FROM events WHERE semantic_key = 'gh:pr:42:merged' ORDER BY repo`).all<{ repo: string }>();
    expect((rows.results ?? []).map((r) => r.repo)).toEqual(["acme/a", "acme/b"]);
  });

  it("a redelivery within the SAME repo still dedupes", async () => {
    await ingestEvent(env.DB, pr42, "wh", "acme/a");
    const again = await ingestEvent(env.DB, pr42, "wh", "acme/a");
    expect(again.outcome).toBe("unchanged"); // same (repo, semantic_key) → dropped
  });
});

// Phase 2 recreations (0022): docs.slug is per-repo — the same slug coexists across
// repos, and a repo-scoped get_doc returns that repo's doc.
describe("per-repo doc uniqueness (0022)", () => {
  const doc = (repo: string, body: string) => propose_doc_update(
    env.DB, { slug: "architecture", section: "reference", body, change_summary: "init", confidence: "high" as const, repo }, "author",
  );

  it("the same doc slug in two repos stays distinct, read back per-repo", async () => {
    await doc("acme/a", "A's architecture");
    await doc("acme/b", "B's architecture");

    const rows = await env.DB.prepare(`SELECT repo FROM docs WHERE slug = 'architecture' ORDER BY repo`).all<{ repo: string }>();
    expect((rows.results ?? []).map((r) => r.repo)).toEqual(["acme/a", "acme/b"]);

    const a = await get_doc(env.DB, "architecture", "acme/a");
    const b = await get_doc(env.DB, "architecture", "acme/b");
    expect(a?.versions[0].body).toBe("A's architecture");
    expect(b?.versions[0].body).toBe("B's architecture");
  });
});
