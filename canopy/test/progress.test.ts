import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { run, all, first, nowIso } from "../src/db";
import type { MilestoneRow, MilestoneProgressRow } from "@shared/rows";
import type { Env } from "../src/env";
import { eventsFromDelivery, handleGithubWebhook } from "../src/webhook";
import { ingestEvent } from "../src/consumer";
import worker from "../src/index";
import {
  upsertProgress,
  getProgress,
  applyEventProgress,
  recomputeAllProgress,
} from "../src/tools/progress";
import issueClosed from "./fixtures/gh-issue-closed.json";

// GitHub's own signing recipe — HMAC-SHA256 hex, prefixed `sha256=`. Mirrors
// test/webhook.test.ts's sign() helper.
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// `repo` defaults to "o/r" — the repo every recomputeAllProgress call (and most
// applyEventProgress calls) in this file targets, so a scoped `WHERE repo = ?`
// matches the seeded row without every caller needing to pass it explicitly.
// Callers exercising a DIFFERENT repo (issue #14's isolation test below, and the
// webhook end-to-end test whose fixture carries no `repository` field) override it.
async function seedMilestone(githubRef: string | null, title = "M", repo = "o/r"): Promise<number> {
  const res = await run(
    env.DB,
    `INSERT INTO milestones (repo, title, target_date, status, github_ref, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    repo,
    title,
    "2026-08-01",
    "in_progress",
    githubRef,
    nowIso(),
    "andres"
  );
  return res.meta.last_row_id as number;
}

// A stub `fetch` returning canned GitHub issue/milestone JSON, keyed by URL,
// mirroring test/roadmap.test.ts:96-103.
function stubFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(map).find((k) => u.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(map[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

function issuePayload(
  number: number,
  state: "open" | "closed",
  action: string,
  milestone: { number: number; open_issues: number; closed_issues: number } | null = null
) {
  return {
    action,
    issue: {
      number,
      title: `Issue ${number}`,
      html_url: `https://github.com/o/r/issues/${number}`,
      state,
      updated_at: "2026-07-01T10:00:00Z",
      user: { login: "AndresL230" },
      assignees: [],
      labels: [],
      milestone,
    },
  };
}

describe("upsertProgress + getProgress", () => {
  it("inserts then overwrites absolutely — the row reads the latest write, source included", async () => {
    const id = await seedMilestone(null);
    await upsertProgress(env.DB, id, 3, 10, "event");
    let map = await getProgress(env.DB);
    expect(map.get(id)).toMatchObject({ milestone_id: id, closed: 3, total: 10, source: "event" });

    await upsertProgress(env.DB, id, 5, 10, "recompute");
    map = await getProgress(env.DB);
    expect(map.get(id)).toMatchObject({ milestone_id: id, closed: 5, total: 10, source: "recompute" });

    const rows = await all<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, id);
    expect(rows).toHaveLength(1); // absolute overwrite, not a second row
  });
});

describe("applyEventProgress — milestone-number ref", () => {
  it("issue-closed fixture (milestone #3) upserts the matching milestone's cache row", async () => {
    // Verified fixture values (test/fixtures/gh-issue-closed.json): milestone
    // { number: 3, open_issues: 1, closed_issues: 5 } → closed:5, total:6.
    const id = await seedMilestone("3");
    await applyEventProgress(env.DB, issueClosed, "o/r");
    const row = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, id);
    expect(row).toMatchObject({ closed: 5, total: 6, source: "event" });
  });

  it("no-ops when no milestone has a matching github_ref", async () => {
    await seedMilestone("99");
    await applyEventProgress(env.DB, issueClosed, "o/r");
    expect(await all(env.DB, `SELECT * FROM milestone_progress`)).toHaveLength(0);
  });
});

describe("applyEventProgress — array ref", () => {
  it("recounts from the latest captured snapshot of each issue in the array", async () => {
    const id = await seedMilestone("[7,8]");

    const [event7] = eventsFromDelivery("issues", issuePayload(7, "closed", "closed"));
    const [event8] = eventsFromDelivery("issues", issuePayload(8, "open", "opened"));
    await ingestEvent(env.DB, event7, "github-webhook");
    await ingestEvent(env.DB, event8, "github-webhook");

    await applyEventProgress(env.DB, issuePayload(7, "closed", "closed"), "o/r");

    const row = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, id);
    expect(row).toMatchObject({ closed: 1, total: 2, source: "event" });
  });
});

// Issue #14: applyEventProgress must scope its milestone lookups by the
// delivery's own repo — milestone numbers collide across repos in multi-tenant,
// so an unscoped lookup could stamp a DIFFERENT repo's same-numbered milestone
// with this event's counts.
describe("applyEventProgress — repo scoping (issue #14)", () => {
  it("a same-numbered milestone in another repo is untouched", async () => {
    const idA = await seedMilestone("5", "M", "o/a");
    const idB = await seedMilestone("5", "M", "o/b");

    const payload = issuePayload(42, "closed", "closed", { number: 5, open_issues: 2, closed_issues: 3 });
    await applyEventProgress(env.DB, payload, "o/a");

    const rowA = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idA);
    expect(rowA).toMatchObject({ closed: 3, total: 5, source: "event" });

    // The real negative: o/b's same-numbered milestone must be untouched — no
    // milestone_progress row at all (not merely a different value).
    const rowB = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idB);
    expect(rowB).toBeNull();
  });
});

describe("recomputeAllProgress", () => {
  it("writes source:'recompute' for every milestone with a github_ref; a failing fetch leaves the prior row untouched", async () => {
    const idOk = await seedMilestone("5", "OK");
    const idBad = await seedMilestone("[1]", "Bad");
    await upsertProgress(env.DB, idBad, 1, 4, "event"); // prior cache row that must survive a 401

    const fetchImpl = ((url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/milestones/5")) {
        return Promise.resolve(
          new Response(JSON.stringify({ open_issues: 2, closed_issues: 8 }), { status: 200, headers: { "content-type": "application/json" } })
        );
      }
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    }) as unknown as typeof fetch;

    const result = await recomputeAllProgress(env.DB, { token: "t", repo: "o/r", fetchImpl });
    expect(result.updated).toBe(1);

    const rowOk = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idOk);
    expect(rowOk).toMatchObject({ closed: 8, total: 10, source: "recompute" });

    // The 401'd milestone's prior cache row is untouched — never wiped.
    const rowBad = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, idBad);
    expect(rowBad).toMatchObject({ closed: 1, total: 4, source: "event" });
  });

  it("never writes for milestones with no github_ref", async () => {
    await seedMilestone(null);
    const result = await recomputeAllProgress(env.DB, { token: "t", repo: "o/r", fetchImpl: stubFetch({}) });
    expect(result.updated).toBe(0);
    expect(await all(env.DB, `SELECT * FROM milestone_progress`)).toHaveLength(0);
  });
});

describe("webhook end-to-end — the progress seam", () => {
  const SECRET = "test-webhook-secret"; // matches vitest.config.ts binding

  it("issue-closed fixture through handleGithubWebhook writes the milestone_progress cache row", async () => {
    // issueClosed carries no `repository` field, so repoFromDelivery derives ""
    // for this delivery — seed the milestone under that same repo so the
    // (now repo-scoped) lookup in applyEventProgress actually matches it.
    const id = await seedMilestone("3", "M", "");
    const body = JSON.stringify(issueClosed);
    const sig = await sign(SECRET, body);
    const res = await handleGithubWebhook(
      new Request("https://x/webhook/github", {
        method: "POST",
        headers: { "x-github-event": "issues", "x-hub-signature-256": sig, "content-type": "application/json" },
        body,
      }),
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, captured: 1, unchanged: 0 });

    const row = await first<MilestoneProgressRow>(env.DB, `SELECT * FROM milestone_progress WHERE milestone_id = ?`, id);
    expect(row).toMatchObject({ closed: 5, total: 6, source: "event" });
  });
});

describe("default export scheduled() — the recompute backstop wiring", () => {
  const ctx = { waitUntil() {}, passThroughException() {} } as unknown as ExecutionContext;
  const controller = {} as ScheduledController;

  it("no-ops without GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY (never throws)", async () => {
    await seedMilestone("5"); // would be a recompute candidate if the guard didn't short-circuit
    const noAppId = { ...env, GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: "unused-pem" } as unknown as Env;
    await worker.scheduled(controller, noAppId, ctx);
    expect(await all(env.DB, `SELECT * FROM milestone_progress`)).toHaveLength(0);

    const noKey = { ...env, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: undefined } as unknown as Env;
    await worker.scheduled(controller, noKey, ctx);
    expect(await all(env.DB, `SELECT * FROM milestone_progress`)).toHaveLength(0);
  });

  it("with the App configured, delegates to recomputeConnectedRepos (no connected+installed repos → no network, no rows)", async () => {
    const withApp = { ...env, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: "unused-pem" } as unknown as Env;
    // No repos row is connected with an installation_id, so recomputeConnectedRepos's
    // SELECT returns nothing — the loop body (token mint + GitHub fetch) never runs.
    await worker.scheduled(controller, withApp, ctx);
    expect(await all(env.DB, `SELECT * FROM milestone_progress`)).toHaveLength(0);
  });
});
