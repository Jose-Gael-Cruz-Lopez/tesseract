import { env } from "cloudflare:test";
import { createSession } from "../../src/auth/session";
import { hmacSeal } from "../../src/auth/crypto";

/**
 * Seal a session cookie for `login`, inserting a matching `users` row first
 * (INSERT OR IGNORE, so it's safe to call more than once per login within a test).
 * `avatarUrl` is optional and defaults to null — most callers don't need it.
 *
 * Shared helper (Fix #12): this was previously copy-pasted verbatim into ~13 test
 * files as `cookieFor` or `authedCookie`. Unified here on the `authedCookie` name.
 */
export async function authedCookie(login: string, avatarUrl?: string): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (github_login, name, avatar_url, created_at) VALUES (?, ?, ?, ?)`
  ).bind(login, login, avatarUrl ?? null, "2026-01-01T00:00:00Z").run();
  const { id } = await createSession(env.DB, login);
  return `session=${await hmacSeal(id, "test-cookie-secret")}`;
}
