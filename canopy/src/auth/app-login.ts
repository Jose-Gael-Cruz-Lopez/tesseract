import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./principal";
import { randomToken, hmacSeal, hmacUnseal } from "./crypto";
import { exchangeUserCode } from "./app";
import { getUser } from "./github";
import { storeUserToken } from "./user-token";
import { createSession, setSessionCookie } from "./session";
import { safeReturnPath, callbackUrl } from "./routes";
import { run, nowIso } from "../db";

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

export async function startAppLogin(c: Context<AppEnv>): Promise<Response> {
  if (!c.env.GITHUB_APP_CLIENT_ID) return c.json({ error: "app_not_configured" }, 503);
  const state = randomToken(16);
  const sealed = await hmacSeal(state, c.env.COOKIE_SECRET);
  setCookie(c, TX, sealed, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  setCookie(c, RET, safeReturnPath(c.req.query("return")), { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  return c.redirect(buildAppAuthorizeUrl({ clientId: c.env.GITHUB_APP_CLIENT_ID, redirectUri: appCallbackUrl(c.req.url), state }), 302);
}

export async function finishAppLogin(c: Context<AppEnv>): Promise<Response> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const sealedTx = getCookie(c, TX);
  deleteCookie(c, TX, { path: "/" });
  const ret = safeReturnPath(getCookie(c, RET));
  deleteCookie(c, RET, { path: "/" });
  if (!code || !state || !sealedTx) return c.json({ error: "invalid_request" }, 400);
  const txState = await hmacUnseal(sealedTx, c.env.COOKIE_SECRET);
  if (txState !== state) return c.json({ error: "state_mismatch" }, 403);

  const tokens = await exchangeUserCode(c.env, code);       // user-to-server token (+ refresh)
  const ghUser = await getUser(tokens.token);
  if (!ghUser) return c.json({ error: "identity_failed" }, 401);

  await storeUserToken(c.env.DB, ghUser.login, tokens);      // so repoGate can read their access
  await run(c.env.DB,
    `INSERT INTO users (github_login, name, avatar_url, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(github_login) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url`,
    ghUser.login, ghUser.name, ghUser.avatar_url, nowIso());
  const { id } = await createSession(c.env.DB, ghUser.login);
  await setSessionCookie(c, id, c.env.COOKIE_SECRET);        // NO org gate — any GitHub user
  return c.redirect(ret, 302);
}
