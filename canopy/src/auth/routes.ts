import { Hono } from "hono";
import type { AppEnv } from "./principal";
import { isAdmin } from "./principal";
import { readSessionCookie, deleteSession, clearSessionCookie } from "./session";
import { mintToken } from "./tokens";
import { first } from "../db";
import { startAppLogin, finishAppLogin } from "./app-login";
import { createD1RateLimiter, tooManyRequests, MCP_TOKEN_RATE } from "./rate-limit";

/**
 * A safe same-origin post-login return path. Must be a relative path (starts with
 * "/", not "//", and contains no scheme colon) so it can't be used as an
 * open-redirect. Anything else falls back to the admin UI. Used to send app-initiated
 * GitHub sign-ins back to "/" while admin sign-ins default to "/admin/".
 */
export function safeReturnPath(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes(":")) return "/admin/";
  return raw;
}

/**
 * The OAuth callback URL for this request. GitHub requires an https callback for public
 * hosts (http is only valid for localhost), so we force https for everything except local
 * dev. Without this, a request that reached the Worker over http (e.g. before an edge
 * http->https upgrade, or a bare-hostname browser navigation) would emit an http
 * redirect_uri that GitHub rejects with "redirect_uri is not associated with this application".
 * The same value is used for the authorize redirect and the token exchange, so they always match.
 */
export function callbackUrl(reqUrl: string): string {
  const u = new URL(reqUrl);
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const scheme = isLocal ? u.protocol.replace(/:$/, "") : "https";
  return `${scheme}://${u.host}/auth/callback`;
}

export const authApp = new Hono<AppEnv>();

// PUBLIC (Phase 3 flip, Task 10): sign-in via the GitHub App user-authorization flow —
// delegates to startAppLogin (src/auth/app-login.ts). Authorizes with THIS path's own
// callbackUrl (/auth/callback, defined above and registered on the App) rather than
// app-login's own default alias (/auth/app/callback, below): exchangeUserCode sends no
// redirect_uri at token-exchange time, so the authorize-time redirect_uri never has to
// match anything at exchange — it only has to be ONE of the App's registered callback
// URLs, and both /auth/callback and /auth/app/callback are registered. The old OAuth
// dance (PKCE, buildAuthorizeUrl/exchangeCode, GITHUB_CLIENT_ID) is retired from this path.
authApp.get("/login", (c) => startAppLogin(c, { callbackUrl }));

// PUBLIC (Phase 3 flip, Task 10): finish the App sign-in — delegates to finishAppLogin.
// No org gate: the old isAllowed/isActiveOrgMember check is retired from the login path,
// so any GitHub user who completes the exchange gets a session (isAdmin still gates admin
// actions elsewhere, e.g. the backfill route). finishAppLogin doesn't care which callback
// path invoked it (code/state/cookies only), so no parameterization is needed here.
authApp.get("/callback", (c) => finishAppLogin(c));

// PUBLIC: the same App user-authorization sign-in as /login + /callback above, kept as an
// alias under its own registered callback (/auth/app/callback) — useful for verifying the
// App flow independent of the primary path. See src/auth/app-login.ts.
authApp.get("/app/login", (c) => startAppLogin(c));
authApp.get("/app/callback", (c) => finishAppLogin(c));

// GATED (by sessionGate in src/routes.ts): return the principal's profile.
authApp.get("/me", async (c) => {
  const login = c.get("principal").login;
  const row = await first<{ name: string | null; avatar_url: string | null }>(c.env.DB, `SELECT name, avatar_url FROM users WHERE github_login = ?`, login);
  return c.json({ login, name: row?.name ?? null, avatar_url: row?.avatar_url ?? null, org: (c.env.AUTH_ORG ?? "").trim() || null, admin: isAdmin(c.env, login) });
});

// GATED (by sessionGate in src/routes.ts): revoke this session.
authApp.post("/logout", async (c) => {
  const id = await readSessionCookie(c, c.env.COOKIE_SECRET);
  if (id) await deleteSession(c.env.DB, id);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// GATED: mint a personal MCP bearer token; the raw token is shown ONCE. Minting is
// rate-limited per login (issue #21): tokens are long-lived credentials, so unbounded
// minting from one session is a real abuse surface now that login is open.
authApp.post("/mcp-token", async (c) => {
  const login = c.get("principal").login;
  const gate = await createD1RateLimiter(c.env.DB).hit(MCP_TOKEN_RATE, login);
  if (!gate.allowed) return tooManyRequests(c, gate);
  const { raw } = await mintToken(c.env.DB, login);
  return c.json({ token: raw });
});
