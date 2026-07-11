// Boot: theme → session gate → store → app shell.

import './styles/tokens.css';
import './styles/base.css';
import './styles/modals.css';
import './styles/shell.css';
import './styles/globe.css';
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

  // Preview the intro landing on demand, regardless of session: /?landing
  if (new URLSearchParams(location.search).has('landing')) {
    showLanding(root);
    return;
  }

  // A real Supabase (Google) session takes precedence over the mock flow.
  // getSupabaseSession() awaits URL detection, so it also resolves the session
  // right after the OAuth redirect back from Google.
  if (supabaseEnabled) {
    const sbSession = await getSupabaseSession();
    if (sbSession) {
      setSession(profileFromSession(sbSession));
      history.replaceState(null, '', location.pathname); // drop the OAuth token/code from the URL
      startApp(root);
      return;
    }
  }

  // A canopy GitHub session (same-origin, fused deploy) grants BOTH sides: derive a
  // knowledge session from the GitHub identity and unlock the developer side.
  const me = await getCanopySession();
  if (me) {
    setSession(sessionFromGitHub(me));
    setDevAvailable(true);
    history.replaceState(null, '', location.pathname); // drop ?denied / OAuth query
    startApp(root);
    return;
  }
  // A GitHub sign-in that was denied (not allow-listed yet) returns as ?denied=1 with
  // no session — show the auth screen with a note to use Google for the Knowledge side.
  if (new URLSearchParams(location.search).get('denied') === '1') {
    history.replaceState(null, '', location.pathname);
    showAuth(root);
    const { toast } = await import('./ui/popover.js');
    toast("Developer access isn't enabled for that GitHub account yet — use Google for the Knowledge side.");
    return;
  }

  const session = getSession();
  if (!session || !session.onboarded) showLanding(root);
  else startApp(root);
}

boot();
