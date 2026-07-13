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

> Multi-repo (one canopy tracking several repos) is sub-project **B** — not yet
> built. Today canopy tracks **one** repo via `GITHUB_REPO`.

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

## 4. Create a GitHub OAuth app (so you can log in to /admin)

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

- **Application name:** anything (e.g. `My Canopy`)
- **Homepage URL:** `https://<worker-name>.<your-subdomain>.workers.dev`
  (you'll know the exact host after the first `npm run deploy`; edit it later)
- **Authorization callback URL:**
  `https://<worker-name>.<your-subdomain>.workers.dev/auth/callback`

Copy the **Client ID**, and **Generate a new client secret**.

## 5. Set secrets

```bash
npm exec wrangler secret put GITHUB_CLIENT_ID       # paste the OAuth Client ID
npm exec wrangler secret put GITHUB_CLIENT_SECRET   # paste the OAuth client secret
npm exec wrangler secret put COOKIE_SECRET          # any long random string, e.g. `openssl rand -hex 32`
```

Optional (features degrade gracefully if absent):

```bash
npm exec wrangler secret put GEMINI_API_KEY         # Google Gemini key — PR/issue summaries (else excerpt fallback)
npm exec wrangler secret put GITHUB_WEBHOOK_SECRET  # HMAC secret if you wire the GitHub webhook (/webhook/github)
```

Live roadmap progress (the scheduled recompute + the admin backfill) no longer uses a
standalone service token — it authenticates per connected repo via the GitHub App's own
installation tokens (`GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`; see the GitHub App setup
docs for connect-your-repos). Absent an App install for a repo, those two features simply
no-op / 503 for it — everything else still works.

## 6. Set your repo + who can log in (`wrangler.toml` `[vars]`)

```toml
[vars]
GITHUB_REPO = "Jose-Gael-Cruz-Lopez/your-repo"   # the repo canopy tracks
AUTH_ORG = ""                                    # leave EMPTY for a personal repo
ADMIN_LOGINS = "Jose-Gael-Cruz-Lopez"            # your GitHub login — who may log in when AUTH_ORG is empty
```

- **Personal repo (most common):** leave `AUTH_ORG` empty, put your GitHub login in
  `ADMIN_LOGINS`. Add teammates by appending logins (comma-separated).
- **Org repo:** set `AUTH_ORG` to your org; login is gated by **active membership**.
  `ADMIN_LOGINS` then only controls admin actions.
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
cp .dev.vars.example .dev.vars
# edit .dev.vars: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / COOKIE_SECRET (any values
# work locally); add DEV_LOGIN to act as yourself without OAuth:
echo 'DEV_LOGIN=Jose-Gael-Cruz-Lopez' >> .dev.vars

npm run db:migrate:local     # migrate the local D1
npm run seed                 # optional: seed sample data
npm run dev                  # build:app + wrangler dev on http://localhost:8787
```

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
