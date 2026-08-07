# Deploy — One Fused Worker (Mnemosphere UI + Canopy)

This deploys the **whole product as one Cloudflare Worker on one URL**:

```
https://<your-worker>.workers.dev
  /            → the Mnemosphere UI (Knowledge + Developer modes)
  /admin       → canopy's admin UI (Triage, mint token, roadmap authoring)
  /docs /feed /roadmap /me/* /auth/* /mcp /webhook/github → canopy backend
```

One `npm run deploy` builds and ships everything. Because the UI and canopy share
one origin, Developer mode reads canopy **same-origin** — no CORS, no separate host.
Everything runs from `canopy/`.

> **Multi-repo shipped** (Phase 3): connect any number of repos through the GitHub App
> and each gets its own hub at `/r/:owner/:repo` (and agent surface at
> `/mcp/:owner/:repo`). `GITHUB_REPO` remains only as the flat single-tenant
> default repo for the legacy admin-gated flat routes.

## 1. Prerequisites

- **Node 20+**
- A **Cloudflare account** (free plan is enough).
- Log wrangler into your account:
  ```bash
  cd canopy
  npx wrangler login
  ```

## 2. Install

```bash
cd canopy
npm install
```

## 3. Create your D1 database

```bash
npm run db:create        # runs: wrangler d1 create canopy
```
Copy the `database_id` it prints into `canopy/wrangler.toml` under `[[d1_databases]]`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "canopy"
database_id = "PASTE-YOUR-ID-HERE"
```

## 4. Create a GitHub App (sign-in AND repo connections use it)

Sign-in is the GitHub App user-authorization flow — a legacy OAuth App will NOT
work (`/auth/login` 503s `app_not_configured` without the App client id). GitHub →
**Settings → Developer settings → GitHub Apps → New GitHub App**:

- **App name:** anything (its URL slug becomes `GITHUB_APP_SLUG`)
- **Homepage URL:** `https://<worker-name>.<your-subdomain>.workers.dev`
  (you'll know the exact host after the first `npm run deploy`; edit it later)
- **Callback URLs** (add BOTH): `https://<host>/auth/callback` and
  `https://<host>/auth/app/callback` — check **Request user authorization (OAuth)
  during installation**.
- **Webhook URL** (optional but recommended): `https://<host>/webhook/github`,
  with a secret you generate (becomes `GITHUB_WEBHOOK_SECRET`).
- **Permissions:** Repository → Issues (read), Pull requests (read), Metadata
  (read). Subscribe to Issues + Pull request events if you enabled the webhook.

Copy the **App ID** and **Client ID**, **generate a client secret**, and
**generate a private key** (downloads a PKCS#1 `.pem` — convert it:
`openssl pkcs8 -topk8 -nocrypt -in downloaded.pem`).

## 5. Set secrets

Pipe values — an interactive `secret put` through an automation shell silently
stores an EMPTY value (see `docs/runbooks/secrets-and-observability.md`):

```bash
printf '%s' 'THE-CLIENT-ID'     | npm exec wrangler secret put GITHUB_APP_CLIENT_ID
printf '%s' 'THE-CLIENT-SECRET' | npm exec wrangler secret put GITHUB_APP_CLIENT_SECRET
printf '%s' 'THE-APP-ID'        | npm exec wrangler secret put GITHUB_APP_ID
cat converted-pkcs8.pem         | npm exec wrangler secret put GITHUB_APP_PRIVATE_KEY
printf '%s' "$(openssl rand -hex 32)" | npm exec wrangler secret put COOKIE_SECRET
```

Optional (features degrade gracefully if absent):

```bash
printf '%s' 'THE-KEY'    | npm exec wrangler secret put GEMINI_API_KEY        # PR/issue summaries (else excerpt fallback)
printf '%s' 'THE-SECRET' | npm exec wrangler secret put GITHUB_WEBHOOK_SECRET # HMAC for /webhook/github
```

Verify what actually landed with `GET /admin/selfcheck` after deploy — it
functionally exercises every secret (a present-but-wrong value is the failure
mode `wrangler secret list` cannot see). The retired `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` OAuth-App pair is gone — do not set it.

## 6. Set your repo + who can log in (`wrangler.toml` `[vars]`)

```toml
[vars]
GITHUB_REPO = "Jose-Gael-Cruz-Lopez/your-repo"   # the flat single-tenant default repo
ADMIN_LOGINS = "Jose-Gael-Cruz-Lopez"            # admin actions + the flat admin surfaces (case-insensitive)
LOGIN_ALLOWLIST = ""                             # EMPTY = open signup (any GitHub user); set logins to gate sign-in
GITHUB_APP_SLUG = "your-app-slug"                # the "Connect repos" install link
```

- **Sign-in gate:** `LOGIN_ALLOWLIST` is the ONLY login gate — empty means any
  GitHub user who completes the App flow gets a session (they see only repos
  they're collaborators on). `ADMIN_LOGINS` does not gate login; it gates admin
  actions and the flat single-tenant surfaces (including bare `/mcp`).
- `AUTH_ORG` is display-only (echoed in `/auth/me`) — it is NOT a login gate.
- `CORS_ORIGINS` is **not needed** for the fused deploy (Developer mode reads
  same-origin). Only set it if you also run the UI on a *different* origin.

## 7. Migrate + deploy (one Worker)

```bash
npm run db:migrate:remote    # applies migrations/*.sql to your remote D1
npm run deploy               # build:app (Mnemosphere UI + canopy admin) → wrangler deploy
```
The URL wrangler prints (e.g. `https://canopy.<you>.workers.dev`) is your **whole
app**: the Mnemosphere UI at `/`, canopy's admin at `/admin`.

## 8. Point the app's Google sign-in at the new origin

The Mnemosphere UI uses your existing Supabase/Google login. For it to work on the
Worker origin, add `https://<your-worker>.workers.dev` to:

- **Supabase** → Authentication → URL Configuration → **Redirect URLs** (and Site URL).
- **Google Cloud** → your OAuth client → **Authorized JavaScript origins** and
  **Authorized redirect URIs** (Supabase's callback).

(These are the same consoles you configured for local dev — you're just adding the
production origin.)

## 9. Connect Developer mode (one-time token)

The Mnemosphere UI is already served by canopy, so Developer mode reads it
same-origin — you just need a read token:

1. Open **`https://<your-worker>.workers.dev/admin`**, sign in with GitHub.
2. In canopy Settings, **Generate token** (shown once; starts with `canopy_mcp_`).
3. Back in the app → **Settings → Developer**: **leave the Canopy URL blank**
   (blank = this same site) and paste the **token**. "Test connection", then switch
   to **Developer** mode.

## 10. Local development (fused, no OAuth, no Cloudflare)

`wrangler dev` serves the same fused app against a local SQLite (Miniflare). Skip
the GitHub OAuth dance with `DEV_LOGIN`:

```bash
cd canopy
cp .dev.vars.example .dev.vars   # COOKIE_SECRET (any value works locally) + DEV_LOGIN
                                 # (skips the OAuth dance and acts as that seeded user)

npm run db:migrate:local              # migrate the local D1
npm run seed                          # optional: seed sample data
CANOPY_ALLOW_NO_SUPABASE=1 npm run dev  # build:app + wrangler dev on http://localhost:8787
```

The `CANOPY_ALLOW_NO_SUPABASE=1` override is required unless the repo root has a
`.env.local` with `VITE_SUPABASE_URL`: the fused build otherwise REFUSES to run,
because a build without the var silently ships Google sign-in compiled out — fine
locally (the demo email flow still works), fatal in production.

Then open `http://localhost:8787/` (UI) and `/admin` (canopy). In Developer settings
leave the URL blank and paste any token (`DEV_LOGIN` authorizes local reads).
`.dev.vars` is git-ignored; `DEV_LOGIN` is inert in production — never deploy it.

## 11. Repo link in canopy's admin UI (optional)

canopy's admin links out to your repo (issues/PRs):

```bash
VITE_REPO_URL="https://github.com/Jose-Gael-Cruz-Lopez/your-repo" npm run deploy
```
(Absent, links fall back to `https://github.com`.)

## Commands reference

| Command | What it does |
| --- | --- |
| `npm run dev` | build:app (UI + admin) + `wrangler dev` (local, :8787) |
| `npm run deploy` | build:app + `wrangler deploy` (production, one Worker) |
| `npm run build:app` | build the fused asset tree only (UI at `/`, admin at `/admin`) |
| `npm run build:web` | build only canopy's admin SPA (`/admin`) |
| `npm test` | Vitest against a real local Miniflare D1 |
| `npm run typecheck` | `tsc` over worker + web |
| `npm run db:create` | create the D1 database |
| `npm run db:migrate:local` / `:remote` | apply migrations |
| `npm run seed` | seed sample dev data |
