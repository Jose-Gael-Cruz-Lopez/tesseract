import { type DB, all } from "../db";
import type { Env } from "../env";
import { getUserToken } from "../auth/user-token";
import { accessibleRepos, type AccessibleRepo } from "../auth/app";

// The hub-list source: the repos this user can reach on GitHub (the collaborator
// boundary) intersected with the repos connected to canopy. Injectable for tests.
export async function listAccessibleConnectedRepos(
  db: DB,
  env: Env,
  login: string,
  opts?: { getToken?: (login: string) => Promise<string | null>; listRepos?: (token: string) => Promise<AccessibleRepo[]> }
): Promise<Array<{ repo: string; can_push: boolean }>> {
  const getToken = opts?.getToken ?? ((l: string) => getUserToken(db, env, l));
  const token = await getToken(login);
  if (!token) return [];
  const listRepos = opts?.listRepos ?? ((t: string) => accessibleRepos(t));
  const reachable = await listRepos(token);
  const connected = new Set(
    (await all<{ repo: string }>(db, `SELECT repo FROM repos WHERE status = 'connected'`)).map((r) => r.repo)
  );
  return reachable.filter((r) => connected.has(r.repo)).map((r) => ({ repo: r.repo, can_push: r.can_push }));
}
