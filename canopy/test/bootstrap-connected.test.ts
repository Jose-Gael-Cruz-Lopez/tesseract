import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapRepo, first, _resetBootstrapForTests } from "../src/db";

// Phase 3 (grandfather): the bootstrap repo (GITHUB_REPO, backfilled at runtime by
// bootstrapRepo) must always be seeded 'connected' so the pre-existing single-tenant
// repo keeps its hub after the multi-tenant cutover (authorizeRepo only shows a hub
// for status='connected' — src/auth/access.ts). This guards that invariant against a
// future edit to bootstrapRepo's upsert silently dropping it.
describe("bootstrapRepo grandfather", () => {
  beforeEach(() => _resetBootstrapForTests());

  it("seeds the GITHUB_REPO registry row as connected", async () => {
    await bootstrapRepo(env, env.DB);
    const repo = (env.GITHUB_REPO as string) || "";
    const row = await first<{ status: string }>(env.DB, `SELECT status FROM repos WHERE repo = ?`, repo);
    expect(row?.status).toBe("connected");
  });
});
