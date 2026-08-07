# Runbook — Worker secrets & observability (issue #22)

Operational notes for the canopy Worker: how to set secrets without silently
breaking production, where the structured logs land, and what to alert on.

## Secret-setting gotcha (institutional knowledge — keep verbatim)

> **Runbook: secret-setting gotcha** — interactive `wrangler secret put X` run
> through an automation/`!` shell stores an EMPTY value (the hidden prompt never
> receives stdin), and "Success!" is misleading. ALWAYS pipe:
> `cd canopy && printf '%s' 'VALUE' | npx wrangler secret put X`
> (sensitive: `printf '%s' "$(pbpaste)" | …`). This silently broke
> `GITHUB_APP_CLIENT_ID` (login 503) until re-piped.

In practice:

```sh
# Non-sensitive value, inline:
cd canopy && printf '%s' 'VALUE' | npx wrangler secret put X

# Sensitive value — copy it, then pipe the clipboard so it never lands in shell history:
cd canopy && printf '%s' "$(pbpaste)" | npx wrangler secret put X
```

Symptoms of an empty secret: the affected surface fails *cleanly* (e.g. an empty
`GITHUB_APP_CLIENT_ID` makes `/auth/login` return a `503 app_not_configured`; an
empty `GITHUB_WEBHOOK_SECRET`-adjacent misconfiguration makes every delivery
`401`), while `wrangler secret list` still shows the name as present. When in
doubt, re-pipe the value — `secret put` overwrites idempotently. The full secret
inventory lives in `CLAUDE.md` (Env / bindings) and `src/env.ts`.

### In the dashboard, "Variable" is NOT "Secret"

Workers → canopy → Settings → **Variables and Secrets** offers two types, and the
wrong one looks like it worked. On 2026-07-28 `GITHUB_WEBHOOK_SECRET` was added as
a plaintext **Variable**; every webhook delivery kept returning 401.

Three separate problems with that:

1. **It conflicts with the secret of the same name.** `wrangler secret list` already
   showed `GITHUB_WEBHOOK_SECRET` as `secret_text`. With both defined, the Worker
   kept reading the old secret — so the "fix" changed nothing.
2. **A dashboard edit needs an explicit Deploy.** Saving the field alone does not
   publish. The tell is that no new Worker version appears.
3. **A plaintext Variable is readable in the dashboard**, and `[vars]` in
   `wrangler.toml` can wipe dashboard-set plaintext variables on the next Workers
   Builds deploy — so it silently vanishes later and the 401s return with no
   apparent cause.

### `pbcopy` / `pbpaste` do NOT work in an automation shell

Clipboard commands run through an automation/`!` shell **silently no-op**. `pbcopy`
writes nothing and `pbpaste` returns whatever was on the clipboard beforehand — no
error, no warning. Combined with the empty-secret gotcha above, every failure mode
in the chain is silent:

| Step | What it looks like | What actually happened |
| --- | --- | --- |
| `openssl rand -hex 32 \| pbcopy` | no output — looks fine | clipboard unchanged |
| `pbpaste \| wc -c` | a plausible number | a *stale* value from before |
| `printf '%s' "$(pbpaste)" \| wrangler secret put X` | `✨ Success!` | stored the stale junk |

On 2026-07-28 this cost several rounds: the clipboard was stuck on a 17-byte
fragment for an entire session, so a piped `secret put` cheerfully stored 17 bytes
of junk as the App client secret.

There is also a plain trap even when the clipboard *does* work: copying the command
out of a chat or doc **overwrites the secret you just copied**. The instruction and
the payload compete for the same clipboard.

**Do secret entry in a real terminal, never through `!`:**

```
openssl rand -hex 32                 # prints locally; never into a transcript
npx wrangler secret put NAME         # paste at the hidden prompt, Enter
```

A hidden prompt gives no feedback either, so confirm with `wrangler versions list`
(below) rather than trusting `Success!`. If a value must be generated and stored,
generate it in the terminal where you will paste it — do not route it through a
chat, a file, or a shell you do not control.

**The tell that a value landed:** a secret write always mints a new Worker version.

```
npx wrangler versions list        # a new entry appears, timestamped just now
```

If there is no new version, the value was not written — regardless of what the UI
or `secret list` says. Prefer `npx wrangler secret put NAME` from a real terminal;
it writes an encrypted secret *and* publishes, in one step.

## Migration gotcha — merging deploys CODE, never SCHEMA

**A merge to `main` triggers a Workers Builds deploy of the Worker. It does NOT
apply D1 migrations.** `npm run db:migrate:remote` is a separate, manual step, and
it fails outright if `wrangler` is authenticated to the wrong Cloudflare account
(there are two; only one can see D1 `53c1314d-…`, the id pinned in
`wrangler.toml` — `npx wrangler whoami` then `npx wrangler d1 list` is the check).

That combination caused a **~10-day total sign-in outage**: `0028_rate_limits.sql`
(PR #27) merged and deployed on 2026-07-16, the remote migration silently failed on
the wrong account, and from 2026-07-17 every `/auth/*` route returned a bare 500 —
the limiter queried tables that did not exist. CI never caught it because the test
harness applies every migration. It was found on 2026-07-27 running issue #9's e2e
checklist. The abuse controls now degrade open rather than 500 (`failOpen`, below),
so this class of drift is loud instead of fatal — but the schema still has to land.

**After merging any PR that carries a migration:**

```
npx wrangler whoami                              # right account?
cd canopy && npx wrangler d1 migrations list canopy --remote   # expect: no pending
cd canopy && npm run db:migrate:remote
```

Treat a PR with a migration as unshipped until that list comes back empty.

## Observability

### Where the logs land

The `[observability] enabled = true` block in `wrangler.toml` turns on
**Workers Logs**: every `console.log` / `console.error` line the Worker emits is
captured, indexed, and queryable in the Cloudflare dashboard under
**Workers & Pages → canopy → Logs**. For a live stream during an incident, use
`cd canopy && npx wrangler tail`.

### The structured log lines (`src/log.ts`)

Each multi-tenant flow emits exactly one single-line JSON record per decision via
`logEvent()`, always carrying `event` + `outcome`, plus `repo` / `login` when the
tenant is known. Failure-class outcomes (`failure` / `deny` / `unauthorized` /
`error`) are written with `console.error` — log level `error` in Workers Logs —
so they can be filtered and alerted on without parsing message text. Token,
secret, and payload *values* are never logged; identifiers only.

| `event`              | Emitted at                                                | `outcome` values                       | Extras                                          |
| -------------------- | --------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `signin`             | GitHub App sign-in (`src/auth/app-login.ts`)               | `success`, `failure`                   | `reason` (e.g. `app_not_configured`, `exchange_failed`), `detail` (log-only cause — see below) |
| `repo_gate`          | Per-repo hub + `/mcp/:owner/:repo` gate (`src/auth/repo-gate.ts`) | `allow`, `deny`                 | `status` (401/404), `reason`, `can_push`        |
| `installation_token` | Fresh installation-token mints (`src/auth/app.ts`; cache hits are silent) | `success`, `failure`   | `installation_id`, `status`                     |
| `webhook`            | Each `/webhook/github` delivery (`src/webhook.ts`)         | `processed`, `ignored`, `unauthorized` | `github_event`, `captured`, `unchanged`         |
| `mcp_auth`           | Bearer 401 at `/mcp` + `/mcp/:owner/:repo` (`src/index.ts`) | `unauthorized`                        | none — the request is unverified, so the line is deliberately detail-free |
| `mcp_tool`           | Every MCP tool call (`src/mcp.ts`)                         | `success`, `error`                     | `tool`, `message` (on error)                    |
| `rate_limit`         | An abuse control degrading OPEN because its D1 tables are unreachable (`failOpen` in `src/auth/rate-limit.ts`) | `error` | `reason` (`backend_error`), `policy`, `op`, `error` |
| `selfcheck`          | Per-secret functional check, on the 6-hour cron and `GET /admin/selfcheck` (`src/auth/selfcheck.ts`) | `failure` (alertable), `indeterminate`, `degraded` | `secret`, `reason` |
| `progress_recompute` | One connected repo's cron recompute failed and was contained — the loop moved on (`src/tools/progress.ts`) | `failure` (alertable) | `repo`, `message` |

**Reading a `signin` / `exchange_failed` line.** `reason` is the failure *class*; the
`detail` field carries the underlying cause, which is the field that actually tells
you what to fix. The response body deliberately stays `{"error":"exchange_failed"}`
for every case — the caller is unauthenticated, so it learns only the class:

| `detail` contains                       | Means                                            | Fix |
| --------------------------------------- | ------------------------------------------------ | --- |
| `incorrect_client_credentials`          | `GITHUB_APP_CLIENT_SECRET` doesn't match the App | Re-pipe it from the App's settings (see the secret gotcha above) |
| `bad_verification_code`                 | Code replayed/expired — a user refreshed or back-buttoned the callback | Nothing; this is normal web traffic |
| `redirect_uri_mismatch`                 | The callback URL isn't registered on the App     | Add `https://memo-sphere.com/auth/callback` to the App's callback URLs |
| `user token request failed: <status>`   | GitHub's token endpoint returned non-OK          | Check GitHub status; transient |

Before this field existed, all four were one indistinguishable log line — which is
how a wrong client secret went undiagnosed. `detail` is safe to log because
`oauthToken` composes those messages from the HTTP status and GitHub's `error` field
only, never from the code, token, or secret.

**Reading a `selfcheck` line.** Only `outcome: "failure"` is alertable — that means a
probe definitively proved a required secret wrong (or absent/empty). `indeterminate`
means the probe could not reach GitHub, so it proved nothing; `degraded` means an
*optional* secret is unset by design. Both of those sit at info level on purpose: an
alert that fires during every GitHub blip, or stays permanently red because
`GEMINI_API_KEY` is intentionally unset, gets muted — and a muted alert is worth nothing.

`GITHUB_WEBHOOK_SECRET` is reported `verified: false`. It is checked for presence only,
because GitHub never exposes its copy and the Worker has nothing to compare against.
Its real coverage is the `webhook` / `unauthorized` line above, which fires on every
delivery when the secret is wrong. Never read its `pass` as "correct".

The report also carries one non-secret row, `D1_MIGRATIONS` (added 2026-08-06, audit
hardening): the count of `d1_migrations` rows in the live database versus the count
this build was compiled with (`EXPECTED_MIGRATION_COUNT` in `src/auth/selfcheck.ts` —
a test pins it to the `migrations/` directory, so bumping it is part of adding a
migration). `reason: "migrations_pending"` or `"migrations_table_missing"` means the
code is ahead of the schema — exactly the 2026-07-17 wrong-account outage class — and
is alertable `failure`; a transient D1 read error is `indeterminate` and never pages.
On this alert: STOP any further deploys, then follow the wrong-account checklist next
to `account_id` in `wrangler.toml` (`wrangler whoami` → the account owning D1
`53c1314d-…` → `npx wrangler d1 migrations apply canopy --remote`).

One deliberate exclusion: the **session-cookie 401** (`sessionGate` — an anonymous
or expired browser hitting a gated HTTP route) is NOT logged at error level. Fresh
visitors 401 routinely before sign-in (the SPA probes gated routes on load), so
logging it would put steady normal traffic at `error` and drown the spike signal.
The bearer and webhook surfaces have no such routine-anonymous traffic — a 401
there is always misconfiguration or probing, which is exactly what the alert
below counts.

Example queries in the Workers Logs UI: filter `level = error` for the failure
classes; filter the message on `"event":"repo_gate"` (or any event name) to
follow one flow; group by `message` to spot a spike of one shape.

### Recommended alerting (configure by hand in the dashboard — tracked in issue #28)

Set these up under **Cloudflare dashboard → Notifications**. Cloudflare
Notifications are account-level configuration — none of this is (or can be)
provisioned from the repo via `wrangler`; do not script it. **Status: not yet
configured** — actually creating the two notifications below is tracked in
issue #28; when done, record what was configured and when here.

- **Auth-failure spikes** — the failure-class lines above all arrive at log level
  `error`. Watch the error-level log rate for the canopy Worker (Workers Logs →
  filter `level = error`); a sustained spike of `signin` failures,
  `repo_gate` denies, or `webhook`/`mcp_auth` `unauthorized` lines means either
  an attack (including a revoked/leaked `canopy_mcp_` bearer being probed),
  a broken secret (see the gotcha above — `app_not_configured` is the empty
  `GITHUB_APP_CLIENT_ID` signature), or a webhook secret mismatch.
- **5xx responses** — a 5xx burst on `/auth/*` is the login path; check the
  `signin` lines first. See the plan caveat immediately below.

Both alerts are deliberately threshold-based notifications on data the Worker
already emits — no extra instrumentation, dashboards, or API configuration is
required (or should be attempted) from this repo. Issue #28 tracks turning this
section from "recommended" into "configured".

### ⚠️ Plan caveat — there is no Workers notification on the free plan

Verified 2026-07-28 by paging the entire **Notifications → Add** catalogue: all
**53** alert types, and **none of them is for Workers**. Products offered are
Abuse, Access, Billing, Brand Protection, CASB, Cloudflare Status, Cloudforce
One, DDoS Protection, Health Checks, Images, Load Balancing, Log Explorer,
Logpush, Magic Transit, CNI, Pages, Radar, Route Leak Detection, SSL/TLS,
Client-side security, Security insights, Stream, Traffic Monitoring, Trust &
Safety, Tunnel, Web Analytics. Pages has "Project updates"; Workers has nothing.

Workers alerting and Log Explorer are **Workers Paid** features, and this account
is on the free plan ("You're on the free plan with 200K events per day" on the
Observability tab). So the *Workers Alert* recommended above **cannot be created
here**. Do not substitute an unrelated notification type to fill the checkbox —
that yields a green tick and zero coverage, which is the exact failure shape of
the 2026-07-28 incidents.

### External uptime monitoring (the free-plan substitute)

Poll the login path from outside Cloudflare and alert on anything that is not a
redirect. This is what actually covers the outage class on the free plan, and it
has one advantage the native alert structurally lacks: being *outside*
Cloudflare, it also catches a Cloudflare-side outage.

```
URL:       https://memo-sphere.com/auth/login
Interval:  5 minutes
Expect:    HTTP 302, Location → github.com/login/oauth/authorize
Alert on:  any 5xx, any timeout, or any non-302
```

Why this endpoint: it is the exact surface that broke. On 2026-07-17 it returned
a bare 500 for **~10 days** and nothing noticed; this check would have fired
within ~5 minutes. It is also cheap and side-effect-light — a poll sets two
short-lived cookies and redirects, writing at most one reusable `rate_limits`
row, and at one request per 5 minutes it is nowhere near `LOGIN_RATE`
(10/min per IP), so the monitor can never rate-limit itself into a false alarm.

Do **not** point the monitor at `/` (static assets — it stayed 200 throughout the
outage) or at `/auth/callback` (every hit records an auth failure toward the
lockout tracker).

Complementary, not redundant: `GET /admin/selfcheck` and its 6-hour cron
(`specs/secret-selfcheck.md`) cover *credential drift*, which an uptime check
cannot see; the uptime check covers *total surface failure*, which the
self-check cannot see.

### Second monitor — the hub-route class (partial failures)

The `/auth/login` monitor cannot see a broken HUB surface: during the issue #9
e2e run, hub opens 500'd on 3 of 4 requests while sign-in was fine (e2e bug 4).
Nothing watched that class until the 2026-08 audit. Add a second external
monitor on a hub-shaped route. The route is session-gated, so an anonymous poll
correctly gets `401 {"error":"unauthorized"}` — which is exactly the assertion:
that response proves the whole Hono chain (routing → sessionGate → D1 session
lookup → JSON error path) executed; the failure class turns it into a bare 500.
On a free tier without expected-status-code control, use a **keyword monitor**:

```
Type:      Keyword (alert when the keyword DISAPPEARS)
URL:       https://memo-sphere.com/r/Jose-Gael-Cruz-Lopez/tesseract/docs
Keyword:   unauthorized
Interval:  5 minutes
Reads as:  keyword present → the hub surface answers correctly (401 JSON)
           keyword absent  → 5xx / timeout / wrong body — the e2e-bug-4 class
```

Side-effect-light: an anonymous hub poll is refused by `sessionGate` before any
tenant read happens, and the session-cookie 401 is deliberately NOT an
error-level log line (see the exclusion above), so the monitor adds no alert
noise. **Status: to be created by hand** in the same external-monitor account as
the `/auth/login` monitor — when done, record the monitor id and date here,
next to the login monitor's record.
