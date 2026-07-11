# Phase 3: GitHub App + Connect-Your-Repos — Design

**Status:** Design approved 2026-07-11. The integration *engine* is built and tested on
branch `phase-3` (5 increments); the *wiring* + UI remain.

**Goal:** Turn the single-tenant canopy deployment into a multi-tenant product — any GitHub
user signs in, installs a GitHub App on their own repos, and gets an **isolated per-repo
developer hub**. Hub access mirrors GitHub's own permissions (repo collaborators).

**Builds on Phase 2:** the canopy data model is fully per-repo (`0020`–`0023`), reads/writes
take an optional `repo`, and the entry points currently pin to `defaultRepo(env)` for
single-tenant. Phase 3 **replaces `defaultRepo(env)` with a per-request repo** derived from
the URL and the signed-in user.

## Global constraints

- **FINAL PRODUCT, not an MVP** (explicit user directive).
- **ONE GitHub App** does sign-in + install + webhooks + tokens — retiring the separate OAuth
  App and `GITHUB_SERVICE_TOKEN`.
- **Per-repo hubs**: each connected repo is its own isolated workspace.
- **Access = repo collaborators**, read GitHub-native (`/user/installations`), not an ad-hoc probe.
- **Path-prefixed `/r/:owner/:repo/…` routes** + a `repoGate` middleware.
- **Push access ⇒ admin** (plan writes, promotes).
- **Soft-disconnect** on uninstall/removal — never a hard delete; reconnect restores.
- **Additive-then-flip cutover** — every step reversible; `memo-sphere.com` never has a broken window.

## 1. Core architecture

**The unit is a "connection."** Installing the App on a repo creates a row in `repos`
(`repo`, `installation_id`, `added_by`, `added_at`, `status`). Only connected repos have hubs.
No separate tenant entity — a tenant is a GitHub user; a hub is shared by the repo's collaborators.

**Request-repo context replaces `defaultRepo(env)`.** Hub-scoped endpoints move under a repo
path prefix: `/r/:owner/:repo/roadmap`, `/feed`, `/search`, promote/reject, etc. One `repoGate`
middleware (after `sessionGate`): parse `:owner/:repo`, authorize (connected **and**
collaborator), set `c.get("repo")`. Handlers read `c.get("repo")` where they call
`defaultRepo(c.env)` today — reusing the Phase 2 optional-`repo` params (mostly *swapping the
source of `repo`*, not new scoping logic).

**Auth opens up.** The single-org gate (`isActiveOrgMember`) is removed; any GitHub user signs
in via the App's user-authorization flow. Signing in grants nothing by itself — access is always
per-hub. Admin actions require **push** access to the repo.

**Access is GitHub-native.** A user's hubs = their installations of this App ∩ connected repos:
`GET /user/installations` → `GET /user/installations/:id/repositories` returns exactly the repos
this user can reach within each installation (the collaborator boundary, authoritative). `repoGate`
authorizes by checking the requested repo is in that set — cached in `repo_access` on a TTL (positive
+ negative caching), refreshed from GitHub, revoked on the next check once lost. Push flag comes from
the same payload.

## 2. GitHub App (single app)

**Sign-in** (the App's user-authorization flow): `login/oauth/authorize?client_id=<app>` → callback
`code` → exchange for a **user-to-server token** (refresh enabled) → identify the user (`GET /user`)
→ session + refreshable token. No org gate, no `repo` scope — the App's permissions + the user's own
access govern everything.

**Install + lifecycle.** "Connect repos" → the App's install/config page → callback
(`installation_id`) → mint an **installation token** → `GET /installation/repositories` → upsert
`repos` + `installations`. Webhooks keep it live: `installation_repositories` (added/removed) syncs
connections; `installation.deleted` soft-disconnects; `suspend/unsuspend` toggles `suspended_at`.

**Tokens.** User-to-server tokens (refreshed) for per-user listing/authorization; **installation
tokens** (App JWT from `GITHUB_APP_PRIVATE_KEY`, minted per installation, cached ~1h) for canopy's own
reads — the progress recompute + summarizer resolve `repo → installation_id → token`.
`GITHUB_SERVICE_TOKEN` retires.

**Data model** (migration `0024`): `repos.status` (`connected`/`disconnected`); `installations`
(`installation_id`, `account_login`, `account_type`, `suspended_at`); `repo_access` cache
(`login`, `repo`, `can_push`, `checked_at`).

**Secrets (user sets):** `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_APP_PRIVATE_KEY` (PKCS#8 PEM), `GITHUB_WEBHOOK_SECRET` (the App's). Retires:
`GITHUB_CLIENT_ID/SECRET`, `GITHUB_SERVICE_TOKEN`.

## 3. UI / onboarding

- **Empty state** (no connected repos): "Connect your first repo" → the App install page → callback
  lands on the hub-list.
- **Hub-list** (the developer home): the user's accessible connected repos, each a card opening its
  hub; a "Connect more repos" button → the App's install/config page.
- **A repo-hub** (`/r/:owner/:repo`): the existing developer sphere (globe/feed/roadmap/docs/triage)
  scoped to that repo, with a repo switcher in the header.
- **Mnemosphere side:** today's "Continue with GitHub to unlock developer mode" flows into the App's
  user-auth, then shows the hub-list.

## 4. Migration / cutover (must not break `memo-sphere.com`)

Ships **additively, then flips** — never a broken window:
1. **Grandfather the current repo.** Seed a connected `repos` row + `installations` row for
   `Jose-Gael-Cruz-Lopez/tesseract` (its live data is already at that `repo`); the user installs the App
   on it — it becomes a normal hub.
2. **Routes coexist → cut over.** Build `/r/:owner/:repo/*` (repoGate) alongside the flat routes (which
   keep serving `defaultRepo`). Deploy, verify against a real install, then flip the UI to hubs and remove
   the flat routes in a follow-up deploy.
3. **Login coexists → cut over.** Add App user-auth as a new path beside the working OAuth login; verify;
   then switch the UI's "Continue with GitHub" to it and retire the OAuth App.
4. **Order:** set secrets → deploy additive (new routes + login, flat still works) → verify e2e with a
   real install → flip UI + remove old paths → deploy. Every step reversible.

## 5. Testing

- **Unit** (built): App JWT / installation tokens / user-auth client / `authorizeRepo` / connect webhooks
  — all with mocked GitHub + a throwaway RSA key.
- **Integration**: `repoGate` allow/deny via seeded session + `repo_access`; install callback + webhooks
  sync; `/r` routes scope correctly.
- **E2E** (needs the real App): install on a test repo → hub appears → capture flows → uninstall → hub hides.
- **Migration**: the grandfathered repo's existing data shows in its hub post-cutover.

## Already built — the engine (branch `phase-3`, green, mocked-GitHub, additive)

| Commit | Increment |
|--------|-----------|
| `ed70631` | Data model `0024` — `repos.status`, `installations`, `repo_access` + row types |
| `564bc06` | App client `auth/app.ts` — App JWT (RS256) + installation-token mint/cache |
| `ddeb94d` | User-auth client — `exchangeUserCode`/`refreshUserToken` + `accessibleRepos` (paginated) |
| `bb97f4e` | Authorization core `auth/access.ts` — `authorizeRepo` (connected + collaborator, TTL cache) |
| `b6bd512` | Connect webhooks `auth/connect.ts` — `handleInstallationEvent` + webhook dispatch |

## Remaining (the wiring + UI)

1. **`repoGate` middleware** + restructure hub routes under `/r/:owner/:repo` (coexisting with flat).
2. **Install callback** (`/github/app/callback`) — sync installation + repos from the App (GitHub fetches).
3. **User-token storage** (`user_tokens`) + wiring `repoGate` → `accessibleRepos`.
4. **Login cutover** — App user-auth path, then retire the OAuth App (riskiest, last, behind Section 4).
5. **Connect-your-repos UI** (empty state, hub-list, switcher).
6. **Migration** — grandfather `Jose-Gael-Cruz-Lopez/tesseract`.

## User prerequisites (I can't do — GitHub account + secret-setting)

- Create the GitHub App: callbacks `…/auth/callback` + `…/github/app/callback`; webhook `…/webhook/github`;
  permissions Metadata/Issues/Pull-requests read; events `issues`, `pull_request`, `installation`,
  `installation_repositories`; user-auth + expire-tokens on; installable on any account.
- Set the 5 `GITHUB_APP_*` / webhook secrets.
