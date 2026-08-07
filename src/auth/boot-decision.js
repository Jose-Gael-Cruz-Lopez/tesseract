// The boot session-precedence decision, as one pure function — extracted from
// main.js's boot() (the follow-up PR #47 promised). The bug that motivated it:
// a Supabase hit used to short-circuit before asking canopy, so a Google user
// could never unlock Developer — "Continue with GitHub" completed its whole
// OAuth round trip and then boot ignored the cookie on the way back. Inline,
// that decision was untestable; here it's a table (tests/boot-decision.test.js).
//
// Inputs are the RESOLVED facts (main.js gathers them; nothing here fetches):
//   landing      — /?landing preview requested
//   denied       — ?denied=1 (a GitHub sign-in refused by the allowlist)
//   sbSession    — the Supabase (Google) session object, or null
//   canopyMe     — the canopy GET /auth/me identity, or null
//   localSession — the stored local (mock/demo) session, or null
//
// The descriptor says what to do; main.js executes it:
//   show          — 'landing' | 'auth' | 'app'
//   sessionSource — which identity seeds the app session:
//                   'supabase' | 'github' | 'existing' | null
//   devAvailable  — unlock Developer mode (a canopy session exists)
//   sync          — start workspace cloud sync (Supabase identities only:
//                   the sync row is keyed on the Supabase user id)
//   stripQuery    — drop OAuth/denied query params from the URL
//   toast         — a message to show after mounting (optional)

/**
 * Execute a boot decision. `fx` carries every effect injected (main.js supplies
 * the real ones), so the wiring — which session seeds the app, when Developer
 * unlocks, that sync starts BEFORE the app seeds — is testable
 * (tests/boot-exec.test.js); main.js stays a thin composition root.
 */
export async function executeBoot(inputs, fx) {
  const d = decideBoot(inputs);
  if (d.sessionSource === 'supabase') fx.setSession(fx.profileFromSession(inputs.sbSession));
  else if (d.sessionSource === 'github') fx.setSession(fx.sessionFromGitHub(inputs.canopyMe));
  if (d.devAvailable) fx.setDevAvailable(true);
  if (d.stripQuery) fx.stripQuery();
  // Pull-first: sync's reconcile must run (or time out) before startApp can
  // seed a starter workspace over unclaimed remote data.
  if (d.sync) await fx.startSync();
  if (d.show === 'app') fx.startApp();
  else if (d.show === 'auth') {
    await fx.showAuth();
    if (d.toast) await fx.toast(d.toast);
  } else {
    fx.showLanding();
  }
  return d;
}

export function decideBoot({ landing = false, denied = false, sbSession = null, canopyMe = null, localSession = null } = {}) {
  const base = { sessionSource: null, devAvailable: false, sync: false, stripQuery: false, toast: null };
  if (landing) return { ...base, show: 'landing' };

  // Google owns the Knowledge side; canopy answers a DIFFERENT question —
  // whether Developer is unlocked. Both are consulted, never one short of the other.
  if (sbSession) {
    return { ...base, show: 'app', sessionSource: 'supabase', devAvailable: !!canopyMe, sync: true, stripQuery: true };
  }
  // A canopy GitHub session alone grants BOTH sides (the fused deploy's own
  // login): a knowledge session is derived from the GitHub identity. No cloud
  // sync — the sync row is keyed on a Supabase user id this session lacks.
  if (canopyMe) {
    return { ...base, show: 'app', sessionSource: 'github', devAvailable: true, stripQuery: true };
  }
  // ?denied=1 matters only with NO session: a stale param must not block a
  // signed-in user.
  if (denied) {
    return {
      ...base,
      show: 'auth',
      stripQuery: true,
      toast: "Developer access isn't enabled for that GitHub account yet — use Google for the Knowledge side.",
    };
  }
  if (localSession && localSession.onboarded) {
    return { ...base, show: 'app', sessionSource: 'existing' };
  }
  return { ...base, show: 'landing' };
}
