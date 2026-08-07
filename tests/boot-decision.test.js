// The boot session-precedence decision — the follow-up PR #47 promised: its bug
// (a Supabase hit short-circuited before asking canopy, so "Continue with
// GitHub" looked dead for Google users) shipped precisely because this decision
// lived inline in boot() where no test could table it.
import { describe, test, expect } from 'vitest';
import { decideBoot } from '../src/auth/boot-decision.js';

const SB = { user: { email: 'ada@example.com' } };
const ME = { login: 'ada-gh' };

describe('decideBoot', () => {
  test('the PR #47 regression: Supabase + canopy sessions → app with Developer unlocked AND sync on', () => {
    const d = decideBoot({ sbSession: SB, canopyMe: ME });
    expect(d).toMatchObject({ show: 'app', sessionSource: 'supabase', devAvailable: true, sync: true, stripQuery: true });
  });

  test('Supabase only → app, no Developer, sync on', () => {
    const d = decideBoot({ sbSession: SB, canopyMe: null });
    expect(d).toMatchObject({ show: 'app', sessionSource: 'supabase', devAvailable: false, sync: true });
  });

  test('canopy only → app with a GitHub-derived session, Developer unlocked, NO sync (no cloud identity to key the row on)', () => {
    const d = decideBoot({ sbSession: null, canopyMe: ME });
    expect(d).toMatchObject({ show: 'app', sessionSource: 'github', devAvailable: true, sync: false, stripQuery: true });
  });

  test('?landing preview trumps every session', () => {
    const d = decideBoot({ landing: true, sbSession: SB, canopyMe: ME });
    expect(d).toMatchObject({ show: 'landing', sessionSource: null, sync: false });
  });

  test('?denied=1 with no session → auth screen with the use-Google toast, query stripped', () => {
    const d = decideBoot({ denied: true });
    expect(d.show).toBe('auth');
    expect(d.stripQuery).toBe(true);
    expect(d.toast).toMatch(/use Google/);
  });

  test('a real session beats ?denied=1 (the query param is stale once signed in)', () => {
    expect(decideBoot({ denied: true, canopyMe: ME }).show).toBe('app');
    expect(decideBoot({ denied: true, sbSession: SB }).show).toBe('app');
  });

  test('an onboarded local (mock/demo) session → app, nothing granted', () => {
    const d = decideBoot({ localSession: { email: 'x@y.z', onboarded: true } });
    expect(d).toMatchObject({ show: 'app', sessionSource: 'existing', devAvailable: false, sync: false, stripQuery: false });
  });

  test('a local session that never finished onboarding → landing', () => {
    expect(decideBoot({ localSession: { email: 'x@y.z', onboarded: false } }).show).toBe('landing');
  });

  test('nothing at all → landing', () => {
    expect(decideBoot({})).toMatchObject({ show: 'landing', sessionSource: null, devAvailable: false, sync: false });
  });
});
