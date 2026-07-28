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
- **5xx responses** — create a *Workers Alert* notification (available for
  Workers on the account) on failing/erroring requests for the `canopy` Worker,
  and/or watch the error-rate panel under **Workers & Pages → canopy →
  Metrics**. A 5xx burst on `/auth/*` is the login path; check the `signin`
  lines first.

Both alerts are deliberately threshold-based notifications on data the Worker
already emits — no extra instrumentation, dashboards, or API configuration is
required (or should be attempted) from this repo. Issue #28 tracks turning this
section from "recommended" into "configured".
