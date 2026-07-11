import { Hono } from "hono";
import type { AppEnv } from "./auth/principal";
import { makeRepoGate, repoOf } from "./auth/repo-gate";
import { getUserToken } from "./auth/user-token";
import { get_plan } from "./tools/plan";
import { get_doc, list_docs, get_feed, query, list_needs_triage, list_adrs, list_proposals, list_milestone_proposals } from "./tools/reads";
import { getMyWork } from "./tools/mywork";
import type { DashboardData } from "@shared/dashboard";

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
  const limit = c.req.query("limit");
  const result = await query(c.env.DB, {
    q: c.req.query("q") ?? "",
    types: types && types.length ? types : undefined,
    section: c.req.query("section"),
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

export default hubApp;
