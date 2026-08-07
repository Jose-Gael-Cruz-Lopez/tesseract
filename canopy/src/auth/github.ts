import type { Env as _Env } from "../env";

const USER_AGENT = "canopy";
const GH_API = "application/vnd.github+json";

// The pre-App OAuth dance (buildAuthorizeUrl / exchangeCode, PKCE, the
// GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET pair) was retired by the Phase B flip:
// sign-in is the GitHub App user-authorization flow (src/auth/app-login.ts).
// Those helpers were deleted with the audit truth pass — getUser below is the
// one survivor with a production consumer (app-login resolves the signed-in
// user's profile with it).

/** The authenticated user's login + name + avatar_url; null on failure. */
export async function getUser(token: string): Promise<{ login: string; name: string | null; avatar_url: string | null } | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: GH_API, "user-agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { login?: string; name?: string | null; avatar_url?: string | null };
  return data.login ? { login: data.login, name: data.name ?? null, avatar_url: data.avatar_url ?? null } : null;
}
