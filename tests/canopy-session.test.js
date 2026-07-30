// @vitest-environment happy-dom
import { test, expect, vi } from 'vitest';
import { getCanopySession, sessionFromGitHub, canopyLogout } from '../src/data/canopy-session.js';

test('getCanopySession returns the parsed identity on 200, credentialed', async () => {
  const fetchImpl = vi.fn(async () => new Response(
    JSON.stringify({ login: 'octocat', name: 'The Octocat', avatar_url: 'http://x/a.png', org: null, admin: true }),
    { status: 200 },
  ));
  const me = await getCanopySession(fetchImpl);
  expect(me).toEqual({ login: 'octocat', name: 'The Octocat', avatar: 'http://x/a.png' });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('/auth/me');
  expect(init.credentials).toBe('include');
});

test('getCanopySession returns null on 401 (no session)', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
  expect(await getCanopySession(fetchImpl)).toBeNull();
});

test('getCanopySession returns null when fetch throws', async () => {
  const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
  expect(await getCanopySession(fetchImpl)).toBeNull();
});

test('getCanopySession returns null when body lacks a login', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ org: null }), { status: 200 }));
  expect(await getCanopySession(fetchImpl)).toBeNull();
});

test('sessionFromGitHub builds an onboarded knowledge session', () => {
  expect(sessionFromGitHub({ login: 'octocat', name: 'The Octocat', avatar: 'http://x/a.png' })).toEqual({
    email: 'octocat@users.noreply.github.com',
    name: 'The Octocat',
    avatar: 'http://x/a.png',
    onboarded: true,
    provider: 'github',
  });
});

test('sessionFromGitHub falls back to login when name is missing', () => {
  const s = sessionFromGitHub({ login: 'octocat', name: null, avatar: null });
  expect(s.name).toBe('octocat');
  expect(s.avatar).toBeNull();
});

// The canopy session cookie is httpOnly, so clearing local state cannot end it: the
// ONLY way to revoke it is asking the server to. Without this, boot()'s
// getCanopySession() re-derives a session from the surviving cookie on the very next
// reload and drops the user straight back into the app they just left.
test('canopyLogout POSTs to /auth/logout credentialed', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  expect(await canopyLogout(fetchImpl)).toBe(true);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('/auth/logout');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('include'); // without this the cookie isn't sent and nothing is revoked
});

test('canopyLogout returns false when fetch throws — signing out must not break', async () => {
  const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
  await expect(canopyLogout(fetchImpl)).resolves.toBe(false);
});

test('canopyLogout returns false on 401 (no canopy session to revoke)', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
  expect(await canopyLogout(fetchImpl)).toBe(false);
});
