# Phase 1 — Login & Identity Split — Implementation Plan

> Executed inline in-session (TDD, commit per task). Spec:
> `docs/superpowers/specs/2026-07-09-phase1-login-identity-split-design.md`.

**Goal:** Google = Knowledge only; GitHub = Developer + Knowledge via the same-origin
GitHub session cookie (no token) on the fused Worker.

## Global Constraints
- Fused deploy only for the cookie path; token path stays for split-dev/remote.
- Canopy gate/auth model unchanged except the OAuth `return` redirect target.
- `return` validated to same-origin relative paths (open-redirect guard).
- Green: root `npx vitest run`, `cd canopy && npm test`, `npm run build:app`.

---

### Task 1: Canopy — `return` param on the OAuth round-trip

**Files:** `canopy/src/auth/routes.ts`; test `canopy/test/auth-return.test.ts`

- [ ] Add `safeReturnPath(raw): string` (exported) — returns `raw` iff it starts with
  `/` and not `//` and has no `:`; else `/admin/`.
- [ ] `GET /login`: `const ret = safeReturnPath(c.req.query("return"));` set httpOnly
  cookie `oauth_return=ret` (Lax, path `/`, maxAge 600, secure).
- [ ] `GET /callback`: read+delete `oauth_return` (default `/admin/`); success →
  `c.redirect(ret, 302)`; denial → `c.redirect(`${ret}${ret.includes("?")?"&":"?"}denied=1`, 302)`.
- [ ] Tests: `safeReturnPath` cases (`/`→`/`, `/admin/`→`/admin/`, `//e`→`/admin/`,
  `https://x`→`/admin/`, ``→`/admin/`); `/login?return=/` sets `oauth_return`.
- [ ] `cd canopy && npm test` green. Commit.

### Task 2: Mnemosphere — canopy-session reader

**Files:** `src/data/canopy-session.js` (new); test `tests/canopy-session.test.js`

- [ ] `getCanopySession(fetchImpl = globalThis.fetch)`: `GET /auth/me` (relative) with
  `{ credentials: 'include' }`; 200 → `{ login, name, avatar }` from JSON; else `null`;
  never throws.
- [ ] `sessionFromGitHub(me)`: `{ email: `${me.login}@users.noreply.github.com`, name:
  me.name || me.login, avatar: me.avatar ?? null, onboarded: true, provider: 'github' }`.
- [ ] Tests: 200 → parsed; 401 → null; throw → null; `sessionFromGitHub` shape.
- [ ] `npx vitest run tests/canopy-session.test.js` green. Commit.

### Task 3: Store dev-available flag + cookie reads

**Files:** `src/data/store.js`, `src/dev/canopy-api.js`; tests `tests/store.test.js`,
`tests/canopy-api.test.js`

- [ ] `store.js`: module-level `_devAvailable = false`; `setDevAvailable(b)`,
  `isDevAvailable()`. Reset in `resetStore()`.
- [ ] `canopy-api.js`: import `isDevAvailable`. `isConfigured()` → `!!getDevConfig().token
  || isDevAvailable()`. `get()`: `if (!token && !isDevAvailable()) return not-configured`;
  build `init = { method:'GET', headers:{} }`; if `token` → `headers.Authorization='Bearer '+token`
  else → `init.credentials='include'`; `base = (url||'').replace(/\/$/,'')`.
- [ ] Tests: session-available (no token) → `isConfigured()` true, `getDocs()` fetches
  `/docs` with `credentials:'include'` and no Authorization; token set → bearer as before.
- [ ] Root vitest green. Commit.

### Task 4: Boot gate + login button + mode-switch gating

**Files:** `src/main.js`, `src/auth/auth-view.js`, `src/app.js`, `src/ui/sidebar.js`,
`src/dev/dev-sidebar.js`; tests where feasible (`tests/auth-view.test.js`,
`tests/settings.test.js` unaffected)

- [ ] `main.js boot()`: after the Supabase branch, add:
  ```js
  const me = await getCanopySession();
  if (me) {
    setSession(sessionFromGitHub(me));
    setDevAvailable(true);
    history.replaceState(null, '', location.pathname);
    startApp(root); return;
  }
  if (new URLSearchParams(location.search).get('denied') === '1') {
    // fall through to showAuth; toast handled there or on next tick
  }
  ```
  (import `getCanopySession, sessionFromGitHub` from `./data/canopy-session.js`,
  `setDevAvailable` from store.)
- [ ] `auth-view.js buildOAuth()`: add "Continue with GitHub" button →
  `window.location.href = '/auth/login?return=/'`. Use `ICONS.github` (add a github glyph
  to `src/ui/icons.js` if absent).
- [ ] `app.js`: expose `ctx.devAvailable = () => store.isDevAvailable()`; when building the
  mode switch (sidebar workspace menu + dev-sidebar header), show **Developer** only if
  `devAvailable()`, else a **"Continue with GitHub to unlock"** item →
  `location.href='/auth/login?return=/'`.
- [ ] `sidebar.js` `openWorkspaceMenu`: gate the Developer switch entry the same way.
- [ ] Run root vitest (auth-view / settings still green). Commit.

### Task 5: Live end-to-end + redeploy

- [ ] `cd canopy && npm run build:app`; deploy (with user) or `wrangler dev` locally.
- [ ] Live: Google → knowledge only, Developer shows "Continue with GitHub"; GitHub sign-in
  → returns to `/`, both modes, dev sphere reads via cookie (no token).
- [ ] Full gates green. Commit.
