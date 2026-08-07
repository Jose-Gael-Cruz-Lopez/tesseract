import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/routes";
import { mintToken, resolveToken } from "../src/auth/tokens";
import { all } from "../src/db";
import { authedCookie } from "./helpers/session";

// MCP bearer tokens are long-lived (never expire) — so their lifecycle needs an
// owner-facing exit: list what you have, revoke what you don't. Before these
// routes, `mcp_tokens.revoked` was checked on every resolve but nothing could
// ever set it — per-token compromise response was manual D1 surgery.

async function ownTokenIds(login: string): Promise<number[]> {
  return (await all<{ id: number }>(env.DB, `SELECT id FROM mcp_tokens WHERE user = ? ORDER BY id`, login)).map((r) => r.id);
}

describe("GET /me/tokens", () => {
  it("lists only the caller's active tokens — id/created_at/last_used_at, never the hash", async () => {
    const cookie = await authedCookie("alice");
    await authedCookie("bob"); // seeds bob's users row
    await mintToken(env.DB, "alice");
    await mintToken(env.DB, "alice");
    await mintToken(env.DB, "bob");

    const res = await app.request("/me/tokens", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const { tokens } = (await res.json()) as { tokens: Array<Record<string, unknown>> };
    expect(tokens.map((t) => t.id).sort()).toEqual(await ownTokenIds("alice"));
    for (const t of tokens) {
      expect(Object.keys(t).sort()).toEqual(["created_at", "id", "last_used_at"]);
    }
  });

  it("requires a session — 401 bare", async () => {
    const res = await app.request("/me/tokens", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("POST /me/tokens/:id/revoke", () => {
  it("revokes the caller's own token: it stops resolving and leaves the list", async () => {
    const cookie = await authedCookie("alice");
    const { raw } = await mintToken(env.DB, "alice");
    const [id] = await ownTokenIds("alice");
    expect(await resolveToken(env.DB, raw)).toEqual({ login: "alice" }); // sane before

    const res = await app.request(`/me/tokens/${id}/revoke`, { method: "POST", headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await resolveToken(env.DB, raw)).toBeNull(); // the point of the route
    const list = await app.request("/me/tokens", { headers: { cookie } }, env);
    expect(((await list.json()) as { tokens: unknown[] }).tokens).toEqual([]);
  });

  it("404s another user's token id — and the token keeps working", async () => {
    const cookie = await authedCookie("alice");
    await authedCookie("bob");
    const { raw } = await mintToken(env.DB, "bob");
    const [bobId] = await ownTokenIds("bob");

    const res = await app.request(`/me/tokens/${bobId}/revoke`, { method: "POST", headers: { cookie } }, env);
    expect(res.status).toBe(404);
    expect(await resolveToken(env.DB, raw)).toEqual({ login: "bob" });
  });

  it("refuses a BEARER principal on list, revoke, and mint — token lifecycle is session-only", async () => {
    // sessionGate resolves bearers as a fallback on every route, but a leaked
    // bearer must not manage the token lifecycle: minting a sibling is
    // persistence (revoking the stolen token would no longer end the
    // compromise), and listing is recon. 403, not 401 — the credential is
    // valid, the surface is just not for it.
    await authedCookie("alice"); // seeds the users row
    const { raw } = await mintToken(env.DB, "alice");
    const [id] = await ownTokenIds("alice");
    const bearer = { authorization: `Bearer ${raw}` };

    const list = await app.request("/me/tokens", { headers: bearer }, env);
    expect(list.status).toBe(403);
    const revoke = await app.request(`/me/tokens/${id}/revoke`, { method: "POST", headers: bearer }, env);
    expect(revoke.status).toBe(403);
    const mint = await app.request("/auth/mcp-token", { method: "POST", headers: bearer }, env);
    expect(mint.status).toBe(403);

    // Nothing changed: the token still resolves and no sibling was minted.
    expect(await resolveToken(env.DB, raw)).toEqual({ login: "alice" });
    expect(await ownTokenIds("alice")).toEqual([id]);
  });

  it("404s an already-revoked or unknown id (idempotent surface, no oracle)", async () => {
    const cookie = await authedCookie("alice");
    await mintToken(env.DB, "alice");
    const [id] = await ownTokenIds("alice");
    await app.request(`/me/tokens/${id}/revoke`, { method: "POST", headers: { cookie } }, env);

    const again = await app.request(`/me/tokens/${id}/revoke`, { method: "POST", headers: { cookie } }, env);
    expect(again.status).toBe(404);
    const unknown = await app.request(`/me/tokens/999999/revoke`, { method: "POST", headers: { cookie } }, env);
    expect(unknown.status).toBe(404);
    const junk = await app.request(`/me/tokens/not-a-number/revoke`, { method: "POST", headers: { cookie } }, env);
    expect(junk.status).toBe(404);
  });
});
