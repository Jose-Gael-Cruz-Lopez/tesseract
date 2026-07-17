import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";
import { defaultRepo } from "../src/db";
import { propose_doc_update, promote_doc, stage_adr, route_triage, stage_milestone_proposal } from "../src/tools/writes";
import { write_plan } from "../src/tools/plan";

// Issue #9 review (Phase B follow-up): the flat READ surface is admin-gated and
// defaultRepo-scoped. /auth/login is open to ANY GitHub user (Task 10), so a bare
// session must not read the grandfathered tenant's content; and the moment a second
// tenant connects, an unscoped flat read would disclose its rows cross-tenant —
// defeating the security ordering the flat-mutation removal exists for.
//
// Fail-when-broken, both ways:
//  • drop the admin gate → the 403 assertions below flip to 200;
//  • drop the defaultRepo scope → the OTHER-tenant rows below leak into the
//    responses and the exact-content assertions fail.

const DEFAULT = () => defaultRepo(env);
const OTHER = "other/tenant";

// Every flat GET read (querystrings included where the route parses them).
const FLAT_READS = [
  "/docs",
  "/doc/some-slug",
  "/feed",
  "/search?q=anything",
  "/proposals",
  "/adrs",
  "/needs-triage",
  "/milestone-proposals",
  "/roadmap",
  "/identity-tasks",
];

const get = async (path: string, cookie?: string) =>
  app.request(path, cookie ? { headers: { cookie } } : {}, env);

describe("flat reads: gate order (session first, then admin — no data either way)", () => {
  it("401s every flat read without a session (no existence leak)", async () => {
    for (const path of FLAT_READS) {
      const res = await get(path);
      expect(res.status, `${path} should 401 without a session`).toBe(401);
    }
  });

  it("403s every flat read for a non-admin session, leaking nothing", async () => {
    // Seed one row of tenant content so a broken gate would actually return data.
    await route_triage(env.DB, { raw: "tenant secret", reason: "r", repo: DEFAULT() });
    const cookie = await authedCookie("andres"); // any signed-in GitHub user, NOT in ADMIN_LOGINS
    for (const path of FLAT_READS) {
      const res = await get(path, cookie);
      expect(res.status, `${path} should 403 for a non-admin`).toBe(403);
      const text = await res.text();
      expect(text).toContain("admin only");
      expect(text).not.toContain("tenant secret");
    }
  });
});

describe("flat reads: defaultRepo-scoped (another tenant's rows never surface)", () => {
  it("GET /docs + /doc/:slug serve only defaultRepo's docs; the other tenant's slug 404s", async () => {
    await propose_doc_update(env.DB, { slug: "default-doc", section: "reference", title: "Default Doc", body: "default body", change_summary: "s", confidence: "high", repo: DEFAULT() }, "a");
    await promote_doc(env.DB, "default-doc", 1, "a", DEFAULT());
    await propose_doc_update(env.DB, { slug: "other-doc", section: "reference", title: "Other Doc", body: "other body", change_summary: "s", confidence: "high", repo: OTHER }, "a");
    await promote_doc(env.DB, "other-doc", 1, "a", OTHER);

    const cookie = await authedCookie("admin-user");
    const { docs } = (await (await get("/docs", cookie)).json()) as { docs: Array<{ slug: string }> };
    expect(docs.map((d) => d.slug)).toEqual(["default-doc"]);

    expect((await get("/doc/default-doc", cookie)).status).toBe(200);
    // The other tenant's slug is out of scope — a plain 404, indistinguishable
    // from a slug that never existed (no cross-tenant existence leak).
    expect((await get("/doc/other-doc", cookie)).status).toBe(404);
  });

  it("GET /feed serves only defaultRepo's entries", async () => {
    await env.DB.prepare(`INSERT INTO feed (repo, author, summary, created_at) VALUES (?, 'a', 'default entry', '2026-01-01T00:00:00Z')`).bind(DEFAULT()).run();
    await env.DB.prepare(`INSERT INTO feed (repo, author, summary, created_at) VALUES (?, 'a', 'other entry', '2026-01-01T00:00:00Z')`).bind(OTHER).run();

    const cookie = await authedCookie("admin-user");
    const { feed } = (await (await get("/feed", cookie)).json()) as { feed: Array<{ summary: string }> };
    expect(feed.map((f) => f.summary)).toEqual(["default entry"]);
  });

  it("GET /adrs, /needs-triage, /milestone-proposals, /proposals each serve only defaultRepo's rows", async () => {
    const adrBase = { title: "", context: "c", decision: "d", rationale: "r", confidence: "high" as const };
    await stage_adr(env.DB, { ...adrBase, title: "default adr" }, "a", null, DEFAULT());
    await stage_adr(env.DB, { ...adrBase, title: "other adr" }, "a", null, OTHER);
    await route_triage(env.DB, { raw: "default item", reason: "r", repo: DEFAULT() });
    await route_triage(env.DB, { raw: "other item", reason: "r", repo: OTHER });
    const mBase = { target_date: "2026-09-01", status: "upcoming", change_summary: "s", confidence: "high" as const };
    await stage_milestone_proposal(env.DB, { ...mBase, title: "default milestone" }, "a", null, DEFAULT());
    await stage_milestone_proposal(env.DB, { ...mBase, title: "other milestone" }, "a", null, OTHER);
    // A staged doc version newer than its (unpromoted) doc = one Proposals row per repo.
    await propose_doc_update(env.DB, { slug: "staged-default", section: "reference", title: "Staged Default", body: "b", change_summary: "s", confidence: "high", repo: DEFAULT() }, "a");
    await propose_doc_update(env.DB, { slug: "staged-other", section: "reference", title: "Staged Other", body: "b", change_summary: "s", confidence: "high", repo: OTHER }, "a");

    const cookie = await authedCookie("admin-user");
    const { adrs } = (await (await get("/adrs", cookie)).json()) as { adrs: Array<{ title: string }> };
    expect(adrs.map((a) => a.title)).toEqual(["default adr"]);
    const { items } = (await (await get("/needs-triage", cookie)).json()) as { items: Array<{ raw: string }> };
    expect(items.map((i) => i.raw)).toEqual(["default item"]);
    const { proposals: mps } = (await (await get("/milestone-proposals", cookie)).json()) as { proposals: Array<{ title: string }> };
    expect(mps.map((p) => p.title)).toEqual(["default milestone"]);
    const { proposals } = (await (await get("/proposals", cookie)).json()) as { proposals: Array<{ slug: string }> };
    expect(proposals.map((p) => p.slug)).toEqual(["staged-default"]);
  });

  it("GET /search matches only defaultRepo's content", async () => {
    await propose_doc_update(env.DB, { slug: "search-default", section: "reference", title: "Search Default", body: "the kestrel lives here", change_summary: "s", confidence: "high", repo: DEFAULT() }, "a");
    await promote_doc(env.DB, "search-default", 1, "a", DEFAULT());
    await propose_doc_update(env.DB, { slug: "search-other", section: "reference", title: "Search Other", body: "the albatross lives elsewhere", change_summary: "s", confidence: "high", repo: OTHER }, "a");
    await promote_doc(env.DB, "search-other", 1, "a", OTHER);

    const cookie = await authedCookie("admin-user");
    const hit = (await (await get("/search?q=kestrel", cookie)).json()) as { result: { primary: Array<{ id: string }>; pointers: Array<{ id: string }> } };
    expect([...hit.result.primary, ...hit.result.pointers].some((p) => p.id === "search-default")).toBe(true);
    const miss = (await (await get("/search?q=albatross", cookie)).json()) as { result: { primary: unknown[]; pointers: unknown[] } };
    expect(miss.result.primary).toHaveLength(0);
    expect(miss.result.pointers).toHaveLength(0);
  });

  it("GET /roadmap reads only defaultRepo's plan — another tenant's narrative never surfaces", async () => {
    await write_plan(env.DB, { narrative: "other tenant's plan", milestones: [] }, "a", OTHER);
    const cookie = await authedCookie("admin-user");
    const body = (await (await get("/roadmap", cookie)).json()) as { narrative: string };
    expect(body.narrative).toBe("");
  });
});
