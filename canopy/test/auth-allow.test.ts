import { describe, it, expect } from "vitest";
import type { Env } from "../src/env";
import { isAllowed } from "../src/auth/principal";

// Minimal Env stub — only the fields isAllowed reads in allow-list mode.
function env(over: Partial<Env>): Env {
  return { AUTH_ORG: "", ADMIN_LOGINS: "", DB: {}, ASSETS: {}, GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", COOKIE_SECRET: "", ...over } as unknown as Env;
}

describe("isAllowed (personal / allow-list mode: AUTH_ORG empty)", () => {
  it("allows a login on the ADMIN_LOGINS allow-list", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "Jose-Gael-Cruz-Lopez, someoneelse" }), "unused-token", "Jose-Gael-Cruz-Lopez");
    expect(ok).toBe(true);
  });

  it("rejects a login not on the allow-list", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "Jose-Gael-Cruz-Lopez" }), "unused-token", "randomPerson");
    expect(ok).toBe(false);
  });

  it("rejects everyone when the allow-list is empty (fails closed)", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "" }), "unused-token", "anyone");
    expect(ok).toBe(false);
  });
});
