import { describe, it, expect, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { all, first, run, nowIso, defaultRepo } from "../src/db";
import { _hubTestHooks, _resetHubTestHooks } from "../src/hub";
import { IngestPayload } from "@shared/contract";
import { ingestMilestoneProposal, consume } from "../src/consumer";
import type { MilestoneProposalRow, MilestoneRow, NeedsTriageRow } from "@shared/rows";
import { fetchMilestoneProgress, upsertProgress } from "../src/tools/progress";
import { get_plan, write_plan } from "../src/tools/plan";
import { promote_milestone_proposal, complete_milestone, stage_milestone_proposal } from "../src/tools/writes";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCanopyMcpServer } from "../src/mcp";
import type { Env } from "../src/env";

const sessionMeta = { id: "sess-roadmap", author: "x", ended_at: "2026-06-24T00:00:00Z", skill_version: "1.0" };

describe("milestone proposal gate", () => {
  it("stages a valid proposal; it is NOT a live milestone until promoted", async () => {
    const r = await ingestMilestoneProposal(
      env.DB,
      { title: "GA", target_date: "2026-09-01", status: "in_progress", github_ref: [1, 2], change_summary: "kickoff", confidence: "high" },
      "andres"
    );
    expect(r.outcome).toBe("written");

    const staged = await all<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals`);
    expect(staged.length).toBe(1);
    expect(staged[0].staged_status).toBe("staged");
    expect(JSON.parse(staged[0].github_ref!)).toEqual([1, 2]);

    const live = await all<MilestoneRow>(env.DB, `SELECT * FROM milestones`);
    expect(live.length).toBe(0); // not live until the human promote route runs
  });

  it("routes a 'done'-status proposal to triage (completion is a human action)", async () => {
    const r = await ingestMilestoneProposal(
      env.DB,
      { title: "Done?", target_date: "2026-09-01", status: "done", change_summary: "s", confidence: "high" },
      "andres"
    );
    expect(r.outcome).toBe("triaged");
    expect(await all<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals`)).toHaveLength(0);
    const triage = await all<NeedsTriageRow>(env.DB, `SELECT * FROM needs_triage`);
    expect(triage[0].reason).toContain("completion");
  });

  it("routes a low-confidence proposal to triage", async () => {
    const r = await ingestMilestoneProposal(
      env.DB,
      { title: "Maybe", target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "low" },
      "andres"
    );
    expect(r.outcome).toBe("triaged");
    expect(await all<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals`)).toHaveLength(0);
  });

  it("consume() no longer carries a milestone_proposals arm — zod strips it, nothing is staged", async () => {
    // Task 9: milestone_proposals was retired from IngestPayload. A raw payload
    // still carrying it parses fine (zod strips unknown keys) but stages nothing —
    // the gate fn above (driven directly) is what triage-assign still relies on.
    const rawPayload: unknown = {
      session: sessionMeta,
      milestone_proposals: [
        { title: "GA", target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "high" },
      ],
    };
    const payload = IngestPayload.parse(rawPayload);
    expect((payload as Record<string, unknown>).milestone_proposals).toBeUndefined();

    await consume(env.DB, payload, { login: "andres" });
    expect(await all<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals`)).toHaveLength(0);
  });
});

// A stub `fetch` returning canned GitHub issue/milestone JSON, keyed by URL.
function stubFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(map).find((k) => u.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(map[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("fetchMilestoneProgress", () => {
  it("counts closed vs total across an issue-number array", async () => {
    const fetchImpl = stubFetch({ "/issues/1": { state: "closed" }, "/issues/2": { state: "open" } });
    const p = await fetchMilestoneProgress({ token: "t", repo: "o/r", ref: "[1,2]", fetchImpl });
    expect(p).toEqual({ closed: 1, total: 2 });
  });

  it("reads counts directly from a milestone object", async () => {
    const fetchImpl = stubFetch({ "/milestones/5": { open_issues: 3, closed_issues: 7, state: "open" } });
    const p = await fetchMilestoneProgress({ token: "t", repo: "o/r", ref: "5", fetchImpl });
    expect(p).toEqual({ closed: 7, total: 10 });
  });

  it("falls back to null on a non-OK GitHub response (expired/revoked token), never throws", async () => {
    const fetchImpl = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const p = await fetchMilestoneProgress({ token: "stale", repo: "o/r", ref: "[1]", fetchImpl });
    expect(p).toBeNull();
  });

  it("skips a missing issue (404) but keeps counting the resolvable ones", async () => {
    const fetchImpl = stubFetch({ "/issues/1": { state: "closed" }, "/issues/3": { state: "open" } }); // issue 2 → 404
    const p = await fetchMilestoneProgress({ token: "t", repo: "o/r", ref: "[1,2,3]", fetchImpl });
    expect(p).toEqual({ closed: 1, total: 2 });
  });
});

describe("promote_milestone_proposal + complete_milestone", () => {
  it("promotes a staged proposal into a live milestone (and not before)", async () => {
    const pid = await stage_milestone_proposal(
      env.DB,
      { title: "GA", target_date: "2026-09-01", status: "in_progress", github_ref: [1, 2], change_summary: "s", confidence: "high" },
      "andres"
    );
    expect(await all<MilestoneRow>(env.DB, `SELECT * FROM milestones`)).toHaveLength(0);

    const m = await promote_milestone_proposal(env.DB, pid, "andres");
    expect(m.status).toBe("in_progress");
    expect(m.title).toBe("GA");

    const proposal = await first<MilestoneProposalRow>(env.DB, `SELECT * FROM milestone_proposals WHERE id = ?`, pid);
    expect(proposal?.staged_status).toBe("promoted");
    await expect(promote_milestone_proposal(env.DB, pid, "andres")).rejects.toThrow(); // no double-promote
  });

  it("complete_milestone flips a live milestone to 'done'; rejects missing/already-done", async () => {
    const pid = await stage_milestone_proposal(
      env.DB,
      { title: "GA", target_date: "2026-09-01", status: "in_progress", change_summary: "s", confidence: "high" },
      "andres"
    );
    const m = await promote_milestone_proposal(env.DB, pid, "andres");
    const done = await complete_milestone(env.DB, m.id);
    expect(done.status).toBe("done");
    const row = await first<MilestoneRow>(env.DB, `SELECT * FROM milestones WHERE id = ?`, m.id);
    expect(row?.status).toBe("done");
    await expect(complete_milestone(env.DB, m.id)).rejects.toThrow();   // already done
    await expect(complete_milestone(env.DB, 9999)).rejects.toThrow();   // missing
  });
});

// Hub-mutation helpers (issue #9: complete/promote live only under /r/:owner/:repo).
// Mirrors hub-routes.test.ts: connect the repo, then authorize via the hub test hooks.
const HUB_REPO = "octo/hub";
async function connectHub(repo: string) {
  await run(env.DB, `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`, repo, nowIso(), "andres", 1);
}
async function hubPost(path: string, canPush: boolean): Promise<Response> {
  _hubTestHooks.getUserToken = async () => "user-tok";
  _hubTestHooks.listRepos = [{ repo: HUB_REPO, can_push: canPush }];
  return app.request(path, { method: "POST", headers: { cookie: await authedCookie("andres") } }, env);
}

describe("roadmap HTTP routes (session-gated; flat read admin-gated)", () => {
  afterEach(() => { _resetHubTestHooks(); });
  it("GET /roadmap reads the plan store — narrative + milestones + cached progress, no live GitHub — and 401s without a session", async () => {
    const { milestones } = await write_plan(
      env.DB,
      { narrative: "Q3 push", milestones: [{ title: "GA", target_date: "2026-09-01", status: "upcoming", github_ref: 3 }] },
      "andres",
      defaultRepo(env) // the /roadmap route reads at defaultRepo(env) — seed there to match
    );
    await upsertProgress(env.DB, milestones[0].id, 4, 6, "event");

    const unauth = await app.request("/roadmap", {}, env);
    expect(unauth.status).toBe(401);

    // The flat /roadmap is admin-gated now (issue #9 review; see flat-reads-scoped.test.ts).
    const res = await app.request("/roadmap", { headers: { cookie: await authedCookie("admin-user") } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Awaited<ReturnType<typeof get_plan>>;
    expect(body.narrative).toBe("Q3 push");
    expect(body.milestones).toHaveLength(1);
    expect(body.milestones[0].title).toBe("GA");
    expect(body.milestones[0].progress).toEqual({ closed: 4, total: 6, computed_at: expect.any(String) });
  });

  // The complete/promote mutations live ONLY under /r/:owner/:repo now (issue #9 removed
  // the flat mutation routes — see flat-mutations-removed.test.ts). Each test connects a
  // hub repo, seeds the rows in it, and authorizes via the hub test hooks (push access).
  it("POST /r/:owner/:repo/milestones/:id/complete flips status for a push collaborator", async () => {
    await connectHub(HUB_REPO);
    const pid = await stage_milestone_proposal(env.DB, { title: "GA", target_date: "2026-09-01", status: "in_progress", change_summary: "s", confidence: "high" }, "andres", null, HUB_REPO);
    const m = await promote_milestone_proposal(env.DB, pid, "andres");
    const res = await hubPost(`/r/${HUB_REPO}/milestones/${m.id}/complete`, true);
    expect(res.status).toBe(200);
    const row = await first<MilestoneRow>(env.DB, `SELECT * FROM milestones WHERE id = ?`, m.id);
    expect(row?.status).toBe("done");
  });

  it("POST /r/:owner/:repo/milestone-proposals/:id/promote materializes a live milestone", async () => {
    await connectHub(HUB_REPO);
    const pid = await stage_milestone_proposal(env.DB, { title: "GA", target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "high" }, "andres", null, HUB_REPO);
    const res = await hubPost(`/r/${HUB_REPO}/milestone-proposals/${pid}/promote`, true);
    expect(res.status).toBe(200);
    expect(await all<MilestoneRow>(env.DB, `SELECT * FROM milestones`)).toHaveLength(1);
  });

  // The representative NEGATIVE for the hub's push-gate: a valid session WITHOUT push
  // access is 403'd and mutates nothing. Fail-when-broken: delete requirePush on
  // /milestones/:id/complete in src/hub.ts and this 403 becomes a 200 (the milestone
  // flips to done, failing the persistence assertion).
  it("POST /r/:owner/:repo/milestones/:id/complete is 403 for a read-only collaborator and does not mutate", async () => {
    await connectHub(HUB_REPO);
    const pid = await stage_milestone_proposal(env.DB, { title: "GA", target_date: "2026-09-01", status: "in_progress", change_summary: "s", confidence: "high" }, "andres", null, HUB_REPO);
    const m = await promote_milestone_proposal(env.DB, pid, "andres");
    const res = await hubPost(`/r/${HUB_REPO}/milestones/${m.id}/complete`, false);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "push access required" });
    // Fails closed: the milestone was NOT completed.
    const row = await first<MilestoneRow>(env.DB, `SELECT * FROM milestones WHERE id = ?`, m.id);
    expect(row?.status).toBe("in_progress");
  });
});

describe("registered MCP get_roadmap tool", () => {
  it("returns the same PlanView shape as GET /roadmap — the plan store, no token plumbing", async () => {
    const { milestones } = await write_plan(
      env.DB,
      { narrative: "MCP view", milestones: [{ title: "GA", target_date: "2026-09-01", status: "upcoming", github_ref: 3 }] },
      "andres",
      defaultRepo(env) // the MCP get_roadmap tool reads at defaultRepo(env) — seed there to match
    );
    await upsertProgress(env.DB, milestones[0].id, 4, 6, "event");

    const server = buildCanopyMcpServer(env as unknown as Env, { login: "andres" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const res = (await client.callTool({ name: "get_roadmap", arguments: {} })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(res.isError).toBeFalsy();
      const body = JSON.parse(res.content[0].text) as Awaited<ReturnType<typeof get_plan>>;
      expect(body.narrative).toBe("MCP view");
      expect(body.milestones).toHaveLength(1);
      expect(body.milestones[0].title).toBe("GA");
      expect(body.milestones[0].progress).toEqual({ closed: 4, total: 6, computed_at: expect.any(String) });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
