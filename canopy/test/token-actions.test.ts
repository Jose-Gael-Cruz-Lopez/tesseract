/**
 * Settings token actions — the DOM-free controller behind main.ts's dispatch
 * cases (mintToken / revokeToken) and the Settings-entry token load. Extracted
 * so the wiring the audit found inert (`case "revokeToken": return;`) is pinned
 * by tests: reverting any of these to a no-op fails here, not silently in prod.
 *
 * Pure (no D1 / Miniflare): deps are injected, mirroring the render tests.
 */
import { describe, it, expect, vi } from "vitest";
import { loadMyTokens, mintToken, revokeToken, type TokenActionDeps } from "../web/src/token-actions";
import { initialState } from "../web/src/render";
import type { AppState } from "../web/src/render";
import type { McpTokenMeta } from "../web/src/api";

const TOKENS: McpTokenMeta[] = [
  { id: 3, created_at: "2026-08-01T10:00:00Z", last_used_at: null },
];

function deps(over: Partial<TokenActionDeps> = {}): TokenActionDeps {
  return {
    listMyTokens: vi.fn(async () => TOKENS),
    mintMcpToken: vi.fn(async () => ({ token: "canopy_mcp_raw" })),
    revokeMcpToken: vi.fn(async () => ({ ok: true as const })),
    isUnauthorized: () => false,
    errorMessage: () => null,
    flash: vi.fn(),
    rerender: vi.fn(),
    ...over,
  };
}

function state(): AppState {
  const s = initialState();
  s.view = "app";
  s.screen = "settings";
  return s;
}

describe("loadMyTokens", () => {
  it("loads the list into state.myTokens", async () => {
    const s = state();
    const d = deps();
    await loadMyTokens(s, d);
    expect(s.myTokens).toEqual({ status: "ok", data: TOKENS });
  });

  it("a failure keeps prior data, records the error, and never fakes an empty list", async () => {
    const s = state();
    s.myTokens = { status: "ok", data: TOKENS };
    const d = deps({
      listMyTokens: vi.fn(async () => { throw new Error("boom"); }),
      errorMessage: () => "server said no",
    });
    await loadMyTokens(s, d);
    expect(s.myTokens.status).toBe("error");
    expect(s.myTokens.data).toEqual(TOKENS);
    expect(s.myTokens.error).toBe("server said no");
  });

  it("Unauthorized bounces to the login view", async () => {
    const s = state();
    const d = deps({
      listMyTokens: vi.fn(async () => { throw new Error("401"); }),
      isUnauthorized: () => true,
    });
    await loadMyTokens(s, d);
    expect(s.view).toBe("auth");
    expect(s.authStep).toBe("login");
  });
});

describe("revokeToken", () => {
  it("revokes by id, flashes, and reloads the list — the audited inert-action regression guard", async () => {
    const s = state();
    const d = deps();
    await revokeToken(s, d, "3");
    expect(d.revokeMcpToken).toHaveBeenCalledWith(3);
    expect(d.flash).toHaveBeenCalledWith(expect.stringContaining("revoked"));
    expect(d.listMyTokens).toHaveBeenCalled();
    expect(s.myTokens).toEqual({ status: "ok", data: TOKENS });
  });

  it("ignores a missing or non-integer arg without calling the API", async () => {
    const s = state();
    const d = deps();
    await revokeToken(s, d, null);
    await revokeToken(s, d, "not-a-number");
    expect(d.revokeMcpToken).not.toHaveBeenCalled();
  });

  it("a failure flashes the API error and leaves the list alone", async () => {
    const s = state();
    s.myTokens = { status: "ok", data: TOKENS };
    const d = deps({
      revokeMcpToken: vi.fn(async () => { throw new Error("nope"); }),
      errorMessage: () => "not found",
    });
    await revokeToken(s, d, "3");
    expect(d.flash).toHaveBeenCalledWith("not found");
    expect(s.myTokens).toEqual({ status: "ok", data: TOKENS });
  });
});

describe("mintToken", () => {
  it("reveals the raw token once and reloads the list", async () => {
    const s = state();
    const d = deps();
    await mintToken(s, d);
    expect(s.revealedToken).toBe("canopy_mcp_raw");
    expect(s.tokenCopied).toBe(false);
    expect(d.listMyTokens).toHaveBeenCalled();
  });

  it("a mint failure flashes and reveals nothing", async () => {
    const s = state();
    const d = deps({
      mintMcpToken: vi.fn(async () => { throw new Error("429"); }),
      errorMessage: () => "rate_limited",
    });
    await mintToken(s, d);
    expect(s.revealedToken).toBeNull();
    expect(d.flash).toHaveBeenCalledWith("rate_limited");
  });
});
