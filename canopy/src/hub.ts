import { Hono } from "hono";
import type { AppEnv } from "./auth/principal";
import { makeRepoGate, repoOf } from "./auth/repo-gate";
import { getUserToken } from "./auth/user-token";
import { get_plan } from "./tools/plan";

// Multi-tenant hub router (Phase 3): mounted at /r/:owner/:repo, gated by repoGate on
// every route. Handlers read the authorized repo via repoOf(c) rather than defaultRepo(env).

// Test seam: when set, these override the live wiring the gate builds from c.env.
// Production leaves them undefined → the gate uses getUserToken + the real
// authorizeRepo/accessibleRepos. Tests set them to avoid real GitHub + token storage.
export const _hubTestHooks: {
  getUserToken?: (login: string) => Promise<string | null>;
  listRepos?: import("./auth/app").AccessibleRepo[] | ((token: string) => Promise<import("./auth/app").AccessibleRepo[]>);
} = {};

export function _resetHubTestHooks(): void {
  _hubTestHooks.getUserToken = undefined;
  _hubTestHooks.listRepos = undefined;
}

const hubApp = new Hono<AppEnv>();

// Build repoGate per-request (Workers env is per-request). Test hooks override the
// live token store + access set; production uses the real getUserToken + accessibleRepos.
hubApp.use("*", async (c, next) => {
  const listRepos = _hubTestHooks.listRepos;
  const gate = makeRepoGate({
    db: c.env.DB,
    env: c.env,
    getUserToken: _hubTestHooks.getUserToken ?? ((login: string) => getUserToken(c.env.DB, c.env, login)),
    ...(listRepos
      ? { listRepos: typeof listRepos === "function" ? listRepos : async () => listRepos }
      : {}),
  });
  return gate(c, next);
});

// Roadmap read, scoped to the gated repo.
hubApp.get("/roadmap", async (c) => c.json(await get_plan(c.env.DB, repoOf(c))));

export default hubApp;
