import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { readSessionCookie, getSessionUser } from "./session";
import { resolveToken } from "./tokens";
import { loginAllowed } from "./rate-limit";

export interface Principal {
  login: string;
}

/** How the request authenticated: a browser session cookie, an agent bearer
 *  token, or the local-dev DEV_LOGIN shortcut. Routes that must be driven by a
 *  human (the token lifecycle) check this — a valid bearer is still not a person. */
export type PrincipalSource = "session" | "bearer" | "dev";

export type AppEnv = { Bindings: Env; Variables: { principal: Principal; principalSource: PrincipalSource; repo?: string; canPush?: boolean } };

/**
 * Is this login an admin? ADMIN_LOGINS is a comma-separated allowlist of GitHub
 * logins permitted to run admin actions (e.g. the server-side backfill). An
 * absent/empty var means nobody is an admin — fails closed. Case-insensitive,
 * because GitHub logins are (same folding and rationale as loginAllowed): the
 * var is hand-typed, and a casing mismatch would silently lock the admin out of
 * every admin surface.
 */
export function isAdmin(env: Env, login: string): boolean {
  const allow = (env.ADMIN_LOGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(login.toLowerCase());
}

// The only routes reachable without a session. Everything else is gated.
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/callback", "/auth/app/login", "/auth/app/callback"]);

export async function resolveSessionPrincipal(c: Context<AppEnv>): Promise<Principal | null> {
  const id = await readSessionCookie(c, c.env.COOKIE_SECRET);
  if (!id) return null;
  const login = await getSessionUser(c.env.DB, id);
  return login ? { login } : null;
}

export async function resolveBearerPrincipal(request: Request, env: Env): Promise<Principal | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return resolveToken(env.DB, match[1]);
}

/**
 * Gate every route except the two public auth paths. Fails closed: 401 with no
 * data in the body. On success, sets the principal on the context for handlers.
 */
export const sessionGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  // LOCAL DEV ONLY: DEV_LOGIN exists only in .dev.vars (never in production vars or
  // secrets), so this branch is inert in prod. When set, skip the OAuth/session check
  // and act as that seeded user — lets the UI be exercised over `wrangler dev` without
  // the real GitHub flow. Mirrors scripts/dev-cookie.mjs, but with zero cookie fuss.
  if (c.env.DEV_LOGIN) {
    c.set("principal", { login: c.env.DEV_LOGIN });
    c.set("principalSource", "dev");
    return next();
  }
  // Session cookie first (humans in canopy's own UI); then a bearer token so the
  // cross-origin dev sphere can read with Authorization: Bearer canopy_mcp_…
  const session = await resolveSessionPrincipal(c);
  const principal = session ?? (await resolveBearerPrincipal(c.req.raw, c.env));
  // LOGIN_ALLOWLIST (issue #21) is re-checked here, not only at sign-in: 30-day
  // sessions and never-expiring mcp_tokens minted while signup was open must stop
  // working the moment the list is flipped on, or the toggle is no abuse brake.
  // Same bare 401 as any bad credential — a non-listed login learns nothing.
  if (!principal || !loginAllowed(c.env, principal.login)) return c.json({ error: "unauthorized" }, 401);
  c.set("principal", principal);
  c.set("principalSource", session ? "session" : "bearer");
  return next();
};
