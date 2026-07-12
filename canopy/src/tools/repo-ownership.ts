import { type DB, first } from "../db";

// Repo-ownership lookups for hub mutations on id/slug-keyed rows. Each returns the
// row's `repo`, or null if the row doesn't exist — the hub uses null/mismatch to 404
// a cross-repo id so a mutation can never cross the tenant boundary.

export async function docRepo(db: DB, slug: string, repo: string): Promise<string | null> {
  // Scoped by (repo, slug): docs.slug is per-repo since 0022, so the SAME slug can
  // exist in two repos. An unscoped WHERE slug=? would resolve to an arbitrary repo's
  // row — here it returns the gated repo's own doc (its `repo`, trivially === repo when
  // found), or null when the gated repo has no such slug → the hub 404s.
  const r = await first<{ repo: string }>(db, `SELECT repo FROM docs WHERE repo = ? AND slug = ?`, repo, slug);
  return r?.repo ?? null;
}
export async function adrRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM adrs WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function milestoneProposalRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM milestone_proposals WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function milestoneRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM milestones WHERE id = ?`, id);
  return r?.repo ?? null;
}
export async function triageRepo(db: DB, id: number): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM needs_triage WHERE id = ?`, id);
  return r?.repo ?? null;
}
