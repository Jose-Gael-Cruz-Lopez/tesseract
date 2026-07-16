import type { MilestoneRow, PlanRow } from "@shared/rows";
import { type DB, first, all, run, nowIso } from "../db";
import { getProgress } from "./progress";

export interface PlanMilestoneInput {
  id?: number; // present = update that milestone; absent = create
  title: string;
  description?: string | null;
  phase?: string | null;
  target_date: string;
  status: "upcoming" | "in_progress" | "done"; // 'done' allowed HERE ONLY (admin-authored)
  github_ref?: number | number[] | null;
}

export interface PlanWrite {
  narrative: string;
  milestones: PlanMilestoneInput[];
}

export interface PlanView {
  narrative: string;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  milestones: (MilestoneRow & { progress: { closed: number; total: number; computed_at: string } | null })[];
}

const githubRefJson = (ref: number | number[] | null | undefined): string | null =>
  ref === undefined || ref === null ? null : JSON.stringify(ref);

/**
 * ADMIN direct write (promote-class, like promote_doc — NOT the ingestion gate):
 * replace the plan narrative and create/update milestones (including status
 * 'done', which is admin-authored and therefore legal ONLY here) in one
 * non-destructively versioned write. Milestones not mentioned are left
 * untouched — never implicitly deleted. `INSERT OR IGNORE` guards the
 * per-repo row for prod resilience (the test harness never deletes it, but a
 * fresh/drifted D1 might be missing it). The plan is per-repo (0023): `repo`
 * defaults to '' (single-repo-safe; the entry point passes defaultRepo(env)).
 */
export async function write_plan(
  db: DB,
  input: PlanWrite,
  author: string,
  repo = ""
): Promise<{ version: number; milestones: MilestoneRow[] }> {
  await run(db, `INSERT OR IGNORE INTO plan (repo, narrative, current_version) VALUES (?, '', 0)`, repo);

  const plan = await first<PlanRow>(db, `SELECT * FROM plan WHERE repo = ?`, repo);
  const version = (plan?.current_version ?? 0) + 1;
  const now = nowIso();

  for (const m of input.milestones) {
    const github_ref = githubRefJson(m.github_ref);
    if (m.id !== undefined) {
      // `AND repo = ?` scopes the id-keyed update to the caller's own repo — the
      // same tenant boundary the hub enforces via milestoneRepo() on
      // /milestones/:id/complete. A cross-repo id matches 0 rows and falls into
      // the SAME `no such milestone` error as a nonexistent id, so the response
      // never doubles as a cross-tenant milestone-id existence oracle.
      const res = await run(
        db,
        `UPDATE milestones SET title = ?, description = ?, phase = ?, target_date = ?, status = ?, github_ref = ?, updated_at = ?
         WHERE id = ? AND repo = ?`,
        m.title,
        m.description ?? null,
        m.phase ?? null,
        m.target_date,
        m.status,
        github_ref,
        now,
        m.id,
        repo
      );
      if ((res.meta.changes ?? 0) === 0) throw new Error(`no such milestone: ${m.id}`);
    } else {
      await run(
        db,
        `INSERT INTO milestones (repo, title, description, phase, target_date, status, github_ref, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        repo,
        m.title,
        m.description ?? null,
        m.phase ?? null,
        m.target_date,
        m.status,
        github_ref,
        now,
        author,
        now
      );
    }
  }

  const milestones = await all<MilestoneRow>(
    db,
    `SELECT * FROM milestones WHERE repo = ? ORDER BY target_date ASC, id ASC`,
    repo
  );

  await run(
    db,
    `UPDATE plan SET narrative = ?, current_version = ?, updated_at = ?, updated_by = ? WHERE repo = ?`,
    input.narrative,
    version,
    now,
    author,
    repo
  );
  await run(
    db,
    `INSERT INTO plan_versions (repo, version, narrative, milestones_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    repo,
    version,
    input.narrative,
    JSON.stringify(milestones),
    now,
    author
  );

  return { version, milestones };
}

/**
 * Read the admin plan for `repo`: narrative + version metadata, plus every
 * milestone (target_date ASC, id ASC — same order as the roadmap) merged with
 * the progress cache. NO GitHub, NO token — read-only against D1. Returns a
 * default empty view if the plan row is missing. `repo` defaults to ''
 * (single-repo-safe; the entry point passes defaultRepo(env)).
 */
export async function get_plan(db: DB, repo = ""): Promise<PlanView> {
  const plan = await first<PlanRow>(db, `SELECT * FROM plan WHERE repo = ?`, repo);
  const milestones = await all<MilestoneRow>(
    db,
    `SELECT * FROM milestones WHERE repo = ? ORDER BY target_date ASC, id ASC`,
    repo
  );
  const progress = await getProgress(db);

  return {
    narrative: plan?.narrative ?? "",
    version: plan?.current_version ?? 0,
    updated_at: plan?.updated_at ?? null,
    updated_by: plan?.updated_by ?? null,
    milestones: milestones.map((m) => {
      const p = progress.get(m.id);
      return { ...m, progress: p ? { closed: p.closed, total: p.total, computed_at: p.computed_at } : null };
    }),
  };
}
