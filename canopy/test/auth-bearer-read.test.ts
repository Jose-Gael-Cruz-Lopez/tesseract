import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { mintToken } from "../src/auth/tokens";

// The dev sphere reads canopy cross-origin with a bearer token. sessionGate must
// accept a valid canopy_mcp_ token on the read routes (not just /mcp).
describe("bearer-authorized reads", () => {
  it("a valid bearer token authorizes GET /docs", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`
    ).bind("Jose-Gael-Cruz-Lopez", "Jose", "2026-01-01T00:00:00Z").run();
    const { raw } = await mintToken(env.DB, "Jose-Gael-Cruz-Lopez");
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
