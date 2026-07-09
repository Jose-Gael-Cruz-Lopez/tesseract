import { describe, it, expect } from "vitest";
import { corsHeaders, handlePreflight } from "../src/cors";

const env = (o: string) => ({ CORS_ORIGINS: o } as any);

describe("cors", () => {
  it("allows a listed origin (echoes it, GET+OPTIONS only)", () => {
    const h = corsHeaders("http://localhost:5173", env("http://localhost:5173,https://app"));
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(h["Access-Control-Allow-Methods"]).toBe("GET,OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
  });

  it("gives nothing to an unlisted origin", () => {
    expect(corsHeaders("http://evil", env("http://localhost:5173"))).toEqual({});
  });

  it("preflight: 204 for an allowed OPTIONS, null otherwise", () => {
    const req = new Request("https://c/docs", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
    const res = handlePreflight(req, env("http://localhost:5173"));
    expect(res?.status).toBe(204);
    expect(handlePreflight(new Request("https://c/docs"), env("http://localhost:5173"))).toBeNull();
  });
});
