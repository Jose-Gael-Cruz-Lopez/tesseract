# Canopy Sub-project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Inline execution is chosen because every task runs canopy's own toolchain (`npm install`, `vitest` on `@cloudflare/vitest-pool-workers`, `wrangler dev`) and must react to real output — there is little independent parallelism to fan out.

**Goal:** Bring canopy into this repo as an isolated `canopy/` subfolder, remove the hardcoded `SaplingLearn` org lock so the repo owner can actually log in, and ship a copy-paste `canopy/SETUP.md` that connects it to one repo — verified to build, type-check, test, and run under local `wrangler dev`.

**Architecture:** Canopy stays a standalone Cloudflare Worker app in `canopy/` with its own `package.json`/build/deploy. The Mnemosphere app (repo root) is never touched except `.gitignore`. The only code change to canopy is parameterizing its GitHub-org access gate into an `AUTH_ORG` env var with an `ADMIN_LOGINS` allow-list fallback for personal accounts.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler), Hono, Cloudflare D1, Vitest (`@cloudflare/vitest-pool-workers`), Vite (canopy's own web build).

## Global Constraints

- **Do not modify the Mnemosphere app** (repo root `src/`, `index.html`, root `package.json`, root `vitest`). The only root change permitted is `.gitignore`.
- **Canopy source of truth:** the clone at `/private/tmp/claude-501/-Users-josecruz-Desktop-tesseract/0410dbf8-056c-41e1-8c21-4a1ca0e4b965/scratchpad/canopy` (referred to below as `$CANOPY_SRC`). Copy everything **except** its `.git/` and `node_modules/`.
- **All canopy commands run from `canopy/`** (`cd canopy && …`), never repo root.
- **No new hardcoded org/owner identity.** Access identity comes only from env: `AUTH_ORG` (org-membership mode) or `ADMIN_LOGINS` (allow-list mode). Empty `AUTH_ORG` ⇒ allow-list mode.
- **Never commit secrets.** `canopy/.dev.vars`, `canopy/.wrangler/`, `canopy/web/dist/`, `canopy/node_modules/` must be git-ignored before the first `git add`.
- **Owner's GitHub login for docs/examples:** `Jose-Gael-Cruz-Lopez`. Fork path: `Jose-Gael-Cruz-Lopez/canopy`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Bring canopy in + isolate it + baseline verify

**Files:**
- Create: `canopy/**` (copied from `$CANOPY_SRC`, minus `.git/` and `node_modules/`)
- Modify: `.gitignore` (repo root — add canopy ignores)

- [ ] **Step 1: Copy canopy in (exclude .git and node_modules)**

```bash
CANOPY_SRC="/private/tmp/claude-501/-Users-josecruz-Desktop-tesseract/0410dbf8-056c-41e1-8c21-4a1ca0e4b965/scratchpad/canopy"
cd /Users/josecruz/Desktop/tesseract
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'web/dist' --exclude '.wrangler' --exclude '.dev.vars' "$CANOPY_SRC"/ canopy/
ls canopy/            # expect: src web shared migrations wrangler.toml package.json tsconfig*.json test plugins scripts README.md CLAUDE.md ...
```

- [ ] **Step 2: Add canopy ignores to the repo `.gitignore`**

Append to `/Users/josecruz/Desktop/tesseract/.gitignore`:

```
# canopy (Cloudflare Worker sub-app — builds & deploys independently)
canopy/node_modules/
canopy/web/dist/
canopy/.wrangler/
canopy/.dev.vars
```

- [ ] **Step 3: Verify the ignores catch canopy's secret/build paths**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract
git check-ignore canopy/.dev.vars canopy/node_modules/x canopy/web/dist/x canopy/.wrangler/x
```
Expected: all four paths echoed back (ignored). If any is missing, fix `.gitignore`.

- [ ] **Step 4: Install canopy deps and run its baseline suite (unchanged code)**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
npm install
npm run typecheck
npm test
```
Expected: `npm install` succeeds; `typecheck` clean; `npm test` passes (this is the *upstream* suite, still Sapling-pinned — the "pins the org constant" test in `test/auth-github.test.ts` still asserts `SaplingLearn`; it passes here and Task 2 updates it). If `@cloudflare/vitest-pool-workers` cannot start in this sandbox, capture the exact error and STOP — report it; do not proceed to fake a pass.

- [ ] **Step 5: Commit the bring-in**

```bash
cd /Users/josecruz/Desktop/tesseract
git add .gitignore canopy
git commit -m "feat(canopy): bring canopy into canopy/ as an isolated sub-app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Parameterize the GitHub-org access gate (AUTH_ORG + allow-list)

**Files:**
- Modify: `canopy/src/env.ts`
- Modify: `canopy/src/auth/github.ts:3` (remove `SAPLING_ORG`), `:57` (`isActiveOrgMember` takes an org)
- Modify: `canopy/src/auth/principal.ts` (add `isAllowed`)
- Modify: `canopy/src/auth/routes.ts:6,61,77` (use `isAllowed`; `/me` org from env)
- Modify: `canopy/test/auth-github.test.ts` (drop the `SAPLING_ORG` assertion)
- Test: `canopy/test/auth-allow.test.ts` (new — the allow-list gate)

**Interfaces:**
- Produces: `isAllowed(env: Env, token: string, login: string): Promise<boolean>` in `principal.ts` — the single login-decision used by the OAuth callback. `AUTH_ORG` set ⇒ active-member of that org; `AUTH_ORG` empty ⇒ `isAdmin(env, login)` (the `ADMIN_LOGINS` allow-list). Consumed by C/D indirectly via the deployed instance.
- Produces: `isActiveOrgMember(token: string, org: string): Promise<boolean>` in `github.ts` (org now a parameter).

- [ ] **Step 1: Write the failing test for the allow-list gate**

Create `canopy/test/auth-allow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Env } from "../src/env";
import { isAllowed } from "../src/auth/principal";

// Minimal Env stub — only the fields isAllowed reads in allow-list mode.
function env(over: Partial<Env>): Env {
  return { AUTH_ORG: "", ADMIN_LOGINS: "", DB: {}, ASSETS: {}, GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", COOKIE_SECRET: "", ...over } as unknown as Env;
}

describe("isAllowed (personal / allow-list mode: AUTH_ORG empty)", () => {
  it("allows a login on the ADMIN_LOGINS allow-list", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "Jose-Gael-Cruz-Lopez, someoneelse" }), "unused-token", "Jose-Gael-Cruz-Lopez");
    expect(ok).toBe(true);
  });

  it("rejects a login not on the allow-list", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "Jose-Gael-Cruz-Lopez" }), "unused-token", "randomPerson");
    expect(ok).toBe(false);
  });

  it("rejects everyone when the allow-list is empty (fails closed)", async () => {
    const ok = await isAllowed(env({ ADMIN_LOGINS: "" }), "unused-token", "anyone");
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect failure (isAllowed doesn't exist yet)**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
npx vitest run test/auth-allow.test.ts
```
Expected: FAIL — `isAllowed` is not exported from `principal.ts`.

- [ ] **Step 3: Add `AUTH_ORG` to the Env type**

In `canopy/src/env.ts`, add after the `GITHUB_REPO?` line:

```ts
  AUTH_ORG?: string;      // GitHub org whose active members may log in. Empty/absent ⇒ allow-list mode (ADMIN_LOGINS gates login).
```

- [ ] **Step 4: Make `isActiveOrgMember` take the org as a parameter**

In `canopy/src/auth/github.ts`: delete line 3 (`export const SAPLING_ORG = "SaplingLearn";`) and change the function:

```ts
/** True only if the token's owner is an ACTIVE member of `org`. */
export async function isActiveOrgMember(token: string, org: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/user/memberships/orgs/${org}`, {
    headers: { authorization: `Bearer ${token}`, accept: GH_API, "user-agent": USER_AGENT },
  });
  if (!res.ok) return false; // 404 => not a member
  const data = (await res.json()) as { state?: string };
  return data.state === "active"; // a pending invite does not count
}
```

- [ ] **Step 5: Add `isAllowed` to `principal.ts`**

In `canopy/src/auth/principal.ts`, add the import at the top and the function after `isAdmin`:

```ts
import { isActiveOrgMember } from "./github";
```
```ts
/**
 * The login gate for the OAuth callback. When AUTH_ORG is set, only active
 * members of that GitHub org may log in. When AUTH_ORG is empty (personal /
 * multi-owner repos), fall back to the ADMIN_LOGINS allow-list. Fails closed.
 */
export async function isAllowed(env: Env, token: string, login: string): Promise<boolean> {
  const org = (env.AUTH_ORG ?? "").trim();
  if (org) return isActiveOrgMember(token, org);
  return isAdmin(env, login);
}
```

- [ ] **Step 6: Use `isAllowed` in the OAuth callback + fix `/me`**

In `canopy/src/auth/routes.ts`:
- Line 6 import: change `import { buildAuthorizeUrl, exchangeCode, getUser, isActiveOrgMember } from "./github";` → `import { buildAuthorizeUrl, exchangeCode, getUser } from "./github";`
- Line 4 import: change `import { isAdmin } from "./principal";` → `import { isAdmin, isAllowed } from "./principal";`
- Remove the `SAPLING_ORG` import (line 10: `import { SAPLING_ORG } from "./github";`).
- Line 61: `if (!(await isActiveOrgMember(token))) return c.redirect("/?denied=1", 302);` → `if (!(await isAllowed(c.env, token, ghUser.login))) return c.redirect("/?denied=1", 302);`
- Line 77 (`/me`): `org: SAPLING_ORG,` → `org: (c.env.AUTH_ORG ?? "").trim() || null,`

- [ ] **Step 7: Update the upstream github test (drop the org constant assertion)**

In `canopy/test/auth-github.test.ts`: change the import to `import { buildAuthorizeUrl } from "../src/auth/github";` and delete the entire `it("pins the org constant", …)` block.

- [ ] **Step 8: Run the new + touched tests, then the full suite**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
npx vitest run test/auth-allow.test.ts test/auth-github.test.ts
npm run typecheck
npm test
```
Expected: `auth-allow` 3/3 pass; `auth-github` passes; typecheck clean; full suite green (no remaining reference to `SAPLING_ORG` or the old `isActiveOrgMember(token)` arity). If any file still imports `SAPLING_ORG`, `grep -rn "SAPLING_ORG" src test` and fix.

- [ ] **Step 9: Commit**

```bash
cd /Users/josecruz/Desktop/tesseract
git add canopy/src/env.ts canopy/src/auth canopy/test/auth-allow.test.ts canopy/test/auth-github.test.ts
git commit -m "feat(canopy): parameterize the org gate as AUTH_ORG with ADMIN_LOGINS fallback

Empty AUTH_ORG uses the ADMIN_LOGINS allow-list so a personal-account owner can
log in; a set AUTH_ORG keeps the org-membership check.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Scrub user-facing Sapling copy + repo URL

**Files:**
- Modify: `canopy/web/src/github.ts:3` (REPO_URL from Vite env)
- Modify: `canopy/web/src/render.ts` (lines ~258, ~270, ~271, ~290, ~981 — neutral wording / fork path)

- [ ] **Step 1: Make the web REPO_URL configurable (Vite env, neutral fallback)**

In `canopy/web/src/github.ts`, change:
```ts
export const REPO_URL = "https://github.com/SaplingLearn/sapling";
```
to:
```ts
// Set VITE_REPO_URL at build time (see canopy/SETUP.md); falls back to the repo root.
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com";
```

- [ ] **Step 2: Neutralize the user-facing Sapling strings in render.ts**

Apply these exact replacements in `canopy/web/src/render.ts`:
- `The shared source of truth for the Sapling team.` → `The shared source of truth for your team.`
- `Canopy is limited to the Sapling team.` → `You don't have access to this Canopy.`
- `Your GitHub account isn't a member of the <span style="font-family:var(--mono);font-size:12.5px">SaplingLearn</span> organization, so there's nothing here for you yet.` → `Your GitHub account isn't on the access list for this Canopy yet. Ask the owner to add you (org membership or the ADMIN_LOGINS allow-list).`
- `Verifying Sapling membership&hellip;` → `Verifying access&hellip;`
- `/plugin marketplace add SaplingLearn/canopy` → `/plugin marketplace add Jose-Gael-Cruz-Lopez/canopy`

- [ ] **Step 3: Confirm no user-facing "Sapling" strings remain (comments are OK)**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
grep -rn "Sapling" web/src/ | grep -v "^web/src/canopy.css" | grep -vi "// "
```
Expected: no matches (only the `canopy.css` theme comment and code comments may reference Sapling; those are fine). Then build the web bundle to prove it still compiles:
```bash
npm run build:web
```
Expected: Vite build succeeds, `web/dist/` produced.

- [ ] **Step 4: Commit**

```bash
cd /Users/josecruz/Desktop/tesseract
git add canopy/web/src/github.ts canopy/web/src/render.ts
git commit -m "chore(canopy): neutralize user-facing Sapling copy; repo URL from VITE_REPO_URL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Make wrangler.toml deployment-neutral

**Files:**
- Modify: `canopy/wrangler.toml`

- [ ] **Step 1: Blank the Sapling database id and turn config into owner-set placeholders**

Edit `canopy/wrangler.toml`:
- `database_id = "80386dc4-deef-461d-932a-0670d22ddf83"` → `database_id = ""   # set to YOUR D1 id from `npm run db:create` (see SETUP.md)`
- Under `[vars]` replace the Sapling values:
  ```toml
  [vars]
  # "owner/repo" the roadmap/progress read from. Set to your repo.
  GITHUB_REPO = ""
  # GitHub org whose active members may log in. Leave empty for a personal repo
  # (then ADMIN_LOGINS gates login instead).
  AUTH_ORG = ""
  # Comma-separated GitHub logins allowed in (login gate when AUTH_ORG is empty)
  # and for admin actions. Set to your GitHub login to start.
  ADMIN_LOGINS = ""
  ```

- [ ] **Step 2: Verify wrangler can parse the config (dry, no deploy)**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
npx wrangler deploy --dry-run --outdir /tmp/canopy-dryrun 2>&1 | tail -20
```
Expected: wrangler parses `wrangler.toml` and bundles the Worker (a dry-run does not need Cloudflare auth or a real `database_id`). If it errors specifically on the empty `database_id`, note it in SETUP.md as "must be filled before deploy" and confirm the error is only about deploy-time binding, not a parse failure.

- [ ] **Step 3: Commit**

```bash
cd /Users/josecruz/Desktop/tesseract
git add canopy/wrangler.toml
git commit -m "chore(canopy): blank Sapling database_id + config to owner-set placeholders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Write `canopy/SETUP.md` (connect it to one repo)

**Files:**
- Create: `canopy/SETUP.md`

- [ ] **Step 1: Write the setup guide**

Create `canopy/SETUP.md` with these sections (fill each with the real commands — no placeholders):

1. **Prerequisites** — Node 20+, a Cloudflare account (free), `npx wrangler login`.
2. **Install** — `cd canopy && npm install`.
3. **Create the D1 database** — `npm run db:create`; copy the printed `database_id` into `wrangler.toml`'s `[[d1_databases]]` block.
4. **Create a GitHub OAuth app** — github.com → Settings → Developer settings → OAuth Apps → New. Homepage `https://<worker-name>.<subdomain>.workers.dev`; **Authorization callback URL** `https://<worker-name>.<subdomain>.workers.dev/auth/callback`. Copy the Client ID; generate a Client secret.
5. **Set secrets** — `npm exec wrangler secret put GITHUB_CLIENT_ID` (and `GITHUB_CLIENT_SECRET`, `COOKIE_SECRET` = any long random string). Optional: `GEMINI_API_KEY` (PR/issue summaries), `GITHUB_SERVICE_TOKEN` (a PAT with repo read — required for the roadmap to pull live progress), `GITHUB_WEBHOOK_SECRET`.
6. **Set vars in `wrangler.toml`** — `GITHUB_REPO="owner/repo"`; `AUTH_ORG=""` for a personal repo (or your org name); `ADMIN_LOGINS="Jose-Gael-Cruz-Lopez"` (your GitHub login — this is who can log in when `AUTH_ORG` is empty).
7. **Migrate + deploy** — `npm run db:migrate:remote` then `npm run deploy`. The Worker URL it prints is your canopy API base (used later by the dev sphere).
8. **Local dev (no OAuth)** — `cp .dev.vars.example .dev.vars`, set `GITHUB_CLIENT_ID`/`SECRET`/`COOKIE_SECRET` and add `DEV_LOGIN=Jose-Gael-Cruz-Lopez` to skip OAuth, then `npm run db:migrate:local && npm run seed && npm run dev`. Open the printed localhost URL.
9. **Connecting to a repo / multiple repos** — one repo today via `GITHUB_REPO`; note that multi-repo is sub-project B (the dev sphere will show one hub per repo once B lands).

- [ ] **Step 2: Sanity-check the guide's commands exist**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
node -e "const s=require('./package.json').scripts; ['db:create','db:migrate:local','db:migrate:remote','deploy','dev','seed','build:web'].forEach(k=>{if(!s[k])throw new Error('missing script '+k)}); console.log('all referenced npm scripts exist')"
test -f .dev.vars.example && echo ".dev.vars.example present"
```
Expected: "all referenced npm scripts exist" and ".dev.vars.example present".

- [ ] **Step 3: Commit**

```bash
cd /Users/josecruz/Desktop/tesseract
git add canopy/SETUP.md
git commit -m "docs(canopy): SETUP.md — deploy to Cloudflare + connect to one repo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification — build, test, local wrangler dev smoke

**Files:** none (verification only)

- [ ] **Step 1: Full canopy gate — typecheck + tests + web build**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract/canopy
npm run typecheck && npm test && npm run build:web
```
Expected: all green.

- [ ] **Step 2: Local `wrangler dev` smoke test (DEV_LOGIN bypass)**

```bash
cd /Users/josecruz/Desktop/tesseract/canopy
cp -n .dev.vars.example .dev.vars 2>/dev/null || true
printf '\nDEV_LOGIN=Jose-Gael-Cruz-Lopez\n' >> .dev.vars
npm run db:migrate:local
npm run seed
npm run dev &   # starts wrangler dev (Miniflare) on http://localhost:8787
# wait for boot, then:
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/            # expect 200 (SPA)
curl -s http://localhost:8787/auth/me | head -c 200                        # expect JSON principal (DEV_LOGIN)
# stop the dev server (kill the wrangler process)
pkill -f 'wrangler dev' 2>/dev/null || true
```
Expected: `/` returns 200 and serves the SPA; `/auth/me` returns a JSON body with `"login":"Jose-Gael-Cruz-Lopez"`. If `wrangler dev` cannot bind or Miniflare fails in the sandbox, capture the exact error and report it — the deploy path still stands (the user runs it on their machine), but say so explicitly rather than claiming a pass.

- [ ] **Step 3: Confirm the Mnemosphere app is untouched and still green**

Run:
```bash
cd /Users/josecruz/Desktop/tesseract
git diff --name-only main..HEAD -- ':!canopy' ':!.gitignore' ':!docs'
npx vitest run 2>&1 | grep -E 'Test Files|Tests '
npm run build 2>&1 | tail -2
```
Expected: the first command prints **nothing** (no root app files changed outside canopy/.gitignore/docs); Mnemosphere tests still 406 passing; root build clean.

- [ ] **Step 4: Final commit (if `.dev.vars` or any stray file appeared, confirm it's ignored)**

```bash
cd /Users/josecruz/Desktop/tesseract
git status --porcelain    # expect clean or only ignored files; .dev.vars must NOT appear
```
Expected: no untracked `canopy/.dev.vars`, `canopy/node_modules`, or `canopy/web/dist`.

---

## Self-review notes

- **Spec coverage:** bring-in + isolation (Task 1) ✓; de-Sapling org gate → `AUTH_ORG`/allow-list (Task 2) ✓; user-facing copy + repo URL scrub (Task 3) ✓; wrangler placeholders + blank db id (Task 4) ✓; `SETUP.md` connect-to-one-repo (Task 5) ✓; build/test/typecheck/local-dev verification + Mnemosphere-untouched check (Task 6) ✓. Division of labor (Claude verifies locally; user runs the real Cloudflare deploy) is encoded as the `--dry-run` (Task 4) + local `wrangler dev` (Task 6), with explicit "report, don't fake" fallbacks.
- **Out of scope (correctly absent):** the dev sphere (C), multi-repo (B), identity bridge (D).
- **Interfaces:** `isAllowed(env, token, login)` and `isActiveOrgMember(token, org)` are defined once (Task 2) and referenced consistently; `AUTH_ORG` env var name is used identically across env.ts, principal.ts, routes.ts, wrangler.toml, and SETUP.md.
