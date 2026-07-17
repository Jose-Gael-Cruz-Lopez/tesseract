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
| `signin`             | GitHub App sign-in (`src/auth/app-login.ts`)               | `success`, `failure`                   | `reason` (e.g. `app_not_configured`, `exchange_failed`) |
| `repo_gate`          | Per-repo hub + `/mcp/:owner/:repo` gate (`src/auth/repo-gate.ts`) | `allow`, `deny`                 | `status` (401/404), `reason`, `can_push`        |
| `installation_token` | Fresh installation-token mints (`src/auth/app.ts`; cache hits are silent) | `success`, `failure`   | `installation_id`, `status`                     |
| `webhook`            | Each `/webhook/github` delivery (`src/webhook.ts`)         | `processed`, `ignored`, `unauthorized` | `github_event`, `captured`, `unchanged`         |
| `mcp_tool`           | Every MCP tool call (`src/mcp.ts`)                         | `success`, `error`                     | `tool`, `message` (on error)                    |

Example queries in the Workers Logs UI: filter `level = error` for the failure
classes; filter the message on `"event":"repo_gate"` (or any event name) to
follow one flow; group by `message` to spot a spike of one shape.

### Recommended alerting (documentation only — configure by hand in the dashboard)

Set these up under **Cloudflare dashboard → Notifications** (none of this is
provisioned from the repo; do not script it):

- **Auth-failure spikes** — the failure-class lines above all arrive at log level
  `error`. Watch the error-level log rate for the canopy Worker (Workers Logs →
  filter `level = error`); a sustained spike of `signin` failures,
  `repo_gate` denies, or `webhook` `unauthorized` lines means either an attack,
  a broken secret (see the gotcha above — `app_not_configured` is the empty
  `GITHUB_APP_CLIENT_ID` signature), or a webhook secret mismatch.
- **5xx responses** — create a *Workers Alert* notification (available for
  Workers on the account) on failing/erroring requests for the `canopy` Worker,
  and/or watch the error-rate panel under **Workers & Pages → canopy →
  Metrics**. A 5xx burst on `/auth/*` is the login path; check the `signin`
  lines first.

Both alerts are deliberately threshold-based notifications on data the Worker
already emits — no extra instrumentation, dashboards, or API configuration is
required (or should be attempted) from this repo.
