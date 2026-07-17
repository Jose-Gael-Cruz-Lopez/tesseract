import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";
import { all, first, defaultRepo } from "../src/db";
import type { DocRow, DocVersionRow, AdrRow, MilestoneRow, MilestoneProposalRow, NeedsTriageRow } from "@shared/rows";
import { propose_doc_update, stage_adr, stage_milestone_proposal, promote_milestone_proposal, route_triage } from "../src/tools/writes";

// Phase B (issue #9, plan Task 11): the flat mutation routes are REMOVED, atomically
// with GitHub App activation. They were session+admin gated but had no push-gate and no
// repo-ownership guard, so an id-keyed one could act on any tenant's row the moment a
// second repo connected. Every mutation now lives ONLY under /r/:owner/:repo/* (push-
// gated + ownership-guarded, src/hub.ts). Fail-when-broken: re-adding any flat mutation
// route turns its 404 below into a 2xx/4xx-with-effect and fails the persistence check.

const docBase = { section: "reference", change_summary: "s", confidence: "high" as const };
const milestoneBase = { title: "GA", target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "high" as const };

// The strongest principal the flat surface ever honored — the ADMIN_LOGINS entry
// (vitest.config.ts). Even an admin session gets 404: the route no longer exists.
const admin = () => authedCookie("admin-user");

const post = async (path: string, body?: unknown) =>
  app.request(
    path,
    { method: "POST", headers: { cookie: await admin(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env
  );

describe("flat mutation routes are removed (404 even for an admin; nothing mutates)", () => {
  it("POST /doc/:slug/promote is gone — the staged version stays staged, the doc unpromoted", async () => {
    await propose_doc_update(env.DB, { ...docBase, slug: "flat-promote", title: "T", body: "# v1", repo: defaultRepo(env) }, "andres");
    const res = await post("/doc/flat-promote/promote", { version: 1 });
    expect(res.status).toBe(404);
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'flat-promote' AND version = 1`);
    expect(v?.status).toBe("staged");
    const doc = await first<DocRow>(env.DB, `SELECT * FROM docs WHERE slug = 'flat-promote'`);
    expect(doc?.current_version ?? 0).toBe(0); // never promoted
  });

  it("POST /doc/:slug/reject is gone — the staged version stays staged", async () => {
    await propose_doc_update(env.DB, { ...docBase, slug: "flat-reject", title: "T", body: "# v1", repo: defaultRepo(env) }, "andres");
    const res = await post("/doc/flat-reject/reject", { version: 1 });
    expect(res.status).toBe(404);
    const v = await first<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'flat-reject' AND version = 1`);
    expect(v?.status).toBe("staged");
  });

  it("POST /adr/:id/ratify is gone — the draft stays a draft", async () => {
    const id = await stage_adr(env.DB, { title: "t", context: "c", decision: "d", rationale: "r", confidence: "high" }, "andres", null, defaultRepo(env));
    const res = await post(`/adr/${id}/ratify`);
    expect(res.status).toBe(404);
    const adr = await first<AdrRow>(env.DB, `SELECT * FROM adrs WHERE id = ?`, id);
    expect(adr?.status).toBe("draft");
  });

  it("POST /adr/:id/reject is gone — the draft stays a draft", async () => {
    const id = await stage_adr(env.DB, { title: "t", context: "c", decision: "d", rationale: "r", confidence: "high" }, "andres", null, defaultRepo(env));
    const res = await post(`/adr/${id}/reject`);
    expect(res.status).toBe(404);
    const adr = await first<AdrRow>(env.DB, `SELECT * FROM adrs WHERE id = ?`, id);
    expect(adr?.status).toBe("draft");
  });

  it("POST /milestone-proposals/:id/promote is gone — nothing materializes", async () => {
    const pid = await stage_milestone_proposal(env.DB, milestoneBase, "andres", null, defaultRepo(env));
    const res = await post(`/milestone-proposals/${pid}/promote`);
    expect(res.status).toBe(404);
    const p = await first<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals WHERE id = ?`, pid);
    expect(p?.staged_status).toBe("staged");
    expect(await all<MilestoneRow>(env.DB, `SELECT * FROM milestones`)).toHaveLength(0);
  });

  it("POST /milestone-proposals/:id/reject is gone — the proposal stays staged", async () => {
    const pid = await stage_milestone_proposal(env.DB, milestoneBase, "andres", null, defaultRepo(env));
    const res = await post(`/milestone-proposals/${pid}/reject`);
    expect(res.status).toBe(404);
    const p = await first<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals WHERE id = ?`, pid);
    expect(p?.staged_status).toBe("staged");
  });

  it("POST /milestones/:id/complete is gone — the milestone is NOT flipped to done", async () => {
    const pid = await stage_milestone_proposal(env.DB, { ...milestoneBase, status: "in_progress" }, "andres", null, defaultRepo(env));
    const m = await promote_milestone_proposal(env.DB, pid, "andres");
    const res = await post(`/milestones/${m.id}/complete`);
    expect(res.status).toBe(404);
    const row = await first<MilestoneRow>(env.DB, `SELECT * FROM milestones WHERE id = ?`, m.id);
    expect(row?.status).toBe("in_progress");
  });

  it("POST /needs-triage/:id/discard is gone — the item stays unresolved", async () => {
    const id = await route_triage(env.DB, { raw: "free text", reason: "out of vocab", repo: defaultRepo(env) });
    const res = await post(`/needs-triage/${id}/discard`);
    expect(res.status).toBe(404);
    const row = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(row?.resolved).toBe(0);
  });

  it("POST /needs-triage/:id/assign is gone — the item stays unresolved, nothing materializes", async () => {
    const id = await route_triage(
      env.DB,
      { raw: { slug: "flat-assign", section: "reference", body: "b", change_summary: "s", confidence: "high" }, reason: "r", repo: defaultRepo(env) }
    );
    const res = await post(`/needs-triage/${id}/assign`, { type: "doc", section: "reference" });
    expect(res.status).toBe(404);
    const row = await first<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage WHERE id = ?`, id);
    expect(row?.resolved).toBe(0);
    expect(await all<DocVersionRow>(env.DB, `SELECT * FROM doc_versions WHERE slug = 'flat-assign'`)).toHaveLength(0);
  });

  it("without a session the removed paths still 401 (the gate runs first — no existence leak)", async () => {
    const res = await app.request("/adr/1/ratify", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });
});
