import { type DB, first } from "../db";

// Repo-ownership lookups for hub mutations on id/slug-keyed rows. Each returns the
// row's `repo`, or null if the row doesn't exist — the hub uses null/mismatch to 404
// a cross-repo id so a mutation can never cross the tenant boundary.

export async function docRepo(db: DB, slug: string): Promise<string | null> {
  const r = await first<{ repo: string }>(db, `SELECT repo FROM docs WHERE slug = ?`, slug);
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
