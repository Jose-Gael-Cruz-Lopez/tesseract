import { describe, it, expect } from "vitest";
import { authApp, safeReturnPath } from "../src/auth/routes";
import { env } from "cloudflare:test";

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

describe("GET /auth/login?return=", () => {
  it("stores a validated return path in the oauth_return cookie", async () => {
    const res = await authApp.request("/login?return=/", {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("oauth_return=%2F"); // "/" url-encoded
  });
  it("falls the return cookie back to /admin/ for an unsafe return", async () => {
    const res = await authApp.request("/login?return=https://evil.com", {}, env);
    expect(res.status).toBe(302);
    // "/admin/" url-encoded is %2Fadmin%2F
    expect(res.headers.get("set-cookie")).toContain("oauth_return=%2Fadmin%2F");
  });
});
