import { type Context, type MiddlewareHandler } from "hono";
import type { DB } from "../db";
import type { Env } from "../env";
import { authorizeRepo } from "./access";
import { accessibleRepos, type AccessibleRepo } from "./app";
import type { AppEnv } from "./principal";

// The per-repo hub gate (Phase 3): authorize the signed-in principal for one repo's hub,
// then stash the repo (+ push flag) on the context for the handlers mounted behind it.
// Fully dependency-injected — `getUserToken` (the caller's user-token store), `authorize`
// (the connected + collaborator check), and `listRepos` (the GitHub-native access set that
// check refreshes from) are all swappable — so the gate is testable without the user-token
// plumbing. Mount under a `/:owner/:repo/*` pattern; the repo is `owner/name`. Denials
// never leak existence: an unconnected repo, or one the user can't reach, is the same 404.

export interface RepoAuthDeps {
  db: DB;
  login: string;
  repo: string;
  getUserToken: (login: string) => Promise<string | null>;
  authorize?: typeof authorizeRepo;
  listRepos?: (token: string) => Promise<AccessibleRepo[]>;
}

export type RepoAuthResult = { allowed: true; canPush: boolean } | { allowed: false; status: 401 | 404; error: string };

/**
 * The core repoGate check (connected + collaborator), factored out of the Hono
 * middleware below so it's reusable by non-Hono entry points too (the bearer
 * /mcp/:owner/:repo route in index.ts). No stored user token ⇒ 401 "reauthorize"
 * (we can't read their GitHub access — ask them to reconnect); connected-but-not-a-
 * collaborator (or simply unconnected) ⇒ 404, the SAME shape either way so a denial
 * never leaks whether the repo exists.
 */
export async function authorizeRepoAccess(deps: RepoAuthDeps): Promise<RepoAuthResult> {
  const authorize = deps.authorize ?? authorizeRepo;
  const listRepos = deps.listRepos ?? ((t: string) => accessibleRepos(t));

  const token = await deps.getUserToken(deps.login);
  if (!token) return { allowed: false, status: 401, error: "reauthorize" };

  const { allowed, canPush } = await authorize(deps.db, deps.login, deps.repo, () => listRepos(token));
  if (!allowed) return { allowed: false, status: 404, error: "not found" }; // don't leak existence

  return { allowed: true, canPush };
}

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
  return async (c, next) => {
    const login = c.get("principal")?.login;
    if (!login) return c.json({ error: "unauthorized" }, 401);

    const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const result = await authorizeRepoAccess({ ...deps, login, repo });
    if (!result.allowed) return c.json({ error: result.error }, result.status);

    c.set("repo", repo);
    c.set("canPush", result.canPush);
    await next();
  };
}

/**
 * The repo the gate authorized for this request, for handlers mounted behind it.
 * Honest about `AppEnv.Variables.repo` being optional at the type level — every
 * hub.ts handler is mounted behind the gate above, which always sets it before
 * `next()`, but callers outside that guarantee must not treat this as non-nullable
 * without checking.
 */
export function repoOf(c: Context<AppEnv>): string | undefined {
  return c.get("repo");
}
