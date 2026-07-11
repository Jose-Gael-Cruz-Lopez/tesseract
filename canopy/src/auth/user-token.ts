import { type DB, first, run, nowIso } from "../db";
import type { Env } from "../env";
import { refreshUserToken, type UserTokens } from "./app";
import type { UserTokenRow } from "@shared/rows";

// User-token storage (Phase 3): persists the user-to-server token (+ refresh + expiry)
// per login, so repoGate can refresh a user's access set without a fresh sign-in. The
// stored token is refreshed in place when it's within 60s of expiry (or already past it).

// Refresh margin: a token within this window of expiry is treated as expired and
// swapped for a fresh one before use.
const NEAR_EXPIRY_MS = 60_000;

/** Upsert a user's token set, storing `expires_at` as an ISO string (NULL if non-expiring). */
export async function storeUserToken(db: DB, login: string, tokens: UserTokens, now = nowIso()): Promise<void> {
  const expiresAt = tokens.expiresAt !== null ? new Date(tokens.expiresAt * 1000).toISOString() : null;
  await run(
    db,
    `INSERT INTO user_tokens (login, token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(login) DO UPDATE SET
       token = excluded.token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    login,
    tokens.token,
    tokens.refreshToken,
    expiresAt,
    now
  );
}

/**
 * The current user-to-server token for `login`, or null if none is stored. When the
 * stored token is at/near expiry and a refresh token is on hand, it's refreshed via the
 * App OAuth flow, persisted, and the fresh token returned; a failed refresh yields null.
 */
export async function getUserToken(
  db: DB,
  env: Env,
  login: string,
  opts?: { fetchImpl?: typeof fetch; now?: string }
): Promise<string | null> {
  const now = opts?.now ?? nowIso();
  const row = await first<UserTokenRow>(db, `SELECT * FROM user_tokens WHERE login = ?`, login);
  if (!row) return null;

  const nearExpiry = row.expires_at != null && Date.parse(row.expires_at) - Date.parse(now) < NEAR_EXPIRY_MS;
  if (nearExpiry && row.refresh_token) {
    try {
      const fresh = await refreshUserToken(env, row.refresh_token, { fetchImpl: opts?.fetchImpl });
      await storeUserToken(db, login, fresh);
      return fresh.token;
    } catch {
      return null;
    }
  }
  return row.token;
}
