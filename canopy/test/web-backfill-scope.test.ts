/**
 * Issue #34 — "Sync GitHub" must target the ACTIVE hub, never the flat route.
 *
 * The flat POST /admin/backfill is isAdmin-gated and runs against defaultRepo(env),
 * so calling it from inside a hub was a wrong-target write: the SPA reported success
 * while a DIFFERENT tenant's repo was synced. The push-gated per-hub counterpart
 * POST /r/:owner/:repo/admin/backfill (src/hub.ts) targets repoOf(c) — the repo the
 * user is actually looking at — and is the only one the SPA may call.
 *
 * Pins the exact request path the way tests/canopy-api.test.js (Mnemosphere, PR #24)
 * pins every read, so a flat fallback fails the suite instead of silently backfilling
 * someone else's repo. web/src/api.ts takes no fetch injection (it IS the SPA's single
 * fetch site), so globalThis.fetch is stubbed — nothing leaves the test worker.
 *
 * Fail-when-broken: point adminBackfill() back at "/admin/backfill" and the exact-path
 * assertions fail; re-add a flat fallback to scoped() and the no-hub case fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActiveRepo, adminBackfill, ApiError } from "../web/src/api";

const OK_BODY = {
  ok: true, captured: 3, unchanged: 1, summarized: 2, summaryBudgetExhausted: false,
  prSummarizedCount: 2, issueSummarizedCount: 0, prs: 5, issues: 4, issuesToSummarize: 4,
};

// Records every request the SPA makes, so "never the flat path" is checkable across
// the whole run, not just the first call.
let calls: { url: string; init: RequestInit | undefined }[] = [];
function stubFetch(response: () => Response): void {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(response());
  });
}

beforeEach(() => { calls = []; setActiveRepo(null); });
afterEach(() => {
  vi.unstubAllGlobals();
  setActiveRepo(null); // module-level state — never leak into other files
});

describe("adminBackfill targets the active hub", () => {
  it("POSTs the hub route for the active repo and never the flat path", async () => {
    stubFetch(() => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    setActiveRepo("octo/hub");

    const res = await adminBackfill();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/r/octo/hub/admin/backfill");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls.map((c) => c.url)).not.toContain("/admin/backfill");
    // The response envelope still feeds the batch loop's progress bars unchanged.
    expect(res.captured).toBe(3);
    expect(res.summaryBudgetExhausted).toBe(false);
  });

  it("follows the hub the user switched to — the target is never sticky", async () => {
    stubFetch(() => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    setActiveRepo("octo/hub");
    await adminBackfill();
    setActiveRepo("acme/widgets");
    await adminBackfill();

    expect(calls.map((c) => c.url)).toEqual([
      "/r/octo/hub/admin/backfill",
      "/r/acme/widgets/admin/backfill",
    ]);
  });

  it("refuses before any fetch when no hub is selected", async () => {
    stubFetch(() => new Response("{}", { status: 200 }));

    await expect(adminBackfill()).rejects.toThrow("Select a repo first");
    await expect(adminBackfill()).rejects.toBeInstanceOf(ApiError);
    expect(calls).toEqual([]); // no flat round-trip to 403 on
  });

  it("surfaces the push gate's 403 message instead of failing silently", async () => {
    // What a push-less collaborator gets from the hub route (requirePush, src/hub.ts).
    stubFetch(() => new Response(JSON.stringify({ error: "push access required" }), { status: 403 }));
    setActiveRepo("octo/hub");

    // main.ts's catch flashes e.message for an ApiError — so the toast must carry the
    // server's reason, not a bare status the user can't act on.
    await expect(adminBackfill()).rejects.toThrow("push access required");
    await expect(adminBackfill()).rejects.toMatchObject({ status: 403 });
  });
});
