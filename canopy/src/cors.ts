import type { Env } from "./env";

// Cross-origin access for the read API (the Mnemosphere dev sphere). Only GET is
// allowed cross-origin, so a browser blocks any cross-origin write — read-only is
// enforced at the boundary without touching the write routes' own auth. Origins
// are an explicit allow-list from CORS_ORIGINS (comma-separated).

function allowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!allowed(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** A 204 preflight response for an allowed OPTIONS request; null otherwise. */
export function handlePreflight(request: Request, env: Env): Response | null {
  if (request.method !== "OPTIONS") return null;
  const h = corsHeaders(request.headers.get("origin"), env);
  if (!h["Access-Control-Allow-Origin"]) return null;
  return new Response(null, { status: 204, headers: h });
}
