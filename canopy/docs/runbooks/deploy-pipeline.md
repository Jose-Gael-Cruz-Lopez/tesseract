# Runbook — the deploy pipeline (Workers Builds)

How code actually reaches production. Until this file existed, the pipeline was
configured only in the Cloudflare dashboard — bus-factor-1 knowledge that the
2026-08 repo audit flagged. This is the in-repo record; if the dashboard and
this file disagree, fix one of them and say which in the commit.

## The pipeline

**Cloudflare Workers Builds** deploys the Worker on every push to `main` of
`Jose-Gael-Cruz-Lopez/tesseract`. There is NO GitHub Actions workflow (the one
that briefly existed was deleted in `a9cbc9b` when Workers Builds took over).
The dashboard side lives at **Workers & Pages → canopy → Settings → Builds**.

What a build does (mirrors `canopy/package.json`'s `deploy` script):

1. `npm run build:app` (`canopy/scripts/build-app.mjs`) — builds the ROOT
   Mnemosphere Vite app into `<repo>/dist`, wipes `canopy/web/dist`, builds the
   canopy admin SPA (Vite base `/admin/`) into `web/dist/admin`, then copies the
   Mnemosphere build over `web/dist`'s root. One asset tree, two apps.
2. `wrangler deploy` — ships `src/index.ts` + the `[assets]` tree.

## Build-time environment variables (dashboard-side — REQUIRED)

The fused Mnemosphere build compiles Supabase (Google sign-in + workspace cloud
sync) IN or OUT at build time: `src/data/supabase.js` reads
`import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and a build
without them constant-folds `supabaseEnabled` to false and tree-shakes
supabase-js away entirely — Google sign-in silently disappears.

These are set as **build environment variables in the Workers Builds settings**
(verified 2026-08-06 by probing the live bundle: prod contains the Supabase URL;
a local build without `.env.local` contains zero "supabase" strings):

- `VITE_SUPABASE_URL` — the Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — the publishable (RLS-gated, browser-safe) key
- `VITE_REPO_URL` (optional) — the GitHub repo the admin SPA links out to

For a **manual** deploy from a workstation (`cd canopy && npm run deploy`), the
same values must exist in `<repo>/.env.local` — `build-app.mjs` refuses to build
a fused tree without `VITE_SUPABASE_URL` (the audit's build guard) precisely
because prod would otherwise lose Google sign-in with no error.

## What a deploy does NOT do

- **It never applies D1 migrations.** `npm run db:migrate:remote` is a separate,
  manual step that silently no-ops on the wrong Cloudflare account — the cause
  of the 2026-07 ten-day auth outage. After merging any migration-carrying PR,
  follow the checklist in `secrets-and-observability.md` (§ Migration gotcha).
  The selfcheck's `D1_MIGRATIONS` probe alerts on drift within one 6h cron run.
- **It never touches secrets.** `wrangler secret put` only, piped (see the
  secrets runbook).

## Verifying a deploy landed

- `npx wrangler versions list` — a new version, timestamped just now.
- The live bundle hash changes: `curl -s https://memo-sphere.com/ | grep -o 'assets/index-[^"]*\.js'`.
- `GET /admin/selfcheck` (admin session or bearer) — the functional health of
  every secret + the migration ledger.
