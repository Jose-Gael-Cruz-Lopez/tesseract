// The boot EXECUTOR — decideBoot's table is pinned by boot-decision.test.js,
// but the wiring that acts on the descriptor lived untested in main.js:
// gutting setDevAvailable or the sync startup left every test green. The
// executor takes its effects injected, so each edge is now breakable loudly.
import { describe, test, expect, vi } from 'vitest';
import { executeBoot } from '../src/auth/boot-decision.js';

const SB = { user: { email: 'ada@example.com' } };
const ME = { login: 'ada-gh' };

function fx(over = {}) {
  return {
    profileFromSession: vi.fn((s) => ({ email: s.user.email, onboarded: true })),
    sessionFromGitHub: vi.fn((me) => ({ email: `${me.login}@users.noreply.github.com`, onboarded: true })),
    setSession: vi.fn(),
    setDevAvailable: vi.fn(),
    stripQuery: vi.fn(),
    startSync: vi.fn(async () => {}),
    startApp: vi.fn(),
    showAuth: vi.fn(async () => {}),
    showLanding: vi.fn(),
    toast: vi.fn(async () => {}),
    ...over,
  };
}

describe('executeBoot', () => {
  test('supabase + canopy: profile session set, Developer unlocked, sync STARTED BEFORE the app mounts', async () => {
    const f = fx();
    await executeBoot({ sbSession: SB, canopyMe: ME }, f);
    expect(f.setSession).toHaveBeenCalledWith({ email: 'ada@example.com', onboarded: true });
    expect(f.setDevAvailable).toHaveBeenCalledWith(true);
    expect(f.stripQuery).toHaveBeenCalled();
    expect(f.startSync).toHaveBeenCalledTimes(1);
    expect(f.startApp).toHaveBeenCalledTimes(1);
    // pull-first: sync must start before the app seeds a workspace
    expect(f.startSync.mock.invocationCallOrder[0]).toBeLessThan(f.startApp.mock.invocationCallOrder[0]);
    expect(f.showLanding).not.toHaveBeenCalled();
  });

  test('supabase only: no Developer unlock, sync still starts', async () => {
    const f = fx();
    await executeBoot({ sbSession: SB, canopyMe: null }, f);
    expect(f.setDevAvailable).not.toHaveBeenCalled();
    expect(f.startSync).toHaveBeenCalled();
    expect(f.startApp).toHaveBeenCalled();
  });

  test('canopy only: GitHub-derived session, Developer unlocked, NO sync', async () => {
    const f = fx();
    await executeBoot({ sbSession: null, canopyMe: ME }, f);
    expect(f.setSession).toHaveBeenCalledWith({ email: 'ada-gh@users.noreply.github.com', onboarded: true });
    expect(f.setDevAvailable).toHaveBeenCalledWith(true);
    expect(f.startSync).not.toHaveBeenCalled();
    expect(f.startApp).toHaveBeenCalled();
  });

  test('denied with no session: auth screen shown, THEN the use-Google toast, query stripped', async () => {
    const f = fx();
    await executeBoot({ denied: true }, f);
    expect(f.showAuth).toHaveBeenCalledTimes(1);
    expect(f.toast).toHaveBeenCalledWith(expect.stringContaining('use Google'));
    expect(f.showAuth.mock.invocationCallOrder[0]).toBeLessThan(f.toast.mock.invocationCallOrder[0]);
    expect(f.stripQuery).toHaveBeenCalled();
    expect(f.startApp).not.toHaveBeenCalled();
  });

  test('landing preview: nothing but showLanding', async () => {
    const f = fx();
    await executeBoot({ landing: true, sbSession: SB, canopyMe: ME }, f);
    expect(f.showLanding).toHaveBeenCalledTimes(1);
    expect(f.setSession).not.toHaveBeenCalled();
    expect(f.startSync).not.toHaveBeenCalled();
    expect(f.startApp).not.toHaveBeenCalled();
  });

  test('onboarded local session: app mounts with no session write, no unlock, no sync', async () => {
    const f = fx();
    await executeBoot({ localSession: { email: 'x@y.z', onboarded: true } }, f);
    expect(f.startApp).toHaveBeenCalled();
    expect(f.setSession).not.toHaveBeenCalled();
    expect(f.setDevAvailable).not.toHaveBeenCalled();
    expect(f.startSync).not.toHaveBeenCalled();
    expect(f.stripQuery).not.toHaveBeenCalled();
  });

  test('returns the decision it executed', async () => {
    const d = await executeBoot({ sbSession: SB }, fx());
    expect(d).toMatchObject({ show: 'app', sessionSource: 'supabase' });
  });
});
