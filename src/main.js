// Boot: theme → session gate → store → app shell.

import './styles/tokens.css';
import './styles/base.css';
import './styles/modals.css';
import './styles/shell.css';
import './styles/sidebar.css';
import './styles/globe.css';

import { initTheme } from './ui/theme.js';
import { getSession } from './auth/auth.js';
import { initStore, seedWorkspace } from './data/store.js';
import { mountApp } from './app.js';

// The auth views ship in Task 21; import.meta.glob resolves to {} until the
// file exists, so the boot degrades to a plain pending screen instead of a
// build error.
const authViews = import.meta.glob('./auth/auth-view.js');

function startApp(root) {
  const session = getSession();
  if (!initStore()) seedWorkspace({ name: session?.name || 'Me', email: session?.email || '' });
  mountApp(root);
}

async function boot() {
  initTheme();
  const root = document.getElementById('root');
  const session = getSession();
  if (!session || !session.onboarded) {
    const load = authViews['./auth/auth-view.js'];
    if (load) {
      const { mountAuth } = await load();
      mountAuth(root, { onComplete: () => startApp(root) });
    } else {
      root.innerHTML = '<div class="boot-auth-pending">auth pending</div>';
    }
    return;
  }
  startApp(root);
}

boot();
