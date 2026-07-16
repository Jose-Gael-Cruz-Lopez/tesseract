import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { run, nowIso } from "../src/db";
import { write_plan } from "../src/tools/plan";
import { propose_doc_update, stage_milestone_proposal, route_triage } from "../src/tools/writes";
import { ingestEvent } from "../src/consumer";
import type { CapturedEvent } from "@shared/contract";
import { authedCookie } from "./helpers/session";

// Phase 3 (GitHub App / connect-your-repos): the hub router mounted at
// /r/:owner/:repo, gated per-request by repoGate. Auths via a real session
// cookie (authedCookie, test/helpers/session.ts) — vitest.config.ts pins
// DEV_LOGIN to "" so the sessionGate dev bypass never engages in tests.
const REPO = "octo/hub";
const LOGIN = "octocat";

async function connect(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), LOGIN, 1);
}

// A standard authorized GET against the hub as `login` (default LOGIN). Both repos are
// injected into the access set; repoGate authorizes only the repo named in the URL.
// Lifts the feed-isolation test's inline setup into a helper for the per-route cases.
async function hubGet(path: string, login: string = LOGIN): Promise<Response> {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: true }, { repo: "octo/other", can_push: true }];
  return app.request(path, { headers: { cookie: await authedCookie(login) } }, env);
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

    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await authedCookie(LOGIN) } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { narrative: string };
    expect(body.narrative).toBe("octo hub plan");
  });

  it("404s an unconnected repo (no existence leak)", async () => {
    _hubTestHooks.getUserToken = async () => "user-tok";
    _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await authedCookie(LOGIN) } }, env);
    expect(res.status).toBe(404);
  });

  it("401s when the user has no stored token", async () => {
    await connect(REPO);
    _hubTestHooks.getUserToken = async () => null;
    const res = await app.request(`/r/octo/hub/roadmap`, { headers: { cookie: await authedCookie(LOGIN) } }, env);
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

    const res = await app.request(`/r/octo/hub/feed`, { headers: { cookie: await authedCookie(LOGIN) } }, env);
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

// A push-authorized POST against the hub as `login` (default LOGIN), for the mutation
// routes below. Mirrors hubGet but for POST + an optional JSON body.
async function hubPost(path: string, opts?: { login?: string; canPush?: boolean; body?: unknown }): Promise<Response> {
  const login = opts?.login ?? LOGIN;
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: "octo/hub", can_push: opts?.canPush ?? true }];
  return app.request(
    path,
    {
      method: "POST",
      headers: { cookie: await authedCookie(login), "content-type": "application/json" },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    },
    env
  );
}

describe("hub mutation routes (push-gated + repo-ownership guarded)", () => {
  it("admin mutation is 403 without push access", async () => {
    await connect("octo/hub");
    const res = await hubPost(`/r/octo/hub/adr/1/ratify`, { canPush: false }); // read-only collaborator
    expect(res.status).toBe(403);
  });

  it("id-keyed mutation 404s a cross-repo id", async () => {
    await connect("octo/hub");
    await run(env.DB, `INSERT INTO adrs (title, context, decision, rationale, status, confidence, created_at, created_by, repo) VALUES ('x', 'ctx', 'dec', 'why', 'draft', 'high', ?, 'tester', 'octo/other')`, nowIso());
    const row = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
    const res = await hubPost(`/r/octo/hub/adr/${row.id}/ratify`, { canPush: true });
    expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
  });

  it("push-gate runs BEFORE the ownership lookup: a read-only collaborator gets 403, never a 404, even on a nonexistent id", async () => {
    await connect("octo/hub");
    // id 424242 doesn't exist anywhere — if the ownership lookup ran first this would
    // 404; the 403 proves requirePush short-circuits before any DB probe.
    const res = await hubPost(`/r/octo/hub/adr/424242/ratify`, { canPush: false });
    expect(res.status).toBe(403);
  });

  it("a push-authorized collaborator CAN ratify an ADR that belongs to their own gated repo", async () => {
    await connect("octo/hub");
    await run(env.DB, `INSERT INTO adrs (title, context, decision, rationale, status, confidence, created_at, created_by, repo) VALUES ('own adr', 'ctx', 'dec', 'why', 'draft', 'high', ?, 'tester', 'octo/hub')`, nowIso());
    const row = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
    const res = await hubPost(`/r/octo/hub/adr/${row.id}/ratify`, { canPush: true });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; status: string };
    expect(body).toEqual({ ok: true, id: row.id, status: "ratified" });
    const persisted = await env.DB.prepare(`SELECT status FROM adrs WHERE id = ?`).bind(row.id).first<{ status: string }>();
    expect(persisted?.status).toBe("ratified");
  });

  it("doc slug-keyed mutation 404s a cross-repo slug", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    await propose_doc_update(env.DB, { slug: "other-doc", section: "reference", body: "b", change_summary: "s", confidence: "high", repo: "octo/other" }, "author");
    const res = await hubPost(`/r/octo/hub/doc/other-doc/promote`, { canPush: true, body: { version: 1 } });
    expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
  });

  it("a push-authorized collaborator CAN promote a doc that belongs to their own gated repo", async () => {
    await connect("octo/hub");
    await propose_doc_update(env.DB, { slug: "hub-doc-promote", section: "reference", body: "hub body", change_summary: "s", confidence: "high", repo: "octo/hub" }, "author");
    const res = await hubPost(`/r/octo/hub/doc/hub-doc-promote/promote`, { canPush: true, body: { version: 1 } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; slug: string; version: number; status: string };
    expect(body).toEqual({ ok: true, slug: "hub-doc-promote", version: 1, status: "promoted" });
    const persisted = await env.DB.prepare(`SELECT body, current_version FROM docs WHERE repo = 'octo/hub' AND slug = 'hub-doc-promote'`).first<{ body: string; current_version: number }>();
    expect(persisted).toEqual({ body: "hub body", current_version: 1 });
  });

  // One cross-repo-404 per DISTINCT ownership helper (milestoneRepo / milestoneProposalRepo /
  // triageRepo) — adr + doc are already covered above; these three wire different helpers, so a
  // mis-wire would slip through without them. Each is a REAL negative: seed the target in
  // octo/other, gate to octo/hub with push, POST, assert 404 AND re-query D1 to prove the
  // other repo's row was NOT mutated (if the guard were removed, the writer would run and flip
  // the row, failing the persistence assertion).

  it("milestones/:id/complete 404s a cross-repo id and leaves the other repo's milestone unmutated (milestoneRepo)", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    // milestones column shape copied from fts-isolation.test.ts, with the 0020 repo column.
    await run(env.DB, `INSERT INTO milestones (repo, title, description, target_date, status, created_at, created_by) VALUES ('octo/other', 'other ms', 'd', '2026-08-01', 'upcoming', ?, 'author')`, nowIso());
    const row = (await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first()) as { id: number };
    const res = await hubPost(`/r/octo/hub/milestones/${row.id}/complete`, { canPush: true });
    expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
    const persisted = await env.DB.prepare(`SELECT status FROM milestones WHERE id = ?`).bind(row.id).first<{ status: string }>();
    expect(persisted?.status).toBe("upcoming"); // NOT flipped to 'done'
  });

  it("milestone-proposals/:id/promote 404s a cross-repo id and leaves the other repo's proposal unpromoted (milestoneProposalRepo)", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    const pid = await stage_milestone_proposal(env.DB, { title: "other prop", target_date: "2026-08-01", status: "upcoming", change_summary: "s", confidence: "high" }, "author", null, "octo/other");
    const res = await hubPost(`/r/octo/hub/milestone-proposals/${pid}/promote`, { canPush: true });
    expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
    const persisted = await env.DB.prepare(`SELECT staged_status FROM milestone_proposals WHERE id = ?`).bind(pid).first<{ staged_status: string }>();
    expect(persisted?.staged_status).toBe("staged"); // NOT promoted
    // …and no live milestone was materialized from it into octo/other.
    const live = await env.DB.prepare(`SELECT COUNT(*) AS n FROM milestones WHERE repo = 'octo/other'`).first<{ n: number }>();
    expect(live?.n).toBe(0);
  });

  it("needs-triage/:id/discard 404s a cross-repo id and leaves the other repo's item unresolved (triageRepo)", async () => {
    await connect("octo/hub");
    await connect("octo/other");
    const tid = await route_triage(env.DB, { raw: "x", reason: "r", repo: "octo/other" });
    const res = await hubPost(`/r/octo/hub/needs-triage/${tid}/discard`, { canPush: true });
    expect(res.status).toBe(404); // belongs to octo/other, not the gated hub
    const persisted = await env.DB.prepare(`SELECT resolved FROM needs_triage WHERE id = ?`).bind(tid).first<{ resolved: number }>();
    expect(persisted?.resolved).toBe(0); // NOT resolved
  });
});
