import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { readSessionCookie, getSessionUser } from "./session";
import { resolveToken } from "./tokens";
import { isActiveOrgMember } from "./github";

export interface Principal {
  login: string;
}

export type AppEnv = { Bindings: Env; Variables: { principal: Principal } };

/**
 * Is this login an admin? ADMIN_LOGINS is a comma-separated allowlist of GitHub
 * logins permitted to run admin actions (e.g. the server-side backfill). An
 * absent/empty var means nobody is an admin — fails closed.
 */
export function isAdmin(env: Env, login: string): boolean {
  const allow = (env.ADMIN_LOGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(login);
}

/**
 * The login gate for the OAuth callback. When AUTH_ORG is set, only active
 * members of that GitHub org may log in. When AUTH_ORG is empty (personal /
 * multi-owner repos), fall back to the ADMIN_LOGINS allow-list. Fails closed.
 */
export async function isAllowed(env: Env, token: string, login: string): Promise<boolean> {
  const org = (env.AUTH_ORG ?? "").trim();
  if (org) return isActiveOrgMember(token, org);
  return isAdmin(env, login);
}

// The only routes reachable without a session. Everything else is gated.
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/callback"]);

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
    return next();
  }
  const principal = await resolveSessionPrincipal(c);
  if (!principal) return c.json({ error: "unauthorized" }, 401);
  c.set("principal", principal);
  return next();
};
