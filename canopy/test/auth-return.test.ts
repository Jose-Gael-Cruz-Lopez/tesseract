import { describe, it, expect } from "vitest";
import { authApp, safeReturnPath } from "../src/auth/routes";
import { env } from "cloudflare:test";
import type { Env } from "../src/env";

// GITHUB_APP_CLIENT_ID isn't in vitest.config.ts's Miniflare bindings — /login (flipped to
// the App flow, Task 10) 503s app_not_configured without it, so layer it onto the real
// test env, same pattern as test/app-login.test.ts's appEnv.
const appEnv: Env = { ...env, GITHUB_APP_CLIENT_ID: "Iv1.testclient" } as Env;

describe("safeReturnPath", () => {
  it("keeps safe same-origin relative paths", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/admin/")).toBe("/admin/");
    expect(safeReturnPath("/some/where?x=1")).toBe("/some/where?x=1");
  });
  it("rejects protocol-relative, absolute, and empty inputs → /admin/", () => {
    expect(safeReturnPath("//evil.com")).toBe("/admin/");
    expect(safeReturnPath("https://evil.com")).toBe("/admin/");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/admin/");
    expect(safeReturnPath("")).toBe("/admin/");
    expect(safeReturnPath(undefined)).toBe("/admin/");
    expect(safeReturnPath(null)).toBe("/admin/");
  });
});

describe("GET /auth/login?return= (flipped to the GitHub App flow, Task 10)", () => {
  it("stores a validated return path in the app_oauth_return cookie", async () => {
    const res = await authApp.request("/login?return=/", {}, appEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("app_oauth_return=%2F"); // "/" url-encoded
  });
  it("falls the return cookie back to /admin/ for an unsafe return", async () => {
    const res = await authApp.request("/login?return=https://evil.com", {}, appEnv);
    expect(res.status).toBe(302);
    // "/admin/" url-encoded is %2Fadmin%2F
    expect(res.headers.get("set-cookie")).toContain("app_oauth_return=%2Fadmin%2F");
  });
});
