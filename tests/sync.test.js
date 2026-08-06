// Cloud sync for the Knowledge workspace (Supabase-backed, dependency-injected
// here). The contract under test:
//  - pull-first: the initial reconcile decides pull vs push before ANY push
//    subscription exists, so a freshly-seeded browser can never clobber remote
//  - last-write-wins on the whole workspace blob (documented v1 semantics)
//  - offline-safe: if the initial pull fails, NOTHING is ever pushed (a stale
//    local tree must not overwrite a healthy remote through a blind write)
//  - edits push debounced, as one upsert per quiet period
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from '../src/data/store.js';
import { startWorkspaceSync } from '../src/data/sync.js';

function installMemoryLocalStorage() {
  const map = new Map();
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true,
  });
}

let stop = null;

beforeEach(() => {
  installMemoryLocalStorage();
  store.resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

function remoteRowFrom(exported, updatedAt) {
  return { data: exported, updated_at: updatedAt };
}

async function sync(deps) {
  const handle = await startWorkspaceSync({ debounceMs: 1000, ...deps });
  stop = handle.stop;
  return handle;
}

describe('initial reconcile', () => {
  test('no local workspace + a remote row → imports the remote (fresh-browser pull)', async () => {
    store.seedWorkspace({ name: 'Remote' });
    const remote = store.exportWorkspace();
    store.resetStore(); // back to a truly fresh browser
    installMemoryLocalStorage();

    const handle = await sync({
      fetchRow: async () => remoteRowFrom(remote, new Date().toISOString()),
      upsertRow: vi.fn(),
    });
    expect(handle.status).toBe('imported');
    expect(store.getWorkspace().name).toBe("Remote's Mnemosphere");
  });

  test('remote newer than every local edit → remote wins', async () => {
    store.seedWorkspace({ name: 'Old Local' });
    store.seedWorkspace({ name: 'Remote' });
    const remote = store.exportWorkspace();
    store.seedWorkspace({ name: 'Old Local' });

    const future = new Date(Date.now() + 60_000).toISOString();
    const handle = await sync({
      fetchRow: async () => remoteRowFrom(remote, future),
      upsertRow: vi.fn(),
    });
    expect(handle.status).toBe('imported');
    expect(store.getWorkspace().name).toBe("Remote's Mnemosphere");
  });

  test('local newer than the remote row → pushes local, remote content is not imported', async () => {
    store.seedWorkspace({ name: 'Remote' });
    const remote = store.exportWorkspace();
    store.seedWorkspace({ name: 'Newer Local' });

    const past = new Date(Date.now() - 60_000).toISOString();
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({
      fetchRow: async () => remoteRowFrom(remote, past),
      upsertRow,
    });
    expect(handle.status).toBe('pushed');
    expect(store.getWorkspace().name).toBe("Newer Local's Mnemosphere");
    expect(upsertRow).toHaveBeenCalledTimes(1);
    expect(upsertRow.mock.calls[0][0].workspace.name).toBe("Newer Local's Mnemosphere");
  });

  test('no remote row + a local workspace → pushes local', async () => {
    store.seedWorkspace({ name: 'Only Local' });
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({ fetchRow: async () => null, upsertRow });
    expect(handle.status).toBe('pushed');
    expect(upsertRow).toHaveBeenCalledTimes(1);
  });

  test('a corrupt remote row is skipped (local survives) and local is pushed over it', async () => {
    store.seedWorkspace({ name: 'Local' });
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({
      fetchRow: async () => remoteRowFrom({ format: 'garbage' }, new Date(Date.now() + 60_000).toISOString()),
      upsertRow,
    });
    expect(store.getWorkspace().name).toBe("Local's Mnemosphere");
    expect(handle.status).toBe('pushed');
  });
});

describe('local-owner guard — a second account on the same browser', () => {
  // Sign-out does not clear ms:pages, so user B can boot over user A's local
  // tree. Sync must NEVER let LWW push A's pages into B's cloud row.
  test("a foreign local tree loses to the remote row even when it is 'newer'", async () => {
    store.seedWorkspace({ name: 'User B Remote' });
    const remote = store.exportWorkspace();
    store.resetStore();
    installMemoryLocalStorage();
    store.seedWorkspace({ name: 'User A Leftover' }); // newer than B's remote row

    const upsertRow = vi.fn(async () => {});
    const first = await sync({
      getUserId: async () => 'user-a',
      fetchRow: async () => null,
      upsertRow: vi.fn(async () => {}),
    });
    first.stop(); // user A synced once — the local tree is now stamped as A's
    stop = null;

    const past = new Date(Date.now() - 60_000).toISOString();
    const handle = await sync({
      getUserId: async () => 'user-b',
      fetchRow: async () => remoteRowFrom(remote, past),
      upsertRow,
    });
    expect(handle.status).toBe('imported'); // B's remote wins despite A's newer edits
    expect(store.getWorkspace().name).toBe("User B Remote's Mnemosphere");
    // A's leftover tree must never have been pushed into B's row.
    expect(upsertRow.mock.calls.every(([p]) => !JSON.stringify(p).includes('User A Leftover'))).toBe(true);
  });

  test('a foreign local tree with NO remote row is cleared, not adopted', async () => {
    store.seedWorkspace({ name: 'User A Leftover' });
    const firstHandle = await sync({
      getUserId: async () => 'user-a',
      fetchRow: async () => null,
      upsertRow: vi.fn(async () => {}),
    });
    firstHandle.stop();
    stop = null;

    const upsertRow = vi.fn(async () => {});
    const handle = await sync({
      getUserId: async () => 'user-b',
      fetchRow: async () => null,
      upsertRow,
    });
    // B starts empty (boot will seed a fresh workspace for them afterwards);
    // A's tree is neither kept nor pushed.
    expect(store.getWorkspace()).toBeNull();
    expect(handle.status).toBe('synced');
    expect(upsertRow).not.toHaveBeenCalled();
  });

  test('the same account returning is NOT foreign — normal LWW applies', async () => {
    store.seedWorkspace({ name: 'Mine' });
    const firstHandle = await sync({
      getUserId: async () => 'user-a',
      fetchRow: async () => null,
      upsertRow: vi.fn(async () => {}),
    });
    firstHandle.stop();
    stop = null;

    const past = new Date(Date.now() - 60_000).toISOString();
    store.seedWorkspace({ name: 'Stale Remote' });
    const remote = store.exportWorkspace();
    store.seedWorkspace({ name: 'Mine Newer' });
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({
      getUserId: async () => 'user-a',
      fetchRow: async () => remoteRowFrom(remote, past),
      upsertRow,
    });
    expect(handle.status).toBe('pushed'); // my own newer local wins as usual
    expect(store.getWorkspace().name).toBe("Mine Newer's Mnemosphere");
  });
});

describe('offline safety', () => {
  test('a failed initial pull means NO pushes ever — not even after local edits', async () => {
    store.seedWorkspace({ name: 'Local' });
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({
      fetchRow: async () => { throw new Error('network down'); },
      upsertRow,
    });
    expect(handle.status).toBe('offline');

    store.createPage({ title: 'edited while offline' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upsertRow).not.toHaveBeenCalled();
  });
});

describe('push-on-change', () => {
  test('edits after reconcile push ONE debounced upsert per quiet period', async () => {
    store.seedWorkspace({ name: 'Local' });
    const upsertRow = vi.fn(async () => {});
    await sync({ fetchRow: async () => null, upsertRow });
    upsertRow.mockClear(); // discard the reconcile push

    store.createPage({ title: 'one' });
    store.createPage({ title: 'two' });
    store.createPage({ title: 'three' });
    expect(upsertRow).not.toHaveBeenCalled(); // debounced, not per-mutation

    await vi.advanceTimersByTimeAsync(1000);
    expect(upsertRow).toHaveBeenCalledTimes(1);
    const pushed = upsertRow.mock.calls[0][0];
    expect(pushed.pages.map((p) => p.title)).toEqual(expect.arrayContaining(['one', 'two', 'three']));
  });

  test('stop() unsubscribes — edits after stop push nothing', async () => {
    store.seedWorkspace({ name: 'Local' });
    const upsertRow = vi.fn(async () => {});
    const handle = await sync({ fetchRow: async () => null, upsertRow });
    upsertRow.mockClear();

    handle.stop();
    stop = null;
    store.createPage({ title: 'after stop' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upsertRow).not.toHaveBeenCalled();
  });

  test('a failing push is contained and the next edit retries', async () => {
    store.seedWorkspace({ name: 'Local' });
    let calls = 0;
    const upsertRow = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('flaky network'); // reconcile ok, first edit-push fails
    });
    await sync({ fetchRow: async () => null, upsertRow });

    store.createPage({ title: 'lost?' });
    await vi.advanceTimersByTimeAsync(1000); // this push throws — must not crash
    store.createPage({ title: 'retry carrier' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(upsertRow).toHaveBeenCalledTimes(3);
    // the retry carries the earlier edit too — the payload is always the whole tree
    expect(upsertRow.mock.calls[2][0].pages.map((p) => p.title)).toEqual(expect.arrayContaining(['lost?', 'retry carrier']));
  });
});
