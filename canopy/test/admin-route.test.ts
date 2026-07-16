import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { authedCookie } from "./helpers/session";

describe("POST /admin/backfill (session- + admin-gated)", () => {
  it("401s without a session", async () => {
    const res = await app.request("/admin/backfill", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("403s for a non-admin principal", async () => {
    const res = await app.request(
      "/admin/backfill",
      { method: "POST", headers: { cookie: await authedCookie("not-admin") } },
      env
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "admin only" });
  });

  it("passes the admin gate and 503s when the configured repo isn't connected (proves wiring, no network)", async () => {
    // ADMIN_LOGINS binds "admin-user" in vitest.config.ts, so this login clears
    // isAdmin. This route backfills defaultRepo(c.env) (GITHUB_REPO), but no `repos`
    // row for it is seeded in this test (bootstrapRepo never runs — this hits the
    // Hono app directly, not worker.fetch), so runBackfill returns ok:false BEFORE
    // any GitHub fetch → 503 with the config error.
    const res = await app.request(
      "/admin/backfill",
      { method: "POST", headers: { cookie: await authedCookie("admin-user") } },
      env
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "repo not connected or has no installation" });
  });
});
