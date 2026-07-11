import type { Env } from "../env";

// GitHub App client (Phase 3): the server-to-server side — sign a short-lived App JWT
// with the App's private key, and mint/cache per-installation access tokens. These
// tokens scope canopy's own GitHub reads (progress recompute, PR/issue summaries) to
// one installation's repos, replacing the single GITHUB_SERVICE_TOKEN.
//
// GITHUB_APP_PRIVATE_KEY must be a PKCS#8 PEM. GitHub downloads keys as PKCS#1
// (`BEGIN RSA PRIVATE KEY`); Web Crypto imports only PKCS#8, so convert once:
//   openssl pkcs8 -topk8 -nocrypt -in app.private-key.pem -out app.pkcs8.pem

const b64url = (bytes: ArrayBuffer): string => {
  const b = new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (str: string): string => b64url(new TextEncoder().encode(str).buffer as ArrayBuffer);

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * A GitHub App JWT (RS256), valid ~9 minutes. `iat` is backdated 60s for clock skew.
 * Used as the Bearer for App-level endpoints (e.g. minting installation tokens).
 * Throws if the App isn't configured.
 */
export async function appJwt(env: Env, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
  }
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: env.GITHUB_APP_ID }));
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

// Per-isolate installation-token cache. GitHub installation tokens last ~1h; a cold
// isolate simply re-mints. Reused until 60s before expiry.
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

/** Test-only: drop the token cache so cases don't leak across each other. */
export function _clearInstallationTokenCache(): void {
  tokenCache.clear();
}

/**
 * A GitHub installation access token for `installationId`, minted via the App JWT and
 * cached in-isolate until near expiry. `fetchImpl` is injectable for tests.
 */
export async function installationToken(
  env: Env,
  installationId: number,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<string> {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 60 > nowSec) return cached.token;

  const doFetch = opts?.fetchImpl ?? fetch;
  const jwt = await appJwt(env, nowSec);
  const res = await doFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "user-agent": "canopy",
    },
  });
  if (!res.ok) throw new Error(`installation token mint failed for ${installationId}: ${res.status}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = Math.floor(new Date(body.expires_at).getTime() / 1000);
  tokenCache.set(installationId, { token: body.token, expiresAt });
  return body.token;
}

// ── User-to-server side (sign-in + the collaborator boundary) ──────────────────
// The App's user-authorization flow yields a user token scoped to the App's
// permissions ∩ the user's own access. We use it to identify the user and to read,
// GitHub-native, exactly which connected repos they can reach (and whether with push).

export interface UserTokens {
  token: string;
  refreshToken: string | null;
  expiresAt: number | null; // epoch seconds; null if the App doesn't expire user tokens
}

export interface AccessibleRepo {
  repo: string; // "owner/name"
  can_push: boolean; // push ⇒ admin (plan/promote)
}

async function oauthToken(
  env: Env,
  form: Record<string, string>,
  nowSec: number,
  doFetch: typeof fetch
): Promise<UserTokens> {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    throw new Error("GitHub App OAuth not configured (GITHUB_APP_CLIENT_ID / _CLIENT_SECRET)");
  }
  const res = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "canopy" },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, ...form }),
  });
  if (!res.ok) throw new Error(`user token request failed: ${res.status}`);
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!body.access_token) throw new Error(`user token error: ${body.error ?? "no token"}`);
  return {
    token: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? nowSec + body.expires_in : null,
  };
}

/** Exchange an OAuth callback `code` for a user-to-server token (+ refresh token). */
export async function exchangeUserCode(
  env: Env,
  code: string,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<UserTokens> {
  return oauthToken(env, { code }, opts?.nowSec ?? Math.floor(Date.now() / 1000), opts?.fetchImpl ?? fetch);
}

/** Refresh an expiring user token via its refresh token. */
export async function refreshUserToken(
  env: Env,
  refreshToken: string,
  opts?: { fetchImpl?: typeof fetch; nowSec?: number }
): Promise<UserTokens> {
  return oauthToken(
    env,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    opts?.nowSec ?? Math.floor(Date.now() / 1000),
    opts?.fetchImpl ?? fetch
  );
}

// Paginated GET over a GitHub list endpoint (per_page=100), collecting `key`.
async function ghGetAll<T>(doFetch: typeof fetch, path: string, token: string, key: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`;
    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "canopy" },
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const items = (body[key] as T[]) ?? [];
    out.push(...items);
    if (items.length < 100) return out;
  }
}

/** The App installations this user can see (the accounts they've installed it on). */
export async function listUserInstallations(
  userToken: string,
  opts?: { fetchImpl?: typeof fetch }
): Promise<Array<{ id: number; account_login: string; account_type: string }>> {
  const raw = await ghGetAll<{ id: number; account: { login: string; type: string } }>(
    opts?.fetchImpl ?? fetch,
    "/user/installations",
    userToken,
    "installations"
  );
  return raw.map((i) => ({ id: i.id, account_login: i.account.login, account_type: i.account.type }));
}

/** The repos this user can access within one installation (+ push flag). */
export async function listUserInstallationRepos(
  userToken: string,
  installationId: number,
  opts?: { fetchImpl?: typeof fetch }
): Promise<AccessibleRepo[]> {
  const raw = await ghGetAll<{ full_name: string; permissions?: { push?: boolean } }>(
    opts?.fetchImpl ?? fetch,
    `/user/installations/${installationId}/repositories`,
    userToken,
    "repositories"
  );
  return raw.map((r) => ({ repo: r.full_name, can_push: r.permissions?.push ?? false }));
}

/**
 * Every repo this user can reach across all their installations — the authoritative
 * collaborator boundary `repoGate` and the hub-list check against.
 */
export async function accessibleRepos(userToken: string, opts?: { fetchImpl?: typeof fetch }): Promise<AccessibleRepo[]> {
  const installs = await listUserInstallations(userToken, opts);
  const all: AccessibleRepo[] = [];
  for (const inst of installs) all.push(...(await listUserInstallationRepos(userToken, inst.id, opts)));
  return all;
}
