// The hub picker for developer mode (the dev-side mirror of canopy's /admin/
// hubs screen). Shown over the globe area when no active hub is selected:
// lists the user's connected hubs from GET /me/repos as pickable rows, or —
// when none are connected — a "connect a repo" empty state pointing at the
// Canopy GitHub App install page. Picking a hub calls onPick(repo).

import { el } from '../ui/popover.js';

const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Where "connect a repo" sends the user. Falls back to the GitHub installations
// page when the App slug isn't configured server-side — never a dead link.
export function hubInstallUrl(appSlug) {
  return appSlug
    ? 'https://github.com/apps/' + encodeURIComponent(appSlug) + '/installations/new'
    : 'https://github.com/settings/installations';
}

// Re-validation guard for the persisted hub selection against a /me/repos result
// ({ ok, data } from canopy-api). True ONLY when a successful AND non-empty hub
// list positively excludes the hub. An empty list never invalidates: canopy's
// /me/repos returns 200 { repos: [] } on every server-side failure too (missing/
// expired user token, GitHub outage — it never 500s), so client-side an empty
// list is indistinguishable from degradation and must not wipe the selection.
// Keeping a stale hub is safe — the /r/ repo gate 404s its reads and the sphere
// surfaces that.
export function shouldClearDevHub(res, hub) {
  if (!hub || !res || !res.ok) return false;
  const repos = Array.isArray(res.data?.repos) ? res.data.repos : [];
  return repos.length > 0 && !repos.some((r) => r.repo === hub);
}

// repos = [{ repo: 'owner/name', can_push }] (from canopy's GET /me/repos).
// error → the hub list couldn't be fetched (offline / 401): show a retry state
// instead of a misleading "connect a repo".
export function mountDevHubPicker(container, { repos = [], appSlug = null, onPick, onRetry, error = false } = {}) {
  const state = el('div', 'dev-state dev-hub-picker');

  if (error) {
    state.append(
      el('h2', null, 'Hubs unavailable'),
      el('p', null, "Couldn't load your hubs from canopy. Check the connection, then retry."),
    );
    const retry = el('button', 'dev-hub-retry', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', () => onRetry && onRetry());
    state.appendChild(retry);
  } else if (!repos.length) {
    // Empty state: no connected hubs yet — guide the user to install the App.
    state.append(
      el('h2', null, 'Connect a repo'),
      el('p', null, 'The developer sphere reads a canopy hub. Install the Canopy GitHub App on a repo, then pick it here.'),
    );
    const link = el('a', 'dev-hub-connect', 'Connect a repo ↗');
    link.href = hubInstallUrl(appSlug);
    link.target = '_blank';
    link.rel = 'noopener';
    state.appendChild(link);
  } else {
    state.append(
      el('h2', null, 'Choose a hub'),
      el('p', null, 'Pick the repo hub this sphere reads. You can switch hubs from the sidebar.'),
    );
    const list = el('div', 'dev-hub-list');
    for (const r of repos) {
      const row = el('button', 'dev-hub-option');
      row.type = 'button';
      row.appendChild(el('span', 'dev-hub-name', escapeText(r.repo)));
      row.appendChild(el('span', 'dev-hub-access', r.can_push ? 'Push access' : 'Read-only'));
      row.addEventListener('click', () => onPick && onPick(r.repo));
      list.appendChild(row);
    }
    state.appendChild(list);
  }

  container.appendChild(state);
  return { root: state };
}
