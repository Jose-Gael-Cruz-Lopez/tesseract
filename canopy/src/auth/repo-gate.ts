import { type Context, type MiddlewareHandler } from "hono";
import type { DB } from "../db";
import type { Env } from "../env";
import { authorizeRepo } from "./access";
import { accessibleRepos, type AccessibleRepo } from "./app";

// The per-repo hub gate (Phase 3): authorize the signed-in principal for one repo's hub,
// then stash the repo (+ push flag) on the context for the handlers mounted behind it.
// Fully dependency-injected — `getUserToken` (the caller's user-token store), `authorize`
// (the connected + collaborator check), and `listRepos` (the GitHub-native access set that
// check refreshes from) are all swappable — so the gate is testable without the user-token
// plumbing. Mount under a `/:owner/:repo/*` pattern; the repo is `owner/name`. Denials
// never leak existence: an unconnected repo, or one the user can't reach, is the same 404.

/**
 * Build the repoGate middleware. `db` / `env` / `getUserToken` are the live wiring;
 * `authorize` (defaults to authorizeRepo) and `listRepos` (defaults to accessibleRepos)
 * are overridable for tests. On success it sets `repo` and `canPush` on the context and
 * calls `next()`; otherwise it short-circuits with a JSON error (401/404).
 */
export function makeRepoGate(deps: {
  db: DB;
  env: Env;
  getUserToken: (login: string) => Promise<string | null>;
  authorize?: typeof authorizeRepo;
  listRepos?: (token: string) => Promise<AccessibleRepo[]>;
}): MiddlewareHandler {
  const authorize = deps.authorize ?? authorizeRepo;
  const listRepos = deps.listRepos ?? ((t: string) => accessibleRepos(t));
  return async (c, next) => {
    const login = c.get("principal")?.login;
    if (!login) return c.json({ error: "unauthorized" }, 401);

    const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;

    // No stored user token ⇒ we can't read their GitHub access — ask them to reconnect.
    const token = await deps.getUserToken(login);
    if (!token) return c.json({ error: "reauthorize" }, 401);

    const { allowed, canPush } = await authorize(deps.db, login, repo, () => listRepos(token));
    if (!allowed) return c.json({ error: "not found" }, 404); // don't leak existence

    c.set("repo", repo);
    c.set("canPush", canPush);
    await next();
  };
}

/** The repo the gate authorized for this request, for handlers mounted behind it. */
export function repoOf(c: Context): string {
  return c.get("repo");
}
