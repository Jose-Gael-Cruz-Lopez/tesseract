# Canopy — Setup & Connect to a Repo

Canopy is a self-contained Cloudflare Worker app (its own backend + web UI) that
lives in this `canopy/` folder and **deploys independently** of the Mnemosphere
site. This guide takes you from zero to a deployed canopy connected to one
GitHub repo. Everything runs from `canopy/`.

> Multi-repo (one canopy tracking several repos, one hub per repo in the dev
> sphere) is sub-project **B** — not yet built. Today canopy tracks **one** repo
> via `GITHUB_REPO`.

## 1. Prerequisites

- **Node 20+**
- A **Cloudflare account** (the free plan is enough).
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
Copy the `database_id` it prints into `canopy/wrangler.toml` under
`[[d1_databases]]`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "canopy"
database_id = "PASTE-YOUR-ID-HERE"
```

## 4. Create a GitHub OAuth app (so you can log in)

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

- **Application name:** anything (e.g. `My Canopy`)
- **Homepage URL:** `https://<worker-name>.<your-subdomain>.workers.dev`
  (you'll know the exact host after the first `npm run deploy`; you can edit this
  later)
- **Authorization callback URL:**
  `https://<worker-name>.<your-subdomain>.workers.dev/auth/callback`

Copy the **Client ID**, and **Generate a new client secret**.

## 5. Set secrets

Secrets are set with `wrangler secret put` (never committed). Required:

```bash
npm exec wrangler secret put GITHUB_CLIENT_ID       # paste the OAuth Client ID
npm exec wrangler secret put GITHUB_CLIENT_SECRET   # paste the OAuth client secret
npm exec wrangler secret put COOKIE_SECRET          # any long random string, e.g. `openssl rand -hex 32`
```

Optional (features degrade gracefully if absent):

```bash
npm exec wrangler secret put GITHUB_SERVICE_TOKEN   # a GitHub PAT with repo read — needed for live roadmap progress
npm exec wrangler secret put GEMINI_API_KEY         # Google Gemini key — enables PR/issue summaries (else excerpt fallback)
npm exec wrangler secret put GITHUB_WEBHOOK_SECRET  # HMAC secret if you wire the GitHub webhook (/webhook/github)
```

## 6. Set your repo + who can log in (`wrangler.toml` `[vars]`)

```toml
[vars]
GITHUB_REPO = "Jose-Gael-Cruz-Lopez/your-repo"   # the repo canopy tracks
AUTH_ORG = ""                                    # leave EMPTY for a personal repo
ADMIN_LOGINS = "Jose-Gael-Cruz-Lopez"            # your GitHub login — this is who may log in when AUTH_ORG is empty
```

- **Personal repo (most common):** leave `AUTH_ORG` empty and put your GitHub
  login in `ADMIN_LOGINS`. Login is gated by that allow-list. Add teammates by
  appending their logins (comma-separated).
- **Org repo:** set `AUTH_ORG` to your org name (e.g. `MyOrg`) and login is gated
  by **active membership** of that org. `ADMIN_LOGINS` then only controls admin
  actions (backfill, etc.).

## 7. Migrate + deploy

```bash
npm run db:migrate:remote    # applies migrations/*.sql to your remote D1
npm run deploy               # builds the web SPA, then wrangler deploy
```
The URL wrangler prints (e.g. `https://canopy.<you>.workers.dev`) is your
**canopy API base URL** — the dev sphere (sub-project C) will point at it.

Go to that URL, click sign in, authorize the GitHub OAuth app, and — because
your login is in `ADMIN_LOGINS` (or you're an `AUTH_ORG` member) — you're in.

## 8. Local development (no OAuth, no Cloudflare)

`wrangler dev` runs canopy against a local SQLite (Miniflare). Skip the GitHub
OAuth dance with `DEV_LOGIN`:

```bash
cd canopy
cp .dev.vars.example .dev.vars
# edit .dev.vars: set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / COOKIE_SECRET
# (any values work locally) and add this line to act as yourself without OAuth:
echo 'DEV_LOGIN=Jose-Gael-Cruz-Lopez' >> .dev.vars

npm run db:migrate:local     # migrate the local D1
npm run seed                 # optional: seed sample data
npm run dev                  # build web + wrangler dev on http://localhost:8787
```

`.dev.vars` is git-ignored. `DEV_LOGIN` only exists locally and is inert in
production — never set it as a deployed var/secret.

## 9. Repo link in the web UI (optional)

The UI links out to your repo (issues/PRs). Set it at web-build time:

```bash
VITE_REPO_URL="https://github.com/Jose-Gael-Cruz-Lopez/your-repo" npm run build:web
```
(Absent, links fall back to `https://github.com`.)

## Commands reference

| Command | What it does |
| --- | --- |
| `npm run dev` | build web + `wrangler dev` (local) |
| `npm run deploy` | build web + `wrangler deploy` (production) |
| `npm test` | Vitest against a real local Miniflare D1 |
| `npm run typecheck` | `tsc` over worker + web |
| `npm run db:create` | create the D1 database |
| `npm run db:migrate:local` / `:remote` | apply migrations |
| `npm run seed` | seed sample dev data |
