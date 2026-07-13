import { Hono, type Context } from "hono";
import type { AppEnv } from "./auth/principal";
import { makeRepoGate, repoOf } from "./auth/repo-gate";
import { getUserToken } from "./auth/user-token";
import { get_plan } from "./tools/plan";
import { get_doc, list_docs, get_feed, query, list_needs_triage, list_adrs, list_proposals, list_milestone_proposals } from "./tools/reads";
import { getMyWork } from "./tools/mywork";
import type { DashboardData } from "@shared/dashboard";
import {
  promote_doc, reject_doc_version, ratify_adr, reject_adr,
  promote_milestone_proposal, reject_milestone_proposal, complete_milestone,
  resolve_triage, assign_triage, type AssignType,
} from "./tools/writes";
import { docRepo, adrRepo, milestoneProposalRepo, milestoneRepo, triageRepo } from "./tools/repo-ownership";
import { IngestPayload } from "@shared/contract";
import { consume } from "./consumer";
import { runBackfill } from "./tools/backfill";

// Multi-tenant hub router (Phase 3): mounted at /r/:owner/:repo, gated by repoGate on
// every route. Handlers read the authorized repo via repoOf(c) rather than defaultRepo(env).

// Test seam: when set, these override the live wiring the gate builds from c.env.
// Production leaves them undefined → the gate uses getUserToken + the real
// authorizeRepo/accessibleRepos. Tests set them to avoid real GitHub + token storage.
export const _hubTestHooks: {
  getUserToken?: (login: string) => Promise<string | null>;
  listRepos?: import("./auth/app").AccessibleRepo[] | ((token: string) => Promise<import("./auth/app").AccessibleRepo[]>);
} = {};

export function _resetHubTestHooks(): void {
  _hubTestHooks.getUserToken = undefined;
  _hubTestHooks.listRepos = undefined;
}

const hubApp = new Hono<AppEnv>();

// Build repoGate per-request (Workers env is per-request). Test hooks override the
// live token store + access set; production uses the real getUserToken + accessibleRepos.
hubApp.use("*", async (c, next) => {
  const listRepos = _hubTestHooks.listRepos;
  const gate = makeRepoGate({
    db: c.env.DB,
    env: c.env,
    getUserToken: _hubTestHooks.getUserToken ?? ((login: string) => getUserToken(c.env.DB, c.env, login)),
    ...(listRepos
      ? { listRepos: typeof listRepos === "function" ? listRepos : async () => listRepos }
      : {}),
  });
  return gate(c, next);
});

// Roadmap read, scoped to the gated repo.
hubApp.get("/roadmap", async (c) => c.json(await get_plan(c.env.DB, repoOf(c))));

hubApp.get("/feed", async (c) => {
  const tags = c.req.query("tags");
  const limit = c.req.query("limit");
  const feed = await get_feed(c.env.DB, {
    author: c.req.query("author"),
    tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    since: c.req.query("since"),
    limit: limit ? Number(limit) : undefined,
  }, repoOf(c));
  return c.json({ feed });
});

hubApp.get("/docs", async (c) => c.json({ docs: await list_docs(c.env.DB, c.req.query("section"), repoOf(c)) }));

hubApp.get("/doc/:slug", async (c) => {
  const found = await get_doc(c.env.DB, c.req.param("slug"), repoOf(c));
  if (!found) return c.json({ error: "not found" }, 404);
  return c.json(found);
});

hubApp.get("/search", async (c) => {
  const typesCsv = c.req.query("types");
  const types = typesCsv
    ? typesCsv.split(",").map((t) => t.trim()).filter((t): t is "doc" | "decision" | "feed" | "milestone" =>
        t === "doc" || t === "decision" || t === "feed" || t === "milestone")
    : undefined;
  const spaceRaw = c.req.query("space");
  const space = spaceRaw === "sapling" || spaceRaw === "canopy" ? spaceRaw : undefined;
  const limit = c.req.query("limit");
  const result = await query(c.env.DB, {
    q: c.req.query("q") ?? "",
    types: types && types.length ? types : undefined,
    section: c.req.query("section"),
    space,
    include_staged: false,
    limit: limit ? Number(limit) : undefined,
  }, repoOf(c));
  return c.json({ result });
});

hubApp.get("/needs-triage", async (c) => c.json({ items: await list_needs_triage(c.env.DB, repoOf(c)) }));
hubApp.get("/adrs", async (c) => c.json({ adrs: await list_adrs(c.env.DB, c.req.query("status"), repoOf(c)) }));
hubApp.get("/proposals", async (c) => c.json({ proposals: await list_proposals(c.env.DB, repoOf(c)) }));
hubApp.get("/milestone-proposals", async (c) => c.json({ proposals: await list_milestone_proposals(c.env.DB, repoOf(c)) }));

hubApp.get("/me/dashboard", async (c) => {
  try {
    const data: DashboardData = await getMyWork(c.env.DB, c.get("principal").login, repoOf(c));
    return c.json(data);
  } catch {
    const empty: DashboardData = { person: null, previousActivity: [], todo: [], degraded: true };
    return c.json(empty);
  }
});

// ── Mutations (Phase 3): push-gated, repo-ownership guarded ────────────────────
// Every write below requires c.get("canPush") (requirePush, checked FIRST — a
// read-only collaborator never triggers a DB probe) and, for id/slug-keyed rows,
// confirms the row's own repo matches repoOf(c) BEFORE delegating to the writer —
// otherwise 404 (never leak whether the id exists in some other tenant's repo).
// The id-keyed writers in tools/writes.ts take no repo param, so this guard is the
// ONLY thing standing between a push-authorized user and a cross-repo write.

// Admin (push⇒admin) gate for the authored/promote-class writes under a hub.
function requirePush(c: Context<AppEnv>): Response | null {
  return c.get("canPush") ? null : c.json({ error: "push access required" }, 403);
}

// Ingest (agent-proposed content) scoped to the hub's repo.
hubApp.post("/ingest", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IngestPayload.safeParse(json);
  if (!parsed.success) return c.json({ error: "invalid payload", issues: parsed.error.issues }, 400);
  const result = await consume(c.env.DB, parsed.data, c.get("principal"), repoOf(c));
  return c.json({ ok: true, result });
});

hubApp.post("/doc/:slug/promote", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const body = await c.req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version)) return c.json({ error: "version (integer) required" }, 400);
  const owner = await docRepo(c.env.DB, c.req.param("slug"), repoOf(c));
  if (owner !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try {
    const res = await promote_doc(c.env.DB, c.req.param("slug"), version, c.get("principal").login, repoOf(c));
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/doc/:slug/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const body = await c.req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version)) return c.json({ error: "version (integer) required" }, 400);
  const owner = await docRepo(c.env.DB, c.req.param("slug"), repoOf(c));
  if (owner !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try {
    const res = await reject_doc_version(c.env.DB, c.req.param("slug"), version, repoOf(c));
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

// id-keyed writers: push-gate + repo-ownership guard, then delegate unchanged.
hubApp.post("/adr/:id/ratify", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await adrRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await ratify_adr(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/adr/:id/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await adrRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await reject_adr(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestone-proposals/:id/promote", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneProposalRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, milestone: await promote_milestone_proposal(c.env.DB, id, c.get("principal").login) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestone-proposals/:id/reject", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneProposalRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await reject_milestone_proposal(c.env.DB, id)) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/milestones/:id/complete", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await milestoneRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, milestone: await complete_milestone(c.env.DB, id) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/needs-triage/:id/discard", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await triageRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  try { return c.json({ ok: true, ...(await resolve_triage(c.env.DB, id, c.get("principal").login, "discarded")) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

hubApp.post("/needs-triage/:id/assign", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  if ((await triageRepo(c.env.DB, id)) !== repoOf(c)) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { type?: AssignType; section?: string; space?: "sapling" | "canopy"; tags?: string[] } | null;
  try {
    const res = await assign_triage(c.env.DB, id, c.get("principal").login, { type: body?.type, section: body?.section, space: body?.space, tags: body?.tags });
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
});

// ADMIN action, push-gated: server-side GitHub backfill for the gated repo's OWN
// GitHub App installation — the per-repo counterpart to the flat POST /admin/backfill
// (routes.ts), which still backs the single-tenant deployment's defaultRepo(env).
// No id/slug ownership lookup needed: repoOf(c) IS the target, already authorized by
// the gate above.
hubApp.post("/admin/backfill", async (c) => {
  const gate = requirePush(c); if (gate) return gate;
  const res = await runBackfill(c.env, c.get("principal").login, repoOf(c));
  if (!res.ok) return c.json({ error: res.error }, 503);
  return c.json(res);
});

export default hubApp;
