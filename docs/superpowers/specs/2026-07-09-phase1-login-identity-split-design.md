# Phase 1 — Login & Identity Split — Design

**Date:** 2026-07-09
**Status:** Approved (design locked with user)
**Part of:** the multi-tenant developer-SaaS roadmap (Phase 1 of 5). Later phases:
2 tenancy, 3 GitHub App + connect-repos, 4 multi-repo sphere, 5 SaaS polish.

## Goal

Split access by login method on the **fused single-Worker** deploy:

- **Google / email / Apple → Knowledge side only.**
- **GitHub → Developer + Knowledge side**, authorized by the same-origin GitHub
  session cookie (the mint/paste-a-token step disappears).

## Why

The product's end state is "sign in with GitHub, get the developer side." Phase 1
establishes that split on top of the deployed fused app, and removes the token
friction by using the GitHub session cookie same-origin. It ships value immediately
and is the foundation the tenancy/App phases build on.

## Architecture

The app and canopy already share one origin (fused deploy). Two independent auth
facts drive the UI:

1. **Knowledge session** — the existing `ms:session` (localStorage), created by
   Google (Supabase), the mock email flow, or now by a GitHub sign-in.
2. **GitHub/developer session** — canopy's httpOnly cookie, set by canopy's GitHub
   OAuth. Its presence (checked via `GET /auth/me`, same-origin, credentialed) means
   the user is an **allowed** developer (canopy only mints a session for allow-listed
   / org members), so it doubles as the "developer unlocked" signal.

Developer-mode reads switch from bearer-token to the **cookie** (`credentials:
'include'`) on the fused deploy; the token path remains only for split-dev / remote.

## Components / Changes

### A. Canopy — `return` param on the OAuth round-trip
`canopy/src/auth/routes.ts`:
- `GET /auth/login` reads `?return=<path>`, validates it is a **safe same-origin
  relative path** (starts with `/`, not `//`, no scheme), and stores it in a
  short-lived httpOnly cookie `oauth_return` (default `/admin/` when absent/invalid).
- `GET /auth/callback` reads + clears `oauth_return`; on success redirects there
  (instead of the hard-coded `/admin/`); on denial redirects to
  `<return>?denied=1`. The sealed `oauth_tx` (state+verifier) is unchanged — the
  return path rides a separate cookie so the existing seal/unseal tests are untouched.
- Validation helper `safeReturnPath(raw): string` — pure, unit-tested.

### B. Mnemosphere — a canopy-session reader
`src/data/canopy-session.js` (new):
- `getCanopySession(fetchImpl?)` → `GET /auth/me` with `credentials:'include'`;
  returns `{ login, name, avatar }` on 200, `null` on 401/failure. Same-origin
  (relative path), so it only resolves in the fused deploy (or when a URL is set).
- `sessionFromGitHub(me)` → a knowledge session object
  `{ email: '<login>@users.noreply.github.com', name: me.name || me.login,
     avatar: me.avatar ?? null, onboarded: true, provider: 'github' }`.

### C. Mnemosphere — the boot gate
`src/main.js` `boot()`:
- After the Supabase check and before the mock-session check, add a **GitHub check**:
  `const me = await getCanopySession();` if `me` → `setSession(sessionFromGitHub(me))`,
  mark developer available (see D), `history.replaceState` to drop any `?denied`/OAuth
  query, then `startApp(root)` and return.
- If the URL carries `?denied=1` and there is no session → show the auth screen with a
  toast: developer access isn't enabled for that GitHub account yet; use Google for the
  Knowledge side. (Interim; opens up in Phase 3.)

### D. Mnemosphere — "developer available" signal
- `src/data/store.js`: `setDevAvailable(bool)` / `isDevAvailable()` — a **runtime**
  (non-persisted) flag set true when a canopy session is detected at boot. (Mode stays
  the persisted `getMode()`; availability is per-session and must not be cached across
  logins.)
- The sidebar mode-switch and the workspace "Switch mode" menu show **Developer only
  when `isDevAvailable()`**. For a Knowledge-only user, "Developer" is replaced by a
  **"Continue with GitHub to unlock"** action → `window.location.href =
  '/auth/login?return=/'`.

### E. Mnemosphere — login screen
`src/auth/auth-view.js` `buildOAuth()`:
- Add **"Continue with GitHub"** (icon + label) above/below Google. Click →
  `window.location.href = '/auth/login?return=/'` (full-page redirect; returns to the
  app signed in). No onboarding for GitHub users — the boot gate drops them straight in.

### F. Mnemosphere — developer reads use the cookie
`src/dev/canopy-api.js` `get()`:
- On the same-origin path (blank URL) send `credentials:'include'` and **no** bearer
  when a token isn't set; keep the bearer when a token IS set (split-dev / remote).
- `isConfigured()` becomes `!!token || isDevAvailable()` — reading the **synchronous
  runtime flag** (set once at boot by the async `/auth/me` check in D), never fetching.
  So the fused-deploy GitHub user is "configured" with no token, and the check stays sync
  for the connect-prompt path.

## Data flow

**GitHub sign-in:** login screen → `/auth/login?return=/` → GitHub → `/auth/callback`
sets the cookie, redirects to `/` → `boot()` sees `/auth/me` → creates the knowledge
session, marks developer available → app mounts with both modes; Developer reads run
same-origin with the cookie.

**Google sign-in:** unchanged → knowledge session, no canopy cookie → `isDevAvailable()`
false → Developer replaced by "Continue with GitHub to unlock."

## Auth / security

- `return` is validated to same-origin relative paths (open-redirect guard).
- Canopy's gate is unchanged: a session (hence `/auth/me` 200) exists **only** for
  allowed users, so "cookie present ⇒ developer allowed" holds without new checks.
- No token is stored for fused-deploy GitHub users; the httpOnly cookie is never read
  by JS.

## Testing

- **Canopy:** `safeReturnPath` unit tests (`/` ok, `/admin/` ok, `//evil` → default,
  `https://x` → default, `""` → default); `/auth/login?return=/admin/` sets
  `oauth_return`; existing auth-routes tests stay green.
- **Mnemosphere:** `getCanopySession` returns parsed `me` on 200 / `null` on 401;
  `sessionFromGitHub` shape; `canopy-api` sends `credentials:'include'` + no bearer when
  tokenless-but-session, bearer when token set; `isConfigured()` true when a session is
  available; the mode switch hides Developer when `!isDevAvailable()` and shows the
  GitHub-unlock action.
- Full gates: root `npx vitest run`, `cd canopy && npm test`, `cd canopy && npm run build:app`.
- **Live E2E:** on the deployed Worker — Google → knowledge only (Developer shows
  unlock); GitHub → both modes, dev sphere reads via cookie (no token).

## Out of scope (later phases)

- Tenancy / per-user data isolation (Phase 2).
- GitHub App + users connecting their own repos (Phase 3).
- Multi-repo sphere (Phase 4).
- Account-linking a Google user's identity to GitHub (a Phase 2+ concern); in Phase 1
  the two are separate sign-ins.
