// Reads the canopy GitHub session same-origin (the fused deploy) via GET /auth/me
// with the httpOnly session cookie. A 200 means an ALLOWED developer is signed in —
// canopy only mints a session for allow-listed / org members — so its presence
// doubles as the "developer unlocked" signal. Never throws: offline / 401 → null.

export async function getCanopySession(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/auth/me', { method: 'GET', credentials: 'include' });
    if (!res || !res.ok) return null;
    const me = await res.json();
    if (!me || !me.login) return null;
    // /auth/me shape: { login, name, avatar_url, org, admin }
    return { login: me.login, name: me.name ?? null, avatar: me.avatar_url ?? null };
  } catch {
    return null;
  }
}

// Build a knowledge session from a GitHub identity, so a GitHub sign-in also grants
// the Knowledge side (onboarded, no email flow). GitHub logins have no email here,
// so a stable noreply address stands in as the session key.
export function sessionFromGitHub(me) {
  return {
    email: `${me.login}@users.noreply.github.com`,
    name: me.name || me.login,
    avatar: me.avatar ?? null,
    onboarded: true,
    provider: 'github',
  };
}
