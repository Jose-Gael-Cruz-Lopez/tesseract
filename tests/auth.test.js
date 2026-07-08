// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signUp,
  verifyCode,
  pendingEmail,
  completeProfile,
  logIn,
  getSession,
  setOnboarded,
  logOut,
} from '../src/auth/auth.js';

beforeEach(() => {
  localStorage.clear();
});

describe('auth module', () => {
  test('imports', async () => {
    await import('../src/auth/auth.js');
  });

  test('getSession is null when nothing is stored', () => {
    expect(getSession()).toBeNull();
  });

  test('pendingEmail is null when nothing is stored', () => {
    expect(pendingEmail()).toBeNull();
  });

  test('signUp stores the pending email', async () => {
    const res = await signUp('ada@example.com');
    expect(res).toEqual({ ok: true });
    expect(pendingEmail()).toBe('ada@example.com');
    expect(JSON.parse(localStorage.getItem('ms:pending'))).toBe('ada@example.com');
  });

  test('verifyCode rejects an empty code', async () => {
    await signUp('ada@example.com');
    const res = await verifyCode('ada@example.com', '');
    expect(res).toEqual({ ok: false });
  });

  test('verifyCode rejects a whitespace-only code', async () => {
    await signUp('ada@example.com');
    const res = await verifyCode('ada@example.com', '   ');
    expect(res.ok).toBe(false);
  });

  test('verifyCode accepts "123456"', async () => {
    await signUp('ada@example.com');
    const res = await verifyCode('ada@example.com', '123456');
    expect(res).toEqual({ ok: true });
  });

  test('completeProfile creates a session with the expected shape', async () => {
    await signUp('ada@example.com');
    await verifyCode('ada@example.com', '123456');
    const res = await completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: '🦋' });
    expect(res).toEqual({ ok: true });
    expect(getSession()).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatar: '🦋',
      onboarded: false,
    });
  });

  test('completeProfile clears the pending email', async () => {
    await signUp('ada@example.com');
    await completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: null });
    expect(pendingEmail()).toBeNull();
  });

  test('completeProfile defaults avatar to null when not provided', async () => {
    await signUp('ada@example.com');
    await completeProfile({ name: 'Ada Lovelace', password: 'hunter2' });
    expect(getSession().avatar).toBeNull();
  });

  test('setOnboarded flips onboarded to true', async () => {
    await signUp('ada@example.com');
    await completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: null });
    expect(getSession().onboarded).toBe(false);
    setOnboarded();
    expect(getSession().onboarded).toBe(true);
  });

  test('setOnboarded is a no-op when there is no session', () => {
    expect(getSession()).toBeNull();
    setOnboarded();
    expect(getSession()).toBeNull();
  });

  test('logOut clears the session', async () => {
    await signUp('ada@example.com');
    await completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: null });
    expect(getSession()).not.toBeNull();
    logOut();
    expect(getSession()).toBeNull();
  });

  test('logIn reuses the existing session when the email matches', async () => {
    await signUp('ada@example.com');
    await completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: null });
    const res = await logIn('ada@example.com');
    expect(res).toEqual({ ok: true });
    expect(pendingEmail()).toBeNull();
    expect(getSession().email).toBe('ada@example.com');
  });

  test('logIn sets a new pending email when no session exists for it', async () => {
    const res = await logIn('grace@example.com');
    expect(res).toEqual({ ok: true });
    expect(pendingEmail()).toBe('grace@example.com');
    expect(getSession()).toBeNull();
  });

  describe('when localStorage throws', () => {
    let setItemSpy;
    let getItemSpy;

    beforeEach(() => {
      setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
    });

    afterEach(() => {
      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
    });

    test('signUp does not throw and still reports ok', async () => {
      await expect(signUp('ada@example.com')).resolves.toEqual({ ok: true });
    });

    test('getSession returns null instead of throwing', () => {
      expect(() => getSession()).not.toThrow();
      expect(getSession()).toBeNull();
    });

    test('pendingEmail returns null instead of throwing', () => {
      expect(() => pendingEmail()).not.toThrow();
      expect(pendingEmail()).toBeNull();
    });

    test('completeProfile does not throw', async () => {
      await expect(
        completeProfile({ name: 'Ada Lovelace', password: 'hunter2', avatar: null })
      ).resolves.toEqual({ ok: true });
    });

    test('setOnboarded and logOut do not throw', () => {
      expect(() => setOnboarded()).not.toThrow();
      expect(() => logOut()).not.toThrow();
    });
  });
});
