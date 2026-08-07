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
//  - PULL-FIRST, RACE-PROOF: the reconcile decides pull vs push from the local
//    state captured BEFORE the pull began. Boot races the pull against a 5s
//    timer and may seed a starter workspace while the fetch is in flight — a
//    seed (or any edit) landing mid-pull must never flip the decision, or the
//    seed overwrites the user's real cloud workspace and LWW propagates the
//    loss to every device.
//  - OFFLINE-SAFE: if the initial pull fails, nothing is ever pushed this
//    session. A blind push without knowing the remote state could overwrite a
//    healthy remote with a stale local tree — worse than no sync at all.
//  - INVALID-REMOTE-SAFE: a remote blob this build cannot validate (garbage,
//    or a version from a FUTURE client) is never overwritten — sync goes
//    inert ('remote-invalid') exactly like offline.
//  - Failures after that are contained: a failed push is dropped and the next
//    edit retries (every push carries the whole current tree, so nothing is
//    lost to a dropped intermediate).
//  - CROSS-TAB: a storage event from another tab reloads the in-memory tree
//    before this tab's next persist/push can clobber it. Whole-blob LWW still
//    applies — this converges tabs per-mutation instead of per-divergent-tree.
//
// Wired in src/main.js for the Supabase (Google) session branch only — the
// mock and canopy-GitHub sessions have no cloud identity to key the row on.
// Sign-out calls flushAndStopWorkspaceSync() so a debounced edit is delivered
// while the session is still valid, and the store subscriptions are released.

import {
  initStore, getWorkspace, getPages, exportWorkspace, importWorkspace, onStore, offStore,
  getPrefs, setPref, clearWorkspaceContent, reloadFromStorage,
} from './store.js';

// Which account the LOCAL tree belongs to. Sign-out does not clear ms:pages,
// so a second Google account on the same browser boots over the first one's
// tree — without this stamp, last-write-wins would push user A's pages into
// user B's cloud row. Lives in prefs (device-local, excluded from exports).
const OWNER_PREF = 'sync.owner';

// The one live sync session (sign-out needs to reach it; boot discards the
// promise). null when sync never started or was stopped.
let _active = null;

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

/** Cheap validation of a remote payload's envelope. Anything else is either
 *  corruption or a future client's format — both must never be overwritten. */
function remoteEnvelopeOk(data) {
  return !!data && typeof data === 'object' && data.format === 'mnemosphere-workspace' && data.version === 1;
}

const inert = (status) => ({ status, stop() {} });

/**
 * Reconcile once, then mirror edits up. `fetchRow`/`upsertRow`/`getUserId`
 * default to the Supabase-backed set in supabase.js and are injectable for
 * tests. Returns { status, stop }:
 *   'disabled'       — no Supabase client/session to sync against
 *   'imported'       — remote won the reconcile and now IS the local workspace
 *   'pushed'         — local won (or remote was absent) and the push landed
 *   'push-failed'    — local won but the push did not land (next edit retries)
 *   'synced'         — nothing on either side to move
 *   'offline'        — the pull failed; sync is inert this session
 *   'remote-invalid' — the remote blob failed validation; inert this session
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
    if (!session) return inert('disabled');
    fetchRow = fetchRow || supa.fetchWorkspaceRow;
    upsertRow = upsertRow || supa.upsertWorkspaceRow;
    if (!deps.getUserId) getUserId = async () => session.user?.id ?? null;
  }
  const debounceMs = deps.debounceMs ?? 2000;

  initStore();
  // Capture the pre-pull local state NOW: the reconcile decision below must be
  // blind to anything created while the fetch is in flight (the boot seed).
  let wsAtStart = getWorkspace();
  let localEditAtStart = latestLocalEdit();

  let row;
  let userId;
  try {
    [row, userId] = await Promise.all([fetchRow(), getUserId()]);
  } catch {
    return inert('offline');
  }

  // Owner guard: a local tree stamped for a DIFFERENT account must never win a
  // comparison or be pushed — but it may hold edits synced NOWHERE (made while
  // sync wasn't running), so stash a recovery snapshot before wiping.
  const owner = getPrefs()[OWNER_PREF];
  if (owner && userId && owner !== userId) {
    try {
      globalThis.localStorage?.setItem(`ms:evicted:${owner}`, JSON.stringify(exportWorkspace()));
    } catch { /* storage full/denied — the wipe still must not block sign-in */ }
    clearWorkspaceContent();
    wsAtStart = null;
    localEditAtStart = 0;
  }

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
    if (!remoteEnvelopeOk(row.data)) return inert('remote-invalid');
    const remoteTime = Date.parse(row.updated_at) || 0;
    if (!wsAtStart || remoteTime >= localEditAtStart) {
      try {
        importWorkspace({ ...row.data, exportedAt: row.updated_at });
        status = 'imported';
      } catch {
        // Envelope was fine but the content didn't validate — same rule as a
        // bad envelope: never overwrite what we can't read.
        return inert('remote-invalid');
      }
    } else {
      status = (await push()) ? 'pushed' : 'push-failed';
    }
  } else if (wsAtStart) {
    status = (await push()) ? 'pushed' : 'push-failed';
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

  // Cross-tab: reload before this tab's next persist/push clobbers the other
  // tab's write. (The storage event fires only in tabs that did NOT write.)
  const onStorage = (e) => {
    if (e && (e.key === 'ms:pages' || e.key === 'ms:workspace')) reloadFromStorage();
  };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', onStorage);

  const handle = {
    status,
    hasPendingPush: () => timer != null,
    async flush() {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
      await push();
    },
    stop() {
      offStore('pages', onChange);
      offStore('workspace', onChange);
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('storage', onStorage);
      if (timer) clearTimeout(timer);
      timer = null;
      if (_active === handle) _active = null;
    },
  };
  _active = handle;
  return handle;
}

/**
 * Sign-out path: deliver any pending debounced edit as one final push while
 * the session is still valid, then release every subscription. Safe to call
 * when sync never started. app.js awaits this BEFORE supabaseSignOut().
 */
export async function flushAndStopWorkspaceSync() {
  const active = _active;
  if (!active) return;
  await active.flush();
  active.stop();
}
