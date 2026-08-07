// Supabase client + auth helpers for real (Google) sign-in.
//
// The URL and publishable key come from .env.local (VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY). The publishable key is RLS-gated and safe in the
// browser. If either is missing, `supabaseEnabled` is false and the app
// degrades to the mock flow (the Google button falls back to "Coming soon").
//
// The client is created lazily on first use so that merely importing this
// module (e.g. from the auth view, under tests) never constructs a real
// client — important because supabase-js's realtime client can't initialize
// in a bare Node/happy-dom test environment.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = !!(url && key);

let _client = null;
function client() {
  if (!supabaseEnabled) return null;
  if (!_client) _client = createClient(url, key);
  return _client;
}

// Start Google OAuth. Redirects the browser to Google; on return, supabase-js
// (detectSessionInUrl, on by default) completes the code exchange during
// getSupabaseSession()'s initialization.
export async function signInWithGoogle() {
  const c = client();
  if (!c) throw new Error('Supabase not configured');
  return c.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

// Current session (awaits URL detection after an OAuth redirect). Null when
// unconfigured or signed out.
export async function getSupabaseSession() {
  const c = client();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session ?? null;
}

// Map a Supabase user session onto the app's local profile shape. OAuth users
// have already "onboarded", so they skip the mock profile/use-case steps.
export function profileFromSession(session) {
  const u = session.user || {};
  const m = u.user_metadata || {};
  return {
    email: u.email || '',
    name: m.full_name || m.name || (u.email ? u.email.split('@')[0] : 'Me'),
    avatar: m.avatar_url || m.picture || null,
    onboarded: true,
  };
}

// ---------- workspace row (cloud sync — src/data/sync.js) ----------
//
// One row per user in public.workspaces (user_id PK → auth.users, data jsonb,
// updated_at). RLS restricts every operation to auth.uid() = user_id, so the
// unfiltered select below can only ever see the caller's own row. Schema:
// supabase/migrations/20260806_workspaces.sql.

/** The caller's workspace row ({ data, updated_at }) or null when none exists.
 *  Throws on any query error — sync treats that as offline and stays inert. */
export async function fetchWorkspaceRow() {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.from('workspaces').select('data, updated_at').maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Upsert the caller's single workspace row. Throws on failure (contained by
 *  the sync layer — the next edit retries with the whole tree). */
export async function upsertWorkspaceRow(payload) {
  const c = client();
  if (!c) throw new Error('Supabase not configured');
  const { data: userData, error: userError } = await c.auth.getUser();
  if (userError || !userData?.user) throw new Error('no authenticated user');
  const { error } = await c.from('workspaces').upsert({
    user_id: userData.user.id,
    data: payload,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function supabaseSignOut() {
  const c = client();
  if (!c) return;
  try {
    await c.auth.signOut();
  } catch {
    // network hiccup / already signed out — ignore
  }
}
