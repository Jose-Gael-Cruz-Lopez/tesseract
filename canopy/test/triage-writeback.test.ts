import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { authedCookie } from "./helpers/session";
import { all, first, run, nowIso, defaultRepo } from "../src/db";
import type { DocVersionRow, AdrRow, NeedsTriageRow, MilestoneProposalRow } from "@shared/rows";
import { ingestDocProposal } from "../src/consumer";
import { propose_doc_update, promote_doc, stage_adr, ratify_adr, route_triage, stage_milestone_proposal, promote_milestone_proposal } from "../src/tools/writes";

// The write-back resolves (reject/discard/assign) live ONLY under /r/:owner/:repo now
// (issue #9 / plan Task 11 removed the flat mutation routes — see
// flat-mutations-removed.test.ts). Every mutation below runs against the hub surface:
// a connected repo + a push collaborator (via the hub test hooks), exactly like
// hub-routes.test.ts. The behavior under test — soft flips, idempotency, the gate
// re-run on assign — is unchanged.
const REPO = "octo/hub";
const LOGIN = "andres";

async function connect(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), LOGIN, 1);
}

const hubPath = (path: string) => `/r/${REPO}${path}`;

// Hub POST as a push collaborator on REPO (the hooks stand in for GitHub: stored
// token + collaborator set). Paths are hub-relative, e.g. post("/doc/spec/reject", …).
const post = async (path: string, cookie: string, body?: unknown) => {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
  return app.request(
    hubPath(path),
    { method: "POST", headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env
  );
};
// Hub GET (the queue reads asserting a resolve dropped the item), same authorization.
const getJson = async <T>(path: string, cookie: string): Promise<T> => {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: REPO, can_push: true }];
  return (await (await app.request(hubPath(path), { headers: { cookie } }, env)).json()) as T;
};
// Flat GET (the flat READ surface is admin-gated + defaultRepo-scoped since the
// issue #9 review — see flat-reads-scoped.test.ts — so flat content reads run as
// the ADMIN_LOGINS entry with rows seeded at defaultRepo(env)).
const getFlatJson = async <T>(path: string, cookie: string): Promise<T> =>
  (await (await app.request(path, { headers: { cookie } }, env)).json()) as T;

beforeEach(async () => { _resetHubTestHooks(); await connect(REPO); });
afterEach(() => { _resetHubTestHooks(); });

const docBase = { section: "reference", change_summary: "s", confidence: "high" as const };

// ── GET /proposals: server-joined queue (flat read — admin + defaultRepo now) ──
describe("GET /proposals", () => {
  it("returns staged versions newer than the live doc, joined with both bodies + reconciler metadata", async () => {
    const cookie = await authedCookie("admin-user");
    // v1 promoted (live), v2 staged as a one-line edit on top (changed/max < 0.5).
    // Seeded at defaultRepo(env): the flat route only serves that repo now.
    const v1Body = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const v2Body = v1Body.replace("line 5", "line FIVE");
    await ingestDocProposal(env.DB, { ...docBase, slug: "architecture", title: "Architecture", body: v1Body }, "andres", defaultRepo(env));
    await promote_doc(env.DB, "architecture", 1, "andres", defaultRepo(env));
    await ingestDocProposal(env.DB, { ...docBase, slug: "architecture", body: v2Body }, "andres", defaultRepo(env));

    const { proposals } = await getFlatJson<{ proposals: Array<Record<string, unknown>> }>("/proposals", cookie);
    expect(proposals.length).toBe(1);
    const p = proposals[0];
    expect(p.slug).toBe("architecture");
    expect(p.version).toBe(2);
    expect(p.current_version).toBe(1);
    expect(p.base_version).toBe(1);
    expect(p.change_kind).toBe("edit");
    expect(p.stagedBody).toBe(v2Body);
    expect(p.promotedBody).toBe(v1Body); // live body, not the staged one
    expect(p.title).toBe("Architecture");
    expect(p.section).toBe("reference");
  });

  it("returns 401 without a session cookie", async () => {
    const res = await app.request("/proposals", {}, env);
    expect(res.status).toBe(401);
  });
});

// ── reject doc version ────────────────────────────────────────────────────────
describe("POST /r/:owner/:repo/doc/:slug/reject", () => {
  it("flips a staged version to 'rejected', drops it from the hub proposals queue, and never deletes it", async () => {
    const cookie = await authedCookie(LOGIN);
    // The hub route rejects at repoOf(c) and ownership-guards the slug — seed in REPO.
    await propose_doc_update(env.DB, { ...docBase, slug: "spec", title: "Spec", body: "# draft", repo: REPO }, "andres");

    let proposals = (await getJson<{ proposals: unknown[] }>("/proposals", cookie)).proposals;
    expect(proposals.length).toBe(1);

    const res = await post("/doc/spec/reject", cookie, { version: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "rejected" });

    // leaves the queue
    proposals = (await getJson<{ proposals: unknown[] }>("/proposals", cookie)).proposals;
    expect(proposals.length).toBe(0);

    // soft only — the row + body remain
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'spec' AND version = 1`);
    expect(v?.status).toBe("rejected");
    expect(v?.body).toBe("# draft");
  });

  it("double-reject is idempotent-safe (no error, still rejected)", async () => {
    const cookie = await authedCookie(LOGIN);
    await propose_doc_update(env.DB, { ...docBase, slug: "idem", title: "Idem", body: "x", repo: REPO }, "andres");
    expect((await post("/doc/idem/reject", cookie, { version: 1 })).status).toBe(200);
    const second = await post("/doc/idem/reject", cookie, { version: 1 });
    expect(second.status).toBe(200);
    const rows = await all<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'idem'`);
    expect(rows.length).toBe(1); // nothing duplicated, nothing deleted
    expect(rows[0].status).toBe("rejected");
  });

  it("returns 401 without a session cookie (and does not mutate)", async () => {
    await propose_doc_update(env.DB, { ...docBase, slug: "guarded", title: "G", body: "x", repo: REPO }, "andres");
    const res = await app.request(hubPath("/doc/guarded/reject"), { method: "POST" }, env);
    expect(res.status).toBe(401);
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'guarded' AND version = 1`);
    expect(v?.status).toBe("staged");
  });
});

// ── reject adr ────────────────────────────────────────────────────────────────
describe("POST /r/:owner/:repo/adr/:id/reject", () => {
  it("flips a draft to 'rejected', drops it from the decisions queue, and never deletes it", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await stage_adr(env.DB, { title: "Use X", context: "c", decision: "d", rationale: "r", confidence: "high" }, "andres", null, REPO);

    let drafts = (await getJson<{ adrs: unknown[] }>("/adrs?status=draft", cookie)).adrs;
    expect(drafts.length).toBe(1);

    const res = await post(`/adr/${id}/reject`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "rejected" });

    drafts = (await getJson<{ adrs: unknown[] }>("/adrs?status=draft", cookie)).adrs;
    expect(drafts.length).toBe(0);

    const adr = await first<AdrRow>(env.DB, `SELECT * FROM adrs WHERE id = ?`, id);
    expect(adr?.status).toBe("rejected"); // still present
  });

  it("double-reject is idempotent-safe; cannot reject a ratified decision", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await stage_adr(env.DB, { title: "T", context: "c", decision: "d", rationale: "r", confidence: "high" }, "andres", null, REPO);
    expect((await post(`/adr/${id}/reject`, cookie)).status).toBe(200);
    expect((await post(`/adr/${id}/reject`, cookie)).status).toBe(200); // idempotent

    const ratifiedId = await stage_adr(env.DB, { title: "R", context: "c", decision: "d", rationale: "r", confidence: "high" }, "andres", null, REPO);
    await ratify_adr(env.DB, ratifiedId);
    const res = await post(`/adr/${ratifiedId}/reject`, cookie);
    expect(res.status).toBe(400); // a ratified decision is not rejectable
  });
});

// ── reject milestone proposal ─────────────────────────────────────────────────
const milestoneBase = {
  title: "Launch v1",
  target_date: "2026-09-01",
  status: "upcoming",
  change_summary: "initial proposal",
  confidence: "high" as const,
};

describe("POST /r/:owner/:repo/milestone-proposals/:id/reject", () => {
  it("flips a staged proposal to 'rejected', drops it from the queue, and never deletes it", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await stage_milestone_proposal(env.DB, milestoneBase, "andres", null, REPO);

    let proposals = (await getJson<{ proposals: unknown[] }>("/milestone-proposals", cookie)).proposals;
    expect(proposals.length).toBe(1);

    const res = await post(`/milestone-proposals/${id}/reject`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "rejected" });

    proposals = (await getJson<{ proposals: unknown[] }>("/milestone-proposals", cookie)).proposals;
    expect(proposals.length).toBe(0);

    const row = await first<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals WHERE id = ?`, id);
    expect(row?.staged_status).toBe("rejected"); // still present, soft flip
  });

  it("double-reject is idempotent-safe; cannot reject a promoted proposal", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await stage_milestone_proposal(env.DB, milestoneBase, "andres", null, REPO);
    expect((await post(`/milestone-proposals/${id}/reject`, cookie)).status).toBe(200);
    expect((await post(`/milestone-proposals/${id}/reject`, cookie)).status).toBe(200); // idempotent

    const promotedId = await stage_milestone_proposal(env.DB, { ...milestoneBase, title: "Other" }, "andres", null, REPO);
    await promote_milestone_proposal(env.DB, promotedId, "andres");
    const res = await post(`/milestone-proposals/${promotedId}/reject`, cookie);
    expect(res.status).toBe(400); // a promoted proposal is not rejectable
  });

  it("returns 401 without a session cookie (and does not mutate)", async () => {
    const id = await stage_milestone_proposal(env.DB, milestoneBase, "andres", null, REPO);
    const res = await app.request(hubPath(`/milestone-proposals/${id}/reject`), { method: "POST" }, env);
    expect(res.status).toBe(401);
    const row = await first<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals WHERE id = ?`, id);
    expect(row?.staged_status).toBe("staged"); // untouched
  });
});

// ── discard triage ────────────────────────────────────────────────────────────
describe("POST /r/:owner/:repo/needs-triage/:id/discard", () => {
  it("resolves the item (audit cols set), drops it from the triage queue, and never deletes it", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await route_triage(env.DB, { raw: "some free text", reason: "out of vocab", repo: REPO });

    let items = (await getJson<{ items: unknown[] }>("/needs-triage", cookie)).items;
    expect(items.length).toBe(1);

    const res = await post(`/needs-triage/${id}/discard`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, resolution: "discarded" });

    items = (await getJson<{ items: unknown[] }>("/needs-triage", cookie)).items;
    expect(items.length).toBe(0);

    const row = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(row?.resolved).toBe(1);
    expect(row?.resolution).toBe("discarded");
    expect(row?.resolved_by).toBe(LOGIN); // actor = the authenticated (push-collaborator) principal
    expect(row?.resolved_at).toBeTruthy();
  });

  it("double-discard is idempotent-safe", async () => {
    const cookie = await authedCookie(LOGIN);
    const id = await route_triage(env.DB, { raw: "x", reason: "y", repo: REPO });
    expect((await post(`/needs-triage/${id}/discard`, cookie)).status).toBe(200);
    expect((await post(`/needs-triage/${id}/discard`, cookie)).status).toBe(200);
    const rows = await all<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(rows.length).toBe(1);
  });
});

// ── assign-materialize triage ─────────────────────────────────────────────────
describe("POST /r/:owner/:repo/needs-triage/:id/assign", () => {
  it("materializes a REAL doc through the gate AND resolves with assigned_ref (out-of-vocab section, human supplies one)", async () => {
    const cookie = await authedCookie(LOGIN);
    // Triage an out-of-vocab section so it lands in the queue — in the hub's repo.
    const r = await ingestDocProposal(
      env.DB,
      { slug: "orphan", section: "made-up-section", title: "Orphan", body: "hello world", change_summary: "s", confidence: "high" },
      "agent-x",
      REPO
    );
    expect(r.outcome).toBe("triaged");
    const triage = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage ORDER BY id DESC LIMIT 1`);
    const id = triage!.id;

    const res = await post(`/needs-triage/${id}/assign`, cookie, { type: "doc", section: "reference" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; resolution: string; assigned_ref: string };
    expect(out).toMatchObject({ ok: true, resolution: "assigned", assigned_ref: "doc:orphan@1" });

    // A real row exists, staged THROUGH THE GATE (change_kind classified, not hand-inserted).
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'orphan'`);
    expect(v?.status).toBe("staged");
    expect(v?.change_kind).toBe("new");
    expect(v?.created_by).toBe(LOGIN); // author = the authenticated principal, not the agent
    // …and materialized into the triage item's own repo (row.repo drives the gate re-run).
    const owner = await first<{ repo: string }>(env.DB, `SELECT repo FROM doc_versions WHERE slug = 'orphan' AND version = 1`);
    expect(owner?.repo).toBe(REPO);

    // The triage item is resolved (and not deleted).
    const row = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(row?.resolved).toBe(1);
    expect(row?.resolution).toBe("assigned");
    expect(row?.assigned_ref).toBe("doc:orphan@1");
  });

  it("a low-confidence-new doc assigns successfully (the human's assignment vouches for it)", async () => {
    const cookie = await authedCookie(LOGIN);
    const r = await ingestDocProposal(
      env.DB,
      { slug: "shy", section: "reference", body: "tentative", change_summary: "s", confidence: "low" },
      "agent-x",
      REPO
    );
    expect(r.outcome).toBe("triaged"); // low confidence on a NEW slug → triage
    const id = (await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage ORDER BY id DESC LIMIT 1`))!.id;

    const res = await post(`/needs-triage/${id}/assign`, cookie, { type: "doc" }); // no section override; uses raw's valid one
    expect(res.status).toBe(200);
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'shy'`);
    expect(v?.status).toBe("staged");
  });

  it("double-assign is idempotent-safe: no second version is materialized", async () => {
    const cookie = await authedCookie(LOGIN);
    await ingestDocProposal(
      env.DB,
      { slug: "twice", section: "bogus", body: "b", change_summary: "s", confidence: "high" },
      "agent-x",
      REPO
    );
    const id = (await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage ORDER BY id DESC LIMIT 1`))!.id;

    expect((await post(`/needs-triage/${id}/assign`, cookie, { type: "doc", section: "reference" })).status).toBe(200);
    expect((await post(`/needs-triage/${id}/assign`, cookie, { type: "doc", section: "reference" })).status).toBe(200);
    const versions = await all<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'twice'`);
    expect(versions.length).toBe(1); // exactly one — the replay-safe assign did not double-stage
  });

  it("refuses (400) to place a doc with no valid section, leaving no stray triage row and no doc", async () => {
    const cookie = await authedCookie(LOGIN);
    await ingestDocProposal(
      env.DB,
      { slug: "nope", section: "still-bogus", body: "b", change_summary: "s", confidence: "high" },
      "agent-x",
      REPO
    );
    const before = await all<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage`);
    const id = before[before.length - 1].id;

    const res = await post(`/needs-triage/${id}/assign`, cookie, { type: "doc" }); // raw.section is out-of-vocab
    expect(res.status).toBe(400);

    // No materialized doc, no extra triage row, original still unresolved.
    expect((await all<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'nope'`)).length).toBe(0);
    expect((await all<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage`)).length).toBe(before.length);
    expect((await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id))?.resolved).toBe(0);
  });

  it("returns 401 without a session cookie", async () => {
    const id = await route_triage(env.DB, { raw: "{}", reason: "r", repo: REPO });
    const res = await app.request(hubPath(`/needs-triage/${id}/assign`), { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("assign on an already-discarded item reports resolution:'discarded', not 'assigned'", async () => {
    const cookie = await authedCookie(LOGIN);
    // Triage a free-form item (cannot be placed via assign — but first we discard it).
    const id = await route_triage(env.DB, { raw: "some free text", reason: "out of vocab", repo: REPO });

    // Discard it first.
    const discardRes = await post(`/needs-triage/${id}/discard`, cookie);
    expect(discardRes.status).toBe(200);
    expect(await discardRes.json()).toMatchObject({ ok: true, resolution: "discarded" });

    // Now call assign on the already-discarded item.
    const assignRes = await post(`/needs-triage/${id}/assign`, cookie, { type: "doc", section: "reference" });
    expect(assignRes.status).toBe(200);
    const out = (await assignRes.json()) as { ok: boolean; resolution: string; assigned_ref: string };
    // Must surface the actual recorded resolution ("discarded"), NOT falsely report "assigned".
    expect(out.resolution).toBe("discarded");
    expect(out.ok).toBe(true);

    // The row remains with its original discarded resolution — nothing was re-materialized.
    const row = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(row?.resolution).toBe("discarded");
    expect(row?.assigned_ref).toBeNull();
  });
});
