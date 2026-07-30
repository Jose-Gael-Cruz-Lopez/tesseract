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
