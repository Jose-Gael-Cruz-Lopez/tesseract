// Typed fetch layer over the real (cookie-gated) Worker routes — the ONLY place
// that knows route URLs and response shapes. Row types come from @shared/rows;
// the route RESPONSE envelopes + SearchResult + progress live in src/tools/* (not
// @shared, and web/ can't import src/), so they are re-declared here atop the
// @shared rows. All requests carry the session cookie (credentials:"same-origin");
// the MCP bearer is for /mcp only and never appears here.
import type {
  FeedRow, DocRow, DocVersionRow, MilestoneRow, AdrRow, NeedsTriageRow, MilestoneProposalRow, EventRow,
} from "@shared/rows";
import type { DashboardData } from "@shared/dashboard";

export class Unauthorized extends Error {
  constructor() { super("unauthorized"); }
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export class NotFound extends Error {}

// The active hub (owner/name) the read functions target. null → no hub (hub-list).
let activeRepo: string | null = null;
export function setActiveRepo(r: string | null): void { activeRepo = r; }
export function getActiveRepo(): string | null { return activeRepo; }
// Prefix a hub-scoped path with the active repo. There is NO flat fallback
// (issue #9 review): the flat mutation routes are removed server-side and the
// flat reads are admin-gated + defaultRepo-scoped, so falling back would just
// 404/403 — fail fast with a clear message instead. Every consumer below is
// async, so this throw surfaces as a rejected promise at the call site.
function scoped(path: string): string {
  if (!activeRepo) throw new ApiError(400, "Select a repo first");
  return `/r/${activeRepo}${path}`;
}

export interface Repo { repo: string; can_push: boolean; }
export interface MyRepos { repos: Repo[]; appSlug: string | null; }
export async function getMyRepos(): Promise<MyRepos> { return getJson<MyRepos>("/me/repos"); }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new ApiError(res.status, `${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) {
    let msg = String(res.status);
    try { const j = (await res.json()) as { error?: string }; if (j.error) msg = j.error; } catch { /* non-JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ── reads ────────────────────────────────────────────────────────────────────
export interface FeedQuery { author?: string; tags?: string[]; }
export async function getFeed(q: FeedQuery = {}): Promise<FeedRow[]> {
  const p = new URLSearchParams();
  if (q.author) p.set("author", q.author);
  if (q.tags && q.tags.length) p.set("tags", q.tags.join(","));
  const qs = p.toString();
  return getJson<{ feed: FeedRow[] }>(scoped(`/feed${qs ? `?${qs}` : ""}`)).then((r) => r.feed);
}

export async function listDocs(): Promise<DocRow[]> {
  return getJson<{ docs: DocRow[] }>(scoped("/docs")).then((r) => r.docs);
}

export async function getDoc(slug: string): Promise<{ doc: DocRow; versions: DocVersionRow[] }> {
  return getJson<{ doc: DocRow; versions: DocVersionRow[] }>(scoped(`/doc/${encodeURIComponent(slug)}`)).catch((e) => {
    if (e instanceof ApiError && e.status === 404) throw new NotFound(slug);
    throw e;
  });
}

// The read-side query envelope, re-declared here (web/ can't import the @shared
// contract's Zod module). Mirrors shared/contract.ts QueryResult exactly.
export type Authority = "live" | "staged_pending" | "unpromoted" | "draft";
export type QueryType = "doc" | "decision" | "feed" | "milestone";
export interface QueryPrimary {
  type: QueryType; id: string; title: string;
  section: string | null; space: string | null;
  body: string; authority: Authority;
  current_version: number | null; pending_version: number | null;
  staged_body: string | null; confidence: string | null;
  updated_at: string | null; updated_by: string | null; score: number;
}
export interface QueryPointer {
  type: QueryType; id: string; title: string; snippet: string; authority: Authority; score: number;
}
export interface QueryResult {
  primary: QueryPrimary[]; pointers: QueryPointer[]; meta: { engine: "fts5"; total: number };
}

// Human Search: the route forces include_staged:false, so results are live-only.
export async function search(q: string, opts: { types?: QueryType[]; section?: string; space?: string; limit?: number } = {}): Promise<QueryResult> {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (opts.types && opts.types.length) p.set("types", opts.types.join(","));
  if (opts.section) p.set("section", opts.section);
  if (opts.space) p.set("space", opts.space);
  if (opts.limit) p.set("limit", String(opts.limit));
  const qs = p.toString();
  return getJson<{ result: QueryResult }>(scoped(`/search${qs ? `?${qs}` : ""}`)).then((r) => r.result);
}

export type MilestoneWithProgress = MilestoneRow & { progress: { closed: number; total: number; computed_at: string } | null };

// The roadmap read is the ADMIN plan: an authored narrative + version metadata alongside
// the milestones (each merged with cached, event-derived progress — no live GitHub). Mirrors
// src/tools/plan.ts's PlanView exactly (web/ can't import src/, so it's re-declared here).
export interface PlanView {
  narrative: string;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  milestones: MilestoneWithProgress[];
}
export async function getRoadmap(): Promise<PlanView> {
  return getJson<PlanView>(scoped("/roadmap"));
}

export async function listNeedsTriage(): Promise<NeedsTriageRow[]> {
  return getJson<{ items: NeedsTriageRow[] }>(scoped("/needs-triage")).then((r) => r.items);
}
export async function listAdrs(status?: string): Promise<AdrRow[]> {
  return getJson<{ adrs: AdrRow[] }>(scoped(`/adrs${status ? `?status=${encodeURIComponent(status)}` : ""}`)).then((r) => r.adrs);
}
export async function listMilestoneProposals(): Promise<MilestoneProposalRow[]> {
  return getJson<{ proposals: MilestoneProposalRow[] }>(scoped("/milestone-proposals")).then((r) => r.proposals);
}

export interface Me { login: string; name: string | null; avatar_url: string | null; org: string; admin: boolean; }
export function getMe(): Promise<Me> {
  return getJson<Me>("/auth/me");
}

// ADMIN action: trigger the server-side GitHub backfill (admin-only route). The
// worker holds the service token and fetches GitHub directly — no webhook secret.
export function adminBackfill(): Promise<{
  ok: boolean;
  captured: number;
  unchanged: number;
  summarized: number;
  summaryBudgetExhausted: boolean;
  prSummarizedCount: number;
  issueSummarizedCount: number;
  prs: number;
  issues: number;
  issuesToSummarize: number;
}> {
  return postJson("/admin/backfill", {});
}

export async function getMyDashboard(): Promise<DashboardData> {
  return getJson<DashboardData>(scoped("/me/dashboard"));
}

// The Triage "Proposals" queue = staged doc versions newer than the live doc.
// Backed by the single server-joined GET /proposals route (Phase 3, G9) — no more
// N+1 over /docs + /doc/:slug. Each proposal carries both bodies (so the detail
// pane diffs staged vs promoted without extra fetches) plus the Phase 2 reconciler
// metadata (change_kind / low_confidence / base_version) Phase 4 renders by shape.
export interface StagedProposal {
  slug: string;
  version: number;
  title: string;
  section: string;
  space: string;
  summary: string | null;
  author: string;
  confidence: string | null;
  status: string;
  change_kind: "new" | "edit" | "rewrite" | null;
  low_confidence: number;
  base_version: number | null;
  current_version: number;
  created_at: string;
  stagedBody: string;
  promotedBody: string;
}
export async function listStagedProposals(): Promise<StagedProposal[]> {
  return getJson<{ proposals: StagedProposal[] }>(scoped("/proposals")).then((r) => r.proposals);
}

// Maintenance · Identity: pending unknown-login tasks, each with a small LIVE
// activity sample. Mirrors src/tools/reads.ts IdentityTaskWithSample exactly
// (web/ can't import src/, so it's re-declared here atop @shared/rows's
// IdentityTaskRow shape). Envelope: { tasks }.
export interface IdentitySample {
  semantic_key: string;
  event_type: EventRow["event_type"];
  ref_number: number;
  title: string | null;    // null when the event's raw snapshot is malformed
  occurred_at: string | null;
}
export interface IdentityTask {
  login: string;
  first_seen: string;
  status: "pending" | "resolved";
  resolved_at: string | null;
  resolved_by: string | null;
  sample: IdentitySample[];
}
export function listIdentityTasks(): Promise<IdentityTask[]> {
  return getJson<{ tasks: IdentityTask[] }>("/identity-tasks").then((r) => r.tasks);
}

// ── confirms (cookie-authed) ─────────────────────────────────────────────────
export async function promoteDoc(slug: string, version: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/doc/${encodeURIComponent(slug)}/promote`), { version });
}
export async function ratifyAdr(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/adr/${id}/ratify`));
}
export async function promoteMilestoneProposal(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/milestone-proposals/${id}/promote`));
}
export async function completeMilestone(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/milestones/${id}/complete`));
}

// ── triage write-back (Phase 3): reject / discard / assign-materialize ─────────
export async function rejectDoc(slug: string, version: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/doc/${encodeURIComponent(slug)}/reject`), { version });
}
export async function rejectAdr(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/adr/${id}/reject`));
}
export async function rejectMilestoneProposal(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/milestone-proposals/${id}/reject`));
}
export async function discardTriage(id: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/needs-triage/${id}/discard`));
}
export interface AssignTarget { type?: "doc" | "adr" | "milestone" | "feed"; section?: string; space?: "sapling" | "canopy"; tags?: string[]; }
export async function assignTriage(id: number, target: AssignTarget): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(scoped(`/needs-triage/${id}/assign`), target);
}

// Maintenance · Identity: map a login to a person — the `people` table's only
// runtime write. `person` is a free non-empty string; the picker posts a
// teammate's GitHub login as that value.
export function mapIdentity(login: string, person: string): Promise<{ ok: true; login: string; person: string; status: "resolved" }> {
  return postJson(`/identity-tasks/${encodeURIComponent(login)}/map`, { person });
}

export function logout(): Promise<{ ok: true }> {
  return postJson<{ ok: true }>("/auth/logout");
}
export function mintMcpToken(): Promise<{ token: string }> {
  return postJson<{ token: string }>("/auth/mcp-token");
}

// Re-export the row types the UI renders, so screens import shapes from one place.
export type { FeedRow, DocRow, DocVersionRow, MilestoneRow, AdrRow, NeedsTriageRow, MilestoneProposalRow };
export type { DashboardData };
