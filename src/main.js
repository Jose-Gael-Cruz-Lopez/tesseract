// Boot: theme → session gate → store → app shell.

import './styles/tokens.css';
import './styles/base.css';
import './styles/modals.css';
import './styles/shell.css';
import './styles/graph.css';
import './styles/auth.css';
import './styles/sidebar.css';
import './styles/topbar.css';
import './styles/editor.css';
import './styles/database.css';
import './styles/ai.css';
import './styles/search.css';
import './styles/updates.css';
import './styles/settings.css';
import './styles/import.css';
import './styles/dev.css';
import './styles/templates.css';
import './styles/landing.css';

import { initTheme } from './ui/theme.js';
import { mountLanding } from './ui/landing.js';
import { getSession, setSession } from './auth/auth.js';
import { initStore, seedWorkspace, setDevAvailable } from './data/store.js';
import { mountApp } from './app.js';
import { supabaseEnabled, getSupabaseSession, profileFromSession } from './data/supabase.js';
import { getCanopySession, sessionFromGitHub } from './data/canopy-session.js';
import { executeBoot } from './auth/boot-decision.js';

// Auth views load lazily (a separate chunk) so the auth code isn't paid for
// once a returning, onboarded user is past the gate.
const authViews = import.meta.glob('./auth/auth-view.js');

// Mount the app shell for a signed-in user, seeding a workspace on first run.
// Logging out returns to the auth screens without a reload.
function startApp(root) {
  const session = getSession();
  if (!initStore()) seedWorkspace({ name: session?.name || 'Me', email: session?.email || '' });
  mountApp(root, { onLogOut: () => showAuth(root) });
}

// Render the sign-up / log-in / onboarding flow; on completion, boot the app.
async function showAuth(root) {
  const load = authViews['./auth/auth-view.js'];
  if (load) {
    const { mountAuth } = await load();
    mountAuth(root, { onComplete: () => startApp(root) });
  } else {
    root.innerHTML = '<div class="boot-auth-pending">auth pending</div>';
  }
}

// Signed-out visitors see the intro video first; when it ends (or is skipped),
// hand off to the sign-in / onboarding flow.
function showLanding(root) {
  mountLanding(root, { onDone: () => showAuth(root) });
}

async function boot() {
  initTheme();
  const root = document.getElementById('root');

  // Gather the resolved facts, then let the PURE decision table
  // (src/auth/boot-decision.js — tested) say what to do. getSupabaseSession()
  // awaits URL detection, so it also resolves the session right after the OAuth
  // redirect back from Google; both providers are consulted together because
  // they answer DIFFERENT questions (Supabase: who owns the Knowledge side;
  // canopy: whether Developer is unlocked) — the PR #47 bug was consulting one
  // short of the other.
  const params = new URLSearchParams(location.search);
  const inputs = {
    landing: params.has('landing'),
    denied: params.get('denied') === '1',
    sbSession: null,
    canopyMe: null,
    localSession: getSession(),
  };
  if (!inputs.landing) {
    [inputs.sbSession, inputs.canopyMe] = await Promise.all([
      supabaseEnabled ? getSupabaseSession() : Promise.resolve(null),
      getCanopySession(),
    ]);
  }
  // Execute via the injected-effects executor (tests/boot-exec.test.js pins
  // the wiring; main.js is only the composition root supplying real effects).
  await executeBoot(inputs, {
    profileFromSession,
    sessionFromGitHub,
    setSession,
    setDevAvailable,
    stripQuery: () => history.replaceState(null, '', location.pathname), // drop OAuth/denied query params
    // Cloud sync (Google users only — the row is keyed on the Supabase user).
    // PULL-FIRST and BEFORE startApp's seed: a fresh browser with remote data
    // must import it rather than race a starter seed over it. The 5s race
    // keeps a dead network from blocking boot — the reconcile is race-proof
    // (sync.js captures pre-pull state), so a late resolve imports safely and
    // the UI updates live through store events.
    startSync: () => {
      const syncReady = import('./data/sync.js').then((m) => m.startWorkspaceSync()).catch(() => {});
      return Promise.race([syncReady, new Promise((resolve) => setTimeout(resolve, 5000))]);
    },
    startApp: () => startApp(root),
    showAuth: () => showAuth(root),
    showLanding: () => showLanding(root),
    toast: async (msg) => {
      const { toast } = await import('./ui/popover.js');
      toast(msg);
    },
  });
}

boot();
