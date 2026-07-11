import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { run, nowIso } from "../src/db";
import { write_plan } from "../src/tools/plan";
import { propose_doc_update, stage_milestone_proposal } from "../src/tools/writes";
import { ingestEvent } from "../src/consumer";
import type { CapturedEvent } from "@shared/contract";
import { createSession } from "../src/auth/session";
import { hmacSeal } from "../src/auth/crypto";

// Phase 3 (GitHub App / connect-your-repos): the hub router mounted at
// /r/:owner/:repo, gated per-request by repoGate. Auths via a real session
// cookie (mirrors cookieFor in roadmap.test.ts et al.) — vitest.config.ts pins
// DEV_LOGIN to "" so the sessionGate dev bypass never engages in tests.
const REPO = "octo/hub";
const LOGIN = "octocat";

async function cookieFor(login: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
  ).bind(login, login, "2026-01-01T00:00:00Z").run();
  const { id } = await createSession(env.DB, login);
  return `session=${await hmacSeal(id, "test-cookie-secret")}`;
}

async function connect(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), LOGIN, 1);
}

// A standard authorized GET against the hub as `login` (default LOGIN). Both repos are
// injected into the access set; repoGate authorizes only the repo named in the URL.
// Lifts the feed-isolation test's inline setup into a helper for the per-route cases.
async function hubGet(path: string, login: string = LOGIN): Promise<Response> {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }, { repo: "octo/other", can_push: true }];
  return app.request(path, { headers: { cookie: await cookieFor(login) } }, env);
}

// A live (promoted) doc seeded directly: a promoted doc keeps its body in `docs` (so the
// docs_fts trigger indexes it and /search matches). Column shape copied verbatim from
// repo-scope.test.ts's liveDoc — do not invent columns.
function seedDoc(repo: string, slug: string, body: string, space: "sapling" | "canopy" = "canopy") {
  return run(
    env.DB,
    `INSERT INTO docs (repo, slug, section, title, body, current_version, updated_at, updated_by, space)
     VALUES (?, ?, 'reference', ?, ?, 1, ?, 'author', ?)`,
    repo, slug, slug, body, nowIso(), space
  );
}

// A captured merged-PR event — raw shape copied from dashboard-route.test.ts's
// mergedPrEvent (getMyWork parses raw.pr.{number,title,html_url,merged}).
function mergedPrEvent(number: number, login: string, occurredAt: string): CapturedEvent {
  return {
    semantic_key: `gh:pr:${number}:merged`,
    event_type: "pr_merged",
    ref_number: number,
    subject_login: login,
    raw: JSON.stringify({
      pr: { number, title: `PR ${number}`, html_url: `https://github.com/o/r/pull/${number}`, merged: true },
    }),
    provenance: "webhook",
    occurred_at: occurredAt,
  };
}

beforeEach(() => { _resetHubTestHooks(); });
afterEach(() => { _resetHubTestHooks(); });

describe("hub roadmap route", () => {
  it("serves the repo-scoped plan when connected + collaborator", async () => {
    await connect(REPO);
    await write_plan(env.DB, { narrative: "octo hub plan", milestones: [] }, LOGIN, REPO);
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];

    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { narrative: string };
    expect(body.narrative).toBe("octo hub plan");
  });

  it("404s an unconnected repo (no existence leak)", async () => {
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(404);
  });

  it("401s when the user has no stored token", async () => {
    await connect(REPO);
    _hubTestHooks.getUserToken = async () => null;
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(401);
  });
});

describe("hub read routes", () => {
  it("feed is isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // seed one feed entry in each repo — column shape copied from repo-scope.test.ts /
    // query.fts.test.ts (feed has no `kind`/`tags` columns; tags live in entry_tags).
    await run(env.DB, `INSERT INTO feed (author, summary, body, artifacts, created_at, repo) VALUES (?, ?, ?, NULL, ?, ?)`, LOGIN, "hub-only", "hub-only", nowIso(), "octo/hub");
    await run(env.DB, `INSERT INTO feed (author, summary, body, artifacts, created_at, repo) VALUES (?, ?, ?, NULL, ?, ?)`, LOGIN, "other-only", "other-only", nowIso(), "octo/other");
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }, { repo: "octo/other", can_push: true }];

    const res = await app.request(`/r/octo/hub/feed`, { headers: { cookie: await cookieFor(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const { feed } = await res.json() as { feed: Array<{ body: string }> };
    expect(feed.some((f) => f.body === "hub-only")).toBe(true);
    expect(feed.some((f) => f.body === "other-only")).toBe(false);
  });

  it("docs are isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    await seedDoc("octo/hub", "hub-doc", "hub doc body");
    await seedDoc("octo/other", "other-doc", "other doc body");

    const res = await hubGet(`/r/octo/hub/docs`);
    expect(res.status).toBe(200);
    const { docs } = await res.json() as { docs: Array<{ slug: string; repo: string }> };
    expect(docs.some((d) => d.slug === "hub-doc")).toBe(true);
    expect(docs.some((d) => d.slug === "other-doc")).toBe(false);
    expect(docs.every((d) => d.repo === "octo/hub")).toBe(true);
  });

  it("adrs are isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // adrs column shape copied from fts-isolation.test.ts, with the 0020 repo column appended.
    await run(env.DB, `INSERT INTO adrs (title, context, decision, rationale, status, confidence, created_at, created_by, repo) VALUES (?, 'ctx', 'dec', 'why', 'draft', 'high', ?, 'tester', ?)`, "hub adr", nowIso(), "octo/hub");
    await run(env.DB, `INSERT INTO adrs (title, context, decision, rationale, status, confidence, created_at, created_by, repo) VALUES (?, 'ctx', 'dec', 'why', 'draft', 'high', ?, 'tester', ?)`, "other adr", nowIso(), "octo/other");

    const res = await hubGet(`/r/octo/hub/adrs`);
    expect(res.status).toBe(200);
    const { adrs } = await res.json() as { adrs: Array<{ title: string }> };
    expect(adrs.some((a) => a.title === "hub adr")).toBe(true);
    expect(adrs.some((a) => a.title === "other adr")).toBe(false);
  });

  it("proposals are isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // propose_doc_update stages a doc_versions row (version 1 > current_version 0), which
    // is exactly what list_proposals joins + returns. Distinct slug per repo.
    await propose_doc_update(env.DB, { slug: "hub-prop", section: "reference", body: "hub prop body", change_summary: "s", confidence: "high", repo: "octo/hub" }, "author");
    await propose_doc_update(env.DB, { slug: "other-prop", section: "reference", body: "other prop body", change_summary: "s", confidence: "high", repo: "octo/other" }, "author");

    const res = await hubGet(`/r/octo/hub/proposals`);
    expect(res.status).toBe(200);
    const { proposals } = await res.json() as { proposals: Array<{ slug: string }> };
    expect(proposals.some((p) => p.slug === "hub-prop")).toBe(true);
    expect(proposals.some((p) => p.slug === "other-prop")).toBe(false);
  });

  it("milestone proposals are isolated to the gated repo", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    await stage_milestone_proposal(env.DB, { title: "hub milestone", target_date: "2026-08-01", status: "upcoming", change_summary: "s", confidence: "high" }, "author", null, "octo/hub");
    await stage_milestone_proposal(env.DB, { title: "other milestone", target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "high" }, "author", null, "octo/other");

    const res = await hubGet(`/r/octo/hub/milestone-proposals`);
    expect(res.status).toBe(200);
    const { proposals } = await res.json() as { proposals: Array<{ title: string }> };
    expect(proposals.some((p) => p.title === "hub milestone")).toBe(true);
    expect(proposals.some((p) => p.title === "other milestone")).toBe(false);
  });

  it("search is isolated to the gated repo and honors the space filter", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // Same search term across two repos; the gated repo's hit must be the only doc returned.
    await seedDoc("octo/hub", "hub-arch", "zephyr alpha internals", "canopy");
    await seedDoc("octo/other", "other-arch", "zephyr beta internals", "canopy");
    // A second hub doc in a DIFFERENT space, so ?space= can be shown to narrow results.
    await seedDoc("octo/hub", "hub-sapling", "zephyr sapling notes", "sapling");

    type SearchHit = { type: string; id: string };
    type SearchBody = { result: { primary: SearchHit[]; pointers: SearchHit[] } };
    const docIds = (b: SearchBody) => [...b.result.primary, ...b.result.pointers].filter((h) => h.type === "doc").map((h) => h.id);

    // Isolation: both hub docs present, the other repo's same-term doc absent.
    const res = await hubGet(`/r/octo/hub/search?q=zephyr&types=doc`);
    expect(res.status).toBe(200);
    const ids = docIds(await res.json() as SearchBody);
    expect(ids).toContain("hub-arch");
    expect(ids).toContain("hub-sapling");
    expect(ids).not.toContain("other-arch");

    // space filter: ?space=canopy narrows to the canopy doc, dropping the sapling one.
    const res2 = await hubGet(`/r/octo/hub/search?q=zephyr&types=doc&space=canopy`);
    const ids2 = docIds(await res2.json() as SearchBody);
    expect(ids2).toContain("hub-arch");
    expect(ids2).not.toContain("hub-sapling");
    expect(ids2).not.toContain("other-arch");
  });

  it("dashboard previous activity is isolated to the gated repo", async () => {
    // getMyWork scopes captured events by repo; the principal must be an identity-mapped
    // login (AndresL230 → Andres, seeded in scripts/seed/reset.mjs) or the projection is empty.
    const who = "AndresL230";
    await connect("octo/hub");
    await connect("octo/other");
    const now = nowIso();
    await ingestEvent(env.DB, mergedPrEvent(101, who, now), "github-webhook", "octo/hub");
    await ingestEvent(env.DB, mergedPrEvent(202, who, now), "github-webhook", "octo/other");

    const res = await hubGet(`/r/octo/hub/me/dashboard`, who);
    expect(res.status).toBe(200);
    const body = await res.json() as { person: string | null; previousActivity: Array<{ number: number }> };
    expect(body.person).toBe("Andres");
    expect(body.previousActivity.some((p) => p.number === 101)).toBe(true);
    expect(body.previousActivity.some((p) => p.number === 202)).toBe(false);
  });
});
