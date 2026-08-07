/**
 * Settings — MCP token list render tests (audit hardening: token revocation).
 *
 * Pure render tests over web/src/render.ts (no D1 / Miniflare bindings): the
 * Settings screen must list the caller's ACTIVE tokens from state.myTokens and
 * emit a working revoke affordance per row — replacing the old hardcoded
 * "can't be listed here" note from the era when no GET /me/tokens existed.
 */
import { describe, it, expect } from "vitest";
import { render, initialState } from "../web/src/render";
import type { AppState } from "../web/src/render";

function settingsState(): AppState {
  const s = initialState();
  s.view = "app";
  s.screen = "settings";
  s.me = { login: "alice", name: "Alice", avatar_url: null, org: "", admin: false };
  return s;
}

describe("settings — MCP token list", () => {
  it("renders one row per active token with a revoke button carrying the token id", async () => {
    const s = settingsState();
    s.myTokens = {
      status: "ok",
      data: [
        { id: 3, created_at: "2026-08-01T10:00:00Z", last_used_at: "2026-08-05T09:00:00Z" },
        { id: 1, created_at: "2026-07-01T10:00:00Z", last_used_at: null },
      ],
    };
    const html = render(s);
    expect(html).toContain("Token #3");
    expect(html).toContain("Token #1");
    expect(html.match(/data-act="revokeToken"/g)).toHaveLength(2);
    expect(html).toContain('data-arg="3"');
    expect(html).toContain('data-arg="1"');
    expect(html).toContain("Never used"); // last_used_at null
    expect(html).not.toContain("can't be listed here"); // the pre-route note is gone
  });

  it("renders an empty state when there are no active tokens", () => {
    const s = settingsState();
    s.myTokens = { status: "ok", data: [] };
    const html = render(s);
    expect(html).toContain("No active tokens");
    expect(html).not.toContain('data-act="revokeToken"');
  });

  it("a failed fetch renders as an error notice, NEVER as the authoritative empty state", () => {
    // "No active tokens" on a 500 would tell a user mid-compromise-response that
    // revocation already happened when the list simply failed to load.
    const s = settingsState();
    s.myTokens = { status: "error", data: [], error: "Could not load tokens" };
    const html = render(s);
    expect(html).toContain("Could not load tokens");
    expect(html).not.toContain("No active tokens");
  });
});
