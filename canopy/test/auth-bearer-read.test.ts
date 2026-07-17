import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { mintToken } from "../src/auth/tokens";

// sessionGate must accept a valid canopy_mcp_ token on the read routes (not just
// /mcp) — the dev sphere reads canopy cross-origin with a bearer (hub-scoped now).
// The flat /docs used here is ALSO admin-gated (issue #9 review), so the token is
// minted for the ADMIN_LOGINS entry: the bearer principal must clear both gates.
describe("bearer-authorized reads", () => {
  it("a valid bearer token authorizes GET /docs", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
    ).bind("admin-user", "Admin", "2026-01-01T00:00:00Z").run();
    const { raw } = await mintToken(env.DB, "admin-user");
    const res = await app.request("/docs", { headers: { authorization: `Bearer ${raw}` } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { docs: unknown[] };
    expect(Array.isArray(body.docs)).toBe(true);
  });

  it("a bad bearer is rejected", async () => {
    const res = await app.request("/docs", { headers: { authorization: "Bearer canopy_mcp_nope" } }, env);
    expect(res.status).toBe(401);
  });

  it("no auth is rejected", async () => {
    const res = await app.request("/docs", {}, env);
    expect(res.status).toBe(401);
  });
});
