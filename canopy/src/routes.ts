import { Hono } from "hono";
import { IngestPayload } from "@shared/contract";
import type { AppEnv } from "./auth/principal";
import { sessionGate, isAdmin } from "./auth/principal";
import { authApp } from "./auth/routes";
import { syncInstallationFromApp } from "./auth/connect";
import { consume } from "./consumer";
import { defaultRepo, nowIso } from "./db";
import { runBackfill } from "./tools/backfill";
import { get_doc, list_docs, get_feed, query, list_needs_triage, list_adrs, list_milestone_proposals, list_proposals, list_identity_tasks } from "./tools/reads";
import { map_identity } from "./tools/writes";
import { get_plan } from "./tools/plan";
import { getMyWork } from "./tools/mywork";
import type { DashboardData } from "@shared/dashboard";
import { listAccessibleConnectedRepos } from "./tools/connected";
import hubApp from "./hub";

export const app = new Hono<AppEnv>();

// Gate first: everything except /auth/login and /auth/callback requires a session.
// Fails closed with 401 (no data in the body).
app.use("*", sessionGate);

// Auth endpoints (login/callback public via the gate's allowlist; logout/mcp-token gated).
app.route("/auth", authApp);

// GitHub App post-install callback (session-gated): GitHub redirects the installer back
// here with only an `installation_id`. Sync the install's account + repo list straight
// from the App API so the connection shows immediately (the webhook is still the durable
// source). Best-effort — a missing/non-numeric id or any sync failure just lands "/",
// never a 500.
app.get("/github/app/callback", async (c) => {
  const installationId = c.req.query("installation_id");
  if (!installationId || !Number.isInteger(Number(installationId))) return c.redirect("/");
  try {
    await syncInstallationFromApp(c.env, c.env.DB, Number(installationId), c.get("principal").login, nowIso());
  } catch {
    // Swallow — the installation webhook will still sync this install; never 500 the callback.
  }
  return c.redirect("/");
});

// Multi-tenant hub routes (Phase 3): /r/:owner/:repo/* behind repoGate. The flat
// defaultRepo READS below coexist until their own cutover; the flat mutations are
// gone (issue #9) — every promote-class write goes through the hub now.
app.route("/r/:owner/:repo", hubApp);

// The flat promote/reject/ratify/complete/discard/assign MUTATION routes are REMOVED
// (Phase B, issue #9 / plan Task 11): they were admin-gated but had no push-gate and no
// repo-ownership guard, so an id-keyed one could act on any tenant's row once a second
// repo connected. Their only home is now /r/:owner/:repo/* (src/hub.ts) — push-gated +
// ownership-guarded. Reads stay session-accessible on the flat surface. The remaining
// flat mutations below (/ingest, /identity-tasks/:login/map, /admin/backfill) each carry
// an explicit isAdmin gate (same 403 shape): /ingest stays reachable for agents still
// posting flat until MCP is fully repo-routed; identity mapping is cross-repo by design;
// backfill targets the single-tenant defaultRepo(env).
app.post("/ingest", async (c) => {
  const login = c.get("principal").login;
  if (!isAdmin(c.env, login)) return c.json({ error: "admin only" }, 403);
  const json = await c.req.json().catch(() => null);
  const parsed = IngestPayload.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "invalid payload", issues: parsed.error.issues }, 400);
  }
  // SEAM: a Cloudflare Queue producer.send({ payload, principal }) would slot in here.
  const result = await consume(c.env.DB, parsed.data, c.get("principal"), defaultRepo(c.env));
  return c.json({ ok: true, result });
});

app.get("/docs", async (c) => {
  const docs = await list_docs(c.env.DB, c.req.query("section"));
  return c.json({ docs });
});

app.get("/doc/:slug", async (c) => {
  const found = await get_doc(c.env.DB, c.req.param("slug"));
  if (!found) return c.json({ error: "not found" }, 404);
  return c.json(found);
});

app.get("/feed", async (c) => {
  const tags = c.req.query("tags");
  const limit = c.req.query("limit");
  const feed = await get_feed(c.env.DB, {
    author: c.req.query("author"),
    tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    since: c.req.query("since"),
    limit: limit ? Number(limit) : undefined,
  });
  return c.json({ feed });
});

// Human Search backs onto the same query() engine as MCP, but include_staged is
// false — the human screen surfaces only settled (live) context, never staged.
app.get("/search", async (c) => {
  const typesCsv = c.req.query("types");
  const types = typesCsv
    ? (typesCsv.split(",").map((t) => t.trim()).filter((t): t is "doc" | "decision" | "feed" | "milestone" =>
        t === "doc" || t === "decision" || t === "feed" || t === "milestone"))
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
  });
  return c.json({ result });
});

// SEAM: POST /ask — retrieve via query(), synthesize a grounded, slug-citing answer. Out of scope.

app.get("/needs-triage", async (c) => c.json({ items: await list_needs_triage(c.env.DB) }));

app.get("/adrs", async (c) => c.json({ adrs: await list_adrs(c.env.DB, c.req.query("status")) }));

app.get("/milestone-proposals", async (c) => c.json({ proposals: await list_milestone_proposals(c.env.DB) }));

// ── Review group (session-cookie only, NEVER MCP): the READ queues — GET
// /proposals (staged doc versions) + GET /adrs (ADR drafts). Their promote/
// ratify/reject/discard/assign resolves live ONLY under /r/:owner/:repo/*
// (src/hub.ts, push-gated). Agent produces, human confirms — in a hub. ──────

// The Proposals queue (Phase 3): staged doc versions newer than their live doc,
// not rejected, server-joined with both bodies + reconciler metadata. Kills the
// old web N+1 (audit G9) and is the data source Phase 4's detail pane renders.
app.get("/proposals", async (c) => c.json({ proposals: await list_proposals(c.env.DB) }));

// ── Maintenance group (session-cookie only, NEVER MCP): Unplaced items
// (GET /needs-triage; assign/discard resolve under /r/:owner/:repo/* only) +
// Identity (below — cross-repo by design, so it stays flat). ─────────────────

// Pending unknown-login identity tasks, each with a small LIVE activity sample
// pulled from `events` at read time — activity is never copied onto the task.
app.get("/identity-tasks", async (c) => c.json({ tasks: await list_identity_tasks(c.env.DB) }));

// Human placement (session-gated): map a login to a person. The `people`
// table's ONLY runtime write (a direct authored write, not a gate re-run),
// then a soft resolve of the task. My Work picks the mapping up at read time,
// so every already-captured event for this login surfaces with no backfill.
app.post("/identity-tasks/:login/map", async (c) => {
  const login = c.get("principal").login; // the admin ACTOR; the mapped subject is c.req.param("login")
  if (!isAdmin(c.env, login)) return c.json({ error: "admin only" }, 403);
  const body = (await c.req.json().catch(() => null)) as { person?: string } | null;
  const person = typeof body?.person === "string" ? body.person.trim() : "";
  if (!person) return c.json({ error: "person (non-empty string) required" }, 400);
  try {
    const res = await map_identity(c.env.DB, c.req.param("login"), person, login);
    return c.json({ ok: true, ...res });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// Roadmap read (session-gated): admin narrative + milestones in target-date order,
// merged with cached progress from the plan store. No live GitHub, no per-user token.
app.get("/roadmap", async (c) => c.json(await get_plan(c.env.DB, defaultRepo(c.env))));

// Personal dashboard (session-gated): the signed-in user's two-list My Work —
// previous activity (summarized merged/closed PRs) + open assigned issues,
// projected entirely from captured GitHub events. Stored nowhere; never 500s.
app.get("/me/dashboard", async (c) => {
  const login = c.get("principal").login;
  try {
    const data: DashboardData = await getMyWork(c.env.DB, login);
    return c.json(data);
  } catch {
    // Absolute backstop: never 500. Anything unexpected (D1) → empty degraded payload.
    const empty: DashboardData = { person: null, previousActivity: [], todo: [], degraded: true };
    return c.json(empty);
  }
});

// The signed-in user's connected hubs (GitHub-accessible ∩ connected). Feeds the web
// hub-list + the "Connect repos" button (appSlug). Never 500s → empty on any failure.
app.get("/me/repos", async (c) => {
  try {
    const repos = await listAccessibleConnectedRepos(c.env.DB, c.env, c.get("principal").login);
    return c.json({ repos, appSlug: c.env.GITHUB_APP_SLUG ?? null });
  } catch {
    return c.json({ repos: [], appSlug: c.env.GITHUB_APP_SLUG ?? null });
  }
});

// ADMIN action (session-gated + admin-gated): server-side GitHub backfill for the
// single-tenant flat deployment's configured GITHUB_REPO. A computed/authored direct
// writer in the promote class — humans (admins) trigger it — but every captured event
// still funnels through the ingestEvent gate fn. Non-admins get 403; an unconnected
// repo / one with no installation → 503 with the error. (The hub equivalent —
// POST /r/:owner/:repo/admin/backfill, push-gated — lives in src/hub.ts.)
app.post("/admin/backfill", async (c) => {
  const login = c.get("principal").login;
  if (!isAdmin(c.env, login)) return c.json({ error: "admin only" }, 403);
  const res = await runBackfill(c.env, login, defaultRepo(c.env));
  if (!res.ok) return c.json({ error: res.error }, 503);
  return c.json(res);
});
