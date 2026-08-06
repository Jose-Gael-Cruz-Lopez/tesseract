import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { resolveBearerPrincipal, isAdmin } from "../src/auth/principal";
import type { Env } from "../src/env";
import { mintToken } from "../src/auth/tokens";

async function seedUser(login: string) {
  await env.DB.prepare(`INSERT INTO users (github_login, name, created_at) VALUES (?, ?, ?)`)
    .bind(login, login, "2026-01-01T00:00:00Z").run();
}
const req = (auth?: string) =>
  new Request("https://x/mcp", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("resolveBearerPrincipal", () => {
  it("resolves a valid bearer to the owner principal", async () => {
    await seedUser("real-user");
    const { raw } = await mintToken(env.DB, "real-user");
    expect(await resolveBearerPrincipal(req(`Bearer ${raw}`), env)).toEqual({ login: "real-user" });
  });

  it("returns null when the Authorization header is missing", async () => {
    expect(await resolveBearerPrincipal(req(), env)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveBearerPrincipal(req("Bearer canopy_mcp_unknown"), env)).toBeNull();
  });

  it("returns null for a revoked token", async () => {
    await seedUser("real-user");
    const { raw } = await mintToken(env.DB, "real-user");
    await env.DB.prepare(`UPDATE mcp_tokens SET revoked = 1`).run();
    expect(await resolveBearerPrincipal(req(`Bearer ${raw}`), env)).toBeNull();
  });
});

describe("isAdmin — case-insensitive, because GitHub logins are", () => {
  // Same rationale (and folding) as loginAllowed in auth/rate-limit.ts (issue #21):
  // ADMIN_LOGINS is hand-typed while GitHub canonicalizes login casing on its own,
  // so a casing mismatch must not silently lock the admin out of every admin surface.
  const envWith = (admins: string) => ({ ...env, ADMIN_LOGINS: admins }) as unknown as Env;

  it("matches regardless of casing on either side", () => {
    expect(isAdmin(envWith("Jose-Gael-Cruz-Lopez"), "jose-gael-cruz-lopez")).toBe(true);
    expect(isAdmin(envWith("jose-gael-cruz-lopez"), "Jose-Gael-Cruz-Lopez")).toBe(true);
  });

  it("still fails closed on an empty list and rejects non-members", () => {
    expect(isAdmin(envWith(""), "anyone")).toBe(false);
    expect(isAdmin(envWith("someone-else"), "jose")).toBe(false);
  });
});
