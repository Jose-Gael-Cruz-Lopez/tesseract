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
