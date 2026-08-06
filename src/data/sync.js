// Cloud sync for the Knowledge workspace. Local-first: localStorage stays the
// working copy and the app never blocks on the network after boot — this
// module mirrors the whole workspace (the exportWorkspace() snapshot, minus
// its envelope) to one Supabase row per user, so a signed-in (Google) user's
// pages survive a cleared browser profile and follow them across devices.
//
// v1 semantics, deliberately simple and documented:
//  - The unit of sync is the WHOLE workspace blob. Last write wins; there is
//    no merge. Concurrent edits on two devices resolve to whichever pushed
//    last (timestamps compare remote `updated_at` against local page/workspace
//    `edited` — client clocks, so skew is tolerated, not solved).
//  - PULL-FIRST: the boot reconcile decides pull vs push BEFORE any push
//    subscription exists, so a freshly-seeded browser can never race its
//    starter seed over real remote data.
//  - OFFLINE-SAFE: if the initial pull fails, nothing is ever pushed this
//    session. A blind push without knowing the remote state could overwrite a
//    healthy remote with a stale local tree — worse than no sync at all.
//  - Failures after that are contained: a failed push is dropped and the next
//    edit retries (every push carries the whole current tree, so nothing is
//    lost to a dropped intermediate).
//
// Wired in src/main.js for the Supabase (Google) session branch only — the
// mock and canopy-GitHub sessions have no cloud identity to key the row on.

import {
  initStore, getWorkspace, getPages, exportWorkspace, importWorkspace, onStore, offStore,
  getPrefs, setPref, clearWorkspaceContent,
} from './store.js';

// Which account the LOCAL tree belongs to. Sign-out does not clear ms:pages,
// so a second Google account on the same browser boots over the first one's
// tree — without this stamp, last-write-wins would push user A's pages into
// user B's cloud row. Lives in prefs (device-local, excluded from exports).
const OWNER_PREF = 'sync.owner';

/** Newest local edit: pages' `edited` plus the workspace's own edit stamp. */
function latestLocalEdit() {
  const ws = getWorkspace();
  let latest = ws?.edited || 0;
  for (const p of getPages()) if (p.edited > latest) latest = p.edited;
  return latest;
}

function snapshot() {
  // The sync payload is the export snapshot minus its file envelope — same
  // shape importWorkspace validates, so pull can reuse it wholesale.
  const { exportedAt: _drop, ...rest } = exportWorkspace();
  return rest;
}

/**
 * Reconcile once, then mirror edits up. `fetchRow`/`upsertRow` default to the
 * Supabase-backed pair in supabase.js and are injectable for tests.
 * Returns { status, stop }:
 *   'disabled' — no Supabase client/session to sync against
 *   'imported' — remote won the reconcile and now IS the local workspace
 *   'pushed'   — local won (or remote was absent/corrupt) and was pushed
 *   'synced'   — nothing on either side to move
 *   'offline'  — the pull failed; sync is inert this session
 */
export async function startWorkspaceSync(deps = {}) {
  let fetchRow = deps.fetchRow;
  let upsertRow = deps.upsertRow;
  // Without an identity the owner guard is inert (no stamp, no foreign check) —
  // fine for injected test doubles; the real path always resolves one.
  let getUserId = deps.getUserId ?? (async () => null);
  if (!fetchRow || !upsertRow) {
    const supa = await import('./supabase.js');
    const session = supa.supabaseEnabled ? await supa.getSupabaseSession() : null;
    if (!session) return { status: 'disabled', stop() {} };
    fetchRow = fetchRow || supa.fetchWorkspaceRow;
    upsertRow = upsertRow || supa.upsertWorkspaceRow;
    if (!deps.getUserId) getUserId = async () => session.user?.id ?? null;
  }
  const debounceMs = deps.debounceMs ?? 2000;

  initStore(); // ensure the local tree is loaded before comparing against remote

  let row;
  let userId;
  try {
    [row, userId] = await Promise.all([fetchRow(), getUserId()]);
  } catch {
    return { status: 'offline', stop() {} };
  }

  // Owner guard: a local tree stamped for a DIFFERENT account must never win a
  // comparison or be pushed — it belongs to (and is synced under) its owner.
  const owner = getPrefs()[OWNER_PREF];
  const localForeign = !!(owner && userId && owner !== userId);
  if (localForeign) clearWorkspaceContent();

  const push = async () => {
    try {
      await upsertRow(snapshot());
      return true;
    } catch {
      return false; // contained — the next edit retries with the full tree
    }
  };

  let status = 'synced';
  if (row && row.data) {
    let remoteValid = true;
    const remoteTime = Date.parse(row.updated_at) || 0;
    if (!getWorkspace() || remoteTime >= latestLocalEdit()) {
      try {
        importWorkspace({ ...row.data, exportedAt: row.updated_at });
        status = 'imported';
      } catch {
        remoteValid = false; // corrupt remote must not nuke local
      }
    } else {
      await push();
      status = 'pushed';
    }
    if (!remoteValid) {
      await push();
      status = 'pushed';
    }
  } else if (getWorkspace()) {
    await push();
    status = 'pushed';
  }
  if (userId) setPref(OWNER_PREF, userId);

  // Only now — after the reconcile — do edits start mirroring up.
  let timer = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void push(); }, debounceMs);
  };
  onStore('pages', onChange);
  onStore('workspace', onChange);

  return {
    status,
    stop() {
      offStore('pages', onChange);
      offStore('workspace', onChange);
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
