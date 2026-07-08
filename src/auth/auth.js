// Mock, Supabase-shaped auth module.
//
// There is no backend: "signing up" just remembers a pending email, any
// non-empty code "verifies" it, and completing a profile creates a local
// session. All localStorage access is guarded (try/catch) so the module
// never throws in private-browsing / storage-disabled contexts — it just
// behaves as if nothing were ever persisted.

const KEY_SESSION = 'ms:session';
const KEY_PENDING = 'ms:pending';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled / private mode — fail silently
  }
}

export async function signUp(email) {
  write(KEY_PENDING, email);
  return { ok: true };
}

export async function verifyCode(email, code) {
  const ok = typeof code === 'string' && code.trim().length > 0;
  if (ok) write(KEY_PENDING, email);
  return { ok };
}

export function pendingEmail() {
  return read(KEY_PENDING);
}

export async function completeProfile({ name, password, avatar } = {}) {
  const email = read(KEY_PENDING);
  const session = { email, name, avatar: avatar ?? null, onboarded: false };
  write(KEY_SESSION, session);
  write(KEY_PENDING, null);
  return { ok: true };
}

export async function logIn(email) {
  const existing = read(KEY_SESSION);
  if (existing && existing.email === email) {
    write(KEY_PENDING, null);
    return { ok: true };
  }
  write(KEY_PENDING, email);
  return { ok: true };
}

export function getSession() {
  return read(KEY_SESSION);
}

export function setOnboarded() {
  const session = read(KEY_SESSION);
  if (!session) return;
  write(KEY_SESSION, { ...session, onboarded: true });
}

export function logOut() {
  write(KEY_SESSION, null);
}
