# Fused Deploy: Mnemosphere + Canopy on One Cloudflare Worker — Design

**Date:** 2026-07-09
**Status:** Approved (design decisions locked with user)

## Goal

Serve the entire product — the Mnemosphere UI (Knowledge + Developer modes) **and** the
canopy backend — from a **single Cloudflare Worker on one URL**, so it deploys once and
reads same-origin. This is the infrastructure counterpart to the already-unified UI: one
repo, one app, one deploy.

## Why

Today the UI is one app (two modes in one window), but the developer-data backend (canopy)
is a separately-hostable Worker, and Developer mode reaches it cross-origin via a configured
URL + token + CORS. The user's intent — "one app, one thing, everything connected" — is best
served by collapsing the two runtime pieces onto one origin. Canopy's Worker already serves
static assets via the `ASSETS` binding and already runs the API; we point that one Worker at
the Mnemosphere build and nest canopy's own admin UI under `/admin`.

## Architecture

One Cloudflare Worker (canopy's `src/index.ts`, unchanged routing), one URL:

```
https://<worker-url>
  /                     →  Mnemosphere UI (Knowledge + Developer modes)   [static asset root]
  /assets/*             →  Mnemosphere JS/CSS                              [static]
  /admin  /admin/*      →  Canopy admin SPA (Triage, mint token, roadmap)  [static, base=/admin/]
  /admin/assets/*       →  Canopy admin JS/CSS                             [static]
  /docs /feed /roadmap  →  Canopy HTTP API (Hono)                          [Worker]
  /me/* /search /doc/*  →  Canopy HTTP API (Hono)                          [Worker]
  /auth/*               →  Canopy GitHub OAuth + token mint               [Worker]
  /mcp                  →  Canopy MCP (bearer)                             [Worker]
  /webhook/github       →  GitHub event intake (HMAC)                     [Worker]
```

**Why this works with zero routing changes:** the assets binding serves *existing files*
first, then falls through to the Worker for any non-file path (`not_found_handling` default
is "none" when a Worker `main` is present). Mnemosphere has **no path-based routes** (all
client-side state on `/`), so it never shadows a canopy API path. Canopy's admin UI is
**hash-routed** (`#feed`, `#triage`, `#docs`), so it loads once at `/admin/` and navigates by
fragment — no server round-trips, no SPA-fallback config needed.

## Components / Changes

Four bounded changes. No change to canopy's Worker fetch handler, gate, or auth model.

### 1. Rebase canopy's admin UI to `/admin/`
- `canopy/web/vite.config.ts`: add `base: "/admin/"`, set `build.outDir` to
  `<dist>/admin` (so the admin build lands in the `/admin` subtree), keep `emptyOutDir: true`
  (empties only `dist/admin`).
- `canopy/web/src/main.ts`: the one post-login `history.replaceState({}, "", "/")` (clears the
  OAuth `?code=…` query after callback) becomes `"/admin/"` so the admin SPA stays under its
  base. Hash routing is base-agnostic and needs no other change.

### 2. Merged deploy build
- A build step produces the combined asset tree in `canopy/web/dist`:
  1. Build the Mnemosphere UI (repo root `npm run build` → repo `dist/`).
  2. Build the canopy admin UI (`base:/admin/`) → `canopy/web/dist/admin/`.
  3. Copy the Mnemosphere `dist/*` into `canopy/web/dist/` root (index.html + `assets/`),
     leaving `canopy/web/dist/admin/` intact.
- Wire this as `canopy` scripts: `build:app` (the three steps above) and point
  `deploy`/`dev` at it. `wrangler.toml` `[assets] directory` stays `./web/dist` — it now holds
  both trees.
- The Mnemosphere build embeds its Supabase URL + **publishable** key (existing `VITE_` env);
  no secret enters the bundle.

### 3. Developer mode reads same-origin
- `src/dev/canopy-api.js`: when the stored canopy URL is **blank**, read **relative** paths
  (`/docs`, `/feed`, …) — i.e. same-origin. A non-blank URL still targets that origin
  (local split-dev / a remote canopy). `isConfigured()` requires a **token** (URL optional).
- `src/data/store.js`: `getDevConfig()` unchanged shape `{ url, token }`; url may be `''`.
- Net effect in the fused deploy: paste a token in Developer settings, leave URL blank →
  reads hit the same Worker. CORS is unnecessary (kept in canopy for the split-dev case).

### 4. Deploy (one Worker)
- The existing SETUP steps, now for one Worker: `wrangler login` → `db:create` (paste id) →
  GitHub OAuth app → set vars (`GITHUB_REPO`, `ADMIN_LOGINS`) + secrets
  (`GITHUB_CLIENT_ID/SECRET`, `COOKIE_SECRET`) → `db:migrate:remote` → `deploy`.
- Post-deploy identity config (user, in consoles, as today): add `https://<worker-url>` to
  Supabase Auth redirect URLs + Google authorized origins (so the app's Google login works on
  the new origin), and set the GitHub OAuth app callback to `https://<worker-url>/auth/callback`.

## Data flow (Developer mode, fused)

1. User opens `https://<worker-url>/` → Mnemosphere (Google/Supabase gate as today).
2. One-time: user opens `/admin`, logs in with GitHub, mints a read token, pastes it into
   Mnemosphere → Settings → Developer (URL left blank).
3. Developer mode: `devProvider` → `canopy-api` GETs `/docs`,`/roadmap`,`/feed`,`/needs-triage`,
   `/me/dashboard` **same-origin** with `Authorization: Bearer <token>` → `dev-graph` builds the
   sphere. Unchanged from today except origin + no CORS.

## Auth (unchanged model; one-time token)

Three independent auth surfaces coexist on the one origin, exactly as they do today — none is
modified:
- **Supabase/Google** gates the Mnemosphere app shell (`/`).
- **Bearer token** authorizes Developer-mode reads (minted at `/admin`, pasted once).
- **Canopy session cookie** (GitHub OAuth) gates `/admin` and the canopy HTTP API/promote routes.
- **MCP bearer** / **webhook HMAC** unchanged.

Unifying Supabase and canopy identities into a single sign-in is **explicitly out of scope**
(the deferred "identity" project).

## Error handling / edge cases

- **Blank URL in local split-dev:** relative reads would hit the Vite dev origin (`:5173`),
  not canopy (`:8787`). Mitigation: in local split-dev the user sets an explicit URL
  (`http://localhost:8787`); blank = same-origin is the *fused-deploy* default. Documented.
- **Asset/API shadowing:** none — verified Mnemosphere has no path routes; canopy API paths
  are not files. `/admin/` resolves to `/admin/index.html` via the assets binding.
- **`emptyOutDir` clobber:** canopy admin builds into `dist/admin` (empties only that subtree);
  the Mnemosphere copy writes root files alongside, never deleting `admin/`. Build order is
  fixed in the script to prevent races.
- **Supabase redirect on new origin:** Google login fails until the Worker origin is added to
  Supabase redirect URLs — called out as a required post-deploy step.

## Testing

- **Canopy web rebase:** build canopy web with `base:/admin/`; assert emitted `index.html`
  references `/admin/assets/…` (not `/assets/…`). Existing canopy tests stay green.
- **Same-origin reads:** unit-test `makeCanopyApi` with a blank URL — asserts it fetches the
  relative path (`/docs`), and with a set URL asserts absolute. `isConfigured()` true with a
  token + blank URL.
- **Merged build:** a smoke check that `canopy/web/dist/index.html` (Mnemosphere) and
  `canopy/web/dist/admin/index.html` (canopy) both exist after `build:app`.
- **Local end-to-end:** `wrangler dev` serving the merged tree — `/` renders Mnemosphere,
  `/admin` renders canopy, Developer mode (blank URL + token) reads same-origin.
- Full gates: root `npx vitest run`, `cd canopy && npm test`, both builds.

## Out of scope (future cycles)

- **Identity unification** (single sign-in across knowledge + developer) — the deferred project.
- **Sub-project B** (multi-repo in canopy).
- **Developer-mode write-back** (promote/triage/curate from Mnemosphere) — reads only.
- Deploying the split (two-host) topology — the fused Worker supersedes it; split-dev remains
  available locally via an explicit URL.
