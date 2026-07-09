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
import './styles/templates.css';

import { initTheme } from './ui/theme.js';
import { getSession } from './auth/auth.js';
import { initStore, seedWorkspace } from './data/store.js';
import { mountApp } from './app.js';

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

function boot() {
  initTheme();
  const root = document.getElementById('root');
  const session = getSession();
  if (!session || !session.onboarded) showAuth(root);
  else startApp(root);
}

boot();
