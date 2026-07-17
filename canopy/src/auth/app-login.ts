import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./principal";
import { randomToken, hmacSeal, hmacUnseal } from "./crypto";
import { exchangeUserCode, type UserTokens } from "./app";
import { getUser } from "./github";
import { storeUserToken } from "./user-token";
import { createSession, setSessionCookie } from "./session";
import { safeReturnPath, callbackUrl } from "./routes";
import { run, nowIso } from "../db";
import {
  createD1RateLimiter, createD1FailureTracker, clientIp, loginAllowed, tooManyRequests,
  LOGIN_RATE, CALLBACK_RATE, SESSION_RATE, AUTH_FAILURE_LOCKOUT,
} from "./rate-limit";

const TX = "app_oauth_tx";
const RET = "app_oauth_return";

/** The GitHub App user-authorization URL. No scope: the App's permissions govern. */
export function buildAppAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

/** App user-auth callback path for this request (mirrors callbackUrl but /auth/app/callback). */
function appCallbackUrl(reqUrl: string): string {
  return callbackUrl(reqUrl).replace(/\/auth\/callback$/, "/auth/app/callback");
}

/**
 * Start the App user-authorization dance. `opts.callbackUrl` picks which registered
 * callback path the authorize redirect targets — default is `/auth/app/callback`
 * (this function's own alias path). `/auth/login` (Task 10 flip) passes routes.ts's
 * `callbackUrl` instead, so IT authorizes with `/auth/callback`. Token exchange
 * (exchangeUserCode) sends no redirect_uri, so the two paths never need to match each
 * other — each just has to be ONE of the App's registered callback URLs, and both are.
 */
export async function startAppLogin(c: Context<AppEnv>, opts?: { callbackUrl?: (reqUrl: string) => string; now?: () => number }): Promise<Response> {
  if (!c.env.GITHUB_APP_CLIENT_ID) return c.json({ error: "app_not_configured" }, 503);
  // Abuse control (issue #21): per-IP cap on sign-in starts. Each start sets cookies
  // and redirects to GitHub — cheap, but now that login is open to any GitHub user,
  // unbounded starts are a scripted-probe surface.
  const gate = await createD1RateLimiter(c.env.DB, { now: opts?.now }).hit(LOGIN_RATE, clientIp(c));
  if (!gate.allowed) return tooManyRequests(c, gate);
  const state = randomToken(16);
  const sealed = await hmacSeal(state, c.env.COOKIE_SECRET);
  setCookie(c, TX, sealed, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  setCookie(c, RET, safeReturnPath(c.req.query("return")), { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  const redirectUri = (opts?.callbackUrl ?? appCallbackUrl)(c.req.url);
  return c.redirect(buildAppAuthorizeUrl({ clientId: c.env.GITHUB_APP_CLIENT_ID, redirectUri, state }), 302);
}

// `getUserImpl` mirrors `fetchImpl`: getUser calls the global fetch (no seam of its
// own), which the Miniflare test pool can't stub, so route-level tests inject it to
// drive the post-identity path (allow-list, session cap). Production never passes it.
export async function finishAppLogin(
  c: Context<AppEnv>,
  opts?: { fetchImpl?: typeof fetch; getUserImpl?: typeof getUser; now?: () => number }
): Promise<Response> {
  // Abuse controls (issue #21) run before any cookie or exchange work: first the
  // lockout from repeated auth failures, then a per-IP cap on callback attempts.
  // A locked-out or rate-limited request is refused outright (429 + Retry-After)
  // and records nothing — the lockout escalates only on real auth failures.
  const limiter = createD1RateLimiter(c.env.DB, { now: opts?.now });
  const failures = createD1FailureTracker(c.env.DB, { now: opts?.now });
  const ip = clientIp(c);
  const locked = await failures.status(AUTH_FAILURE_LOCKOUT, ip);
  if (!locked.allowed) return tooManyRequests(c, locked);
  const gate = await limiter.hit(CALLBACK_RATE, ip);
  if (!gate.allowed) return tooManyRequests(c, gate);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const sealedTx = getCookie(c, TX);
  deleteCookie(c, TX, { path: "/" });
  const ret = safeReturnPath(getCookie(c, RET));
  deleteCookie(c, RET, { path: "/" });
  // Every failed auth outcome below counts toward the per-IP lockout — the response
  // shapes are unchanged, they just also feed the failure tracker.
  const fail = async (error: string, status: 400 | 401 | 403): Promise<Response> => {
    await failures.recordFailure(AUTH_FAILURE_LOCKOUT, ip);
    return c.json({ error }, status);
  };
  if (!code || !state || !sealedTx) return fail("invalid_request", 400);
  const txState = await hmacUnseal(sealedTx, c.env.COOKIE_SECRET);
  if (txState !== state) return fail("state_mismatch", 403);

  // exchangeUserCode THROWS on a bad/expired/already-consumed code — which happens on the
  // normal web (the user refreshes the callback page, back-buttons into it, or GitHub
  // replays), not just on abuse. Since /auth/callback (the primary login callback) now
  // routes here, an unwrapped throw would surface as a Hono 500 on the busiest auth path.
  // getUser can likewise throw on a network fault. Fail closed with a clean 401 (matching
  // the retired OAuth handler's exchange_failed shape) and — critically — no session.
  let tokens: UserTokens;
  let ghUser: Awaited<ReturnType<typeof getUser>>;
  try {
    tokens = await exchangeUserCode(c.env, code, { fetchImpl: opts?.fetchImpl }); // user-to-server token (+ refresh)
    ghUser = await (opts?.getUserImpl ?? getUser)(tokens.token);
  } catch {
    return fail("exchange_failed", 401);
  }
  if (!ghUser) return fail("identity_failed", 401);

  // Soft-rollout allow-list (issue #21): a non-empty LOGIN_ALLOWLIST restricts who may
  // sign in; empty/absent keeps signup open. Checked before anything is provisioned
  // for the user. NOT an auth failure — this is an identified user, not a probe.
  if (!loginAllowed(c.env, ghUser.login)) return c.json({ error: "login_not_allowed" }, 403);

  // Session-creation cap (issue #21), keyed by the GitHub account: even a client
  // rotating IPs can't mint unbounded sessions for one login.
  const sessions = await limiter.hit(SESSION_RATE, ghUser.login.toLowerCase());
  if (!sessions.allowed) return tooManyRequests(c, sessions);

  await failures.clear(AUTH_FAILURE_LOCKOUT, ip); // a successful sign-in resets the lockout counter

  await storeUserToken(c.env.DB, ghUser.login, tokens);      // so repoGate can read their access
  await run(c.env.DB,
    `INSERT INTO users (github_login, name, avatar_url, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(github_login) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url`,
    ghUser.login, ghUser.name, ghUser.avatar_url, nowIso());
  const { id } = await createSession(c.env.DB, ghUser.login);
  await setSessionCookie(c, id, c.env.COOKIE_SECRET);        // NO org gate — any GitHub user
  return c.redirect(ret, 302);
}
