# Secret Self-Check — Spec

> **Extension (2026-08-06, audit hardening).** The report now carries one
> non-secret row, `D1_MIGRATIONS`: the live database's `d1_migrations` count
> versus the compiled-in `EXPECTED_MIGRATION_COUNT` (pinned to the
> `migrations/` directory by a test). Fewer rows than expected, or a missing
> table, is `fail` (`migrations_pending` / `migrations_table_missing`) —
> code-ahead-of-schema, the class behind the 2026-07-17 ten-day auth outage;
> any other read error is `indeterminate`. Same registry shape, same alerting
> contract, same containment as every other probe (`test/selfcheck.test.ts`).

## Objective

A self-check that **functionally exercises** each of canopy's configured secrets, rather than merely confirming a name exists. It runs unattended on the existing 6-hour cron and is also callable on demand, so a credential that is *present but wrong* is detected automatically and pinned to the exact secret in one request.

This exists because of a real incident. On 2026-07-28, three of five production bugs found while running issue #9's e2e checklist were config values that `wrangler secret list` reports as present:

- `GITHUB_APP_CLIENT_SECRET` did not match the App → sign-in impossible; `wrangler secret list` showed it present the whole time.
- `GITHUB_WEBHOOK_SECRET` did not match → every webhook delivery 401'd, `events` stayed at 0.
- `GITHUB_APP_CLIENT_ID` had historically been set to an empty string (runbook gotcha) → `/auth/login` 503'd, and `secret list` still showed the name.

Audience is the operator (currently a single admin). Success is measured in detection latency: a broken required credential goes from **undetected for 10 days** to **flagged within one cron interval**, with the failing secret named explicitly.

## Requirements

Each requirement is numbered and independently testable.

### Probe registry

1. A registry of probes, one entry per secret, each yielding exactly one `SecretStatus` (see #7). Adding a secret means adding one registry entry — no other file changes.

2. **`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`** — mint an App JWT and call `GET https://api.github.com/app`. HTTP 200 → `pass`. HTTP 401/403 → `fail`. Any other non-OK, network error, or throw → `indeterminate`.

3. **`GITHUB_APP_CLIENT_ID` + `GITHUB_APP_CLIENT_SECRET`** — POST `https://github.com/login/oauth/access_token` with the real `client_id`/`client_secret` and a deliberately invalid `code` (a fixed sentinel such as `canopy-selfcheck-invalid-code`). GitHub validates client credentials *before* the code, so the error field discriminates:
   - body `error` is `bad_verification_code` → `pass` (credentials accepted, only the code was rejected)
   - body `error` is `incorrect_client_credentials` → `fail`
   - HTTP non-OK, timeout, or any other/absent `error` value → `indeterminate`
   
   This probe must have **no side effects**: it never mints a token, never opens a session, never writes to D1.

4. **`COOKIE_SECRET`** — round-trip a fixed sentinel string through `hmacSeal` then `hmacUnseal`. Value recovered intact → `pass`. Mismatch or throw → `fail`. Purely local; no network.

5. **`GEMINI_API_KEY`** — optional by design (`CLAUDE.md`: absent → the excerpt fallback). Present and non-empty → `pass`. Absent or empty → `degraded`, never `fail`.

6. **`GITHUB_WEBHOOK_SECRET`** — presence only. It **cannot** be verified from the Worker: GitHub never exposes its copy, so there is nothing to compare against. Present and non-empty → status `pass` carrying an explicit `verified: false` marker and a human-readable note that real coverage comes from webhook alerting (a mismatch emits `{"event":"webhook","outcome":"unauthorized"}` at error level on every delivery). Absent or empty → `fail` (the surface 401s unconditionally without it).

   The report must never present this secret as *verified*. Conflating "present" with "correct" is precisely the failure mode this feature exists to eliminate.

### Statuses and alerting

7. Exactly four statuses: `pass`, `fail`, `indeterminate`, `degraded`.

8. **Only `fail` is alertable.** A `fail` emits one structured log line at **error** level (`console.error`, the failure class `docs/runbooks/secrets-and-observability.md` already alerts on), so issue #28's auth-failure notification covers it with no extra configuration.

9. `indeterminate` and `degraded` log at **info** level and must never reach the error channel. Rationale: a GitHub outage must not page the operator about a credential that is fine, and `GEMINI_API_KEY` being intentionally unset must not produce a permanently-red alert. A muted alert is worth nothing.

10. A new `LogEventName` value — `selfcheck` — added to the union in `src/log.ts`, with the flow documented in the runbook's log-line table.

11. Each emitted line carries at minimum: `event: "selfcheck"`, `outcome`, the `secret` name, and a short machine-readable `reason`. One line per failing secret, so a spike of one shape is attributable to one credential.

### Surfaces

12. **Cron.** The check runs inside the existing `scheduled()` handler on the current `crons = ["0 */6 * * *"]` trigger. No new trigger is added.

13. **Isolation.** The self-check can never break the progress recompute. It is wrapped so that any throw, rejection, or hang is contained and logged; `recomputeConnectedRepos` runs regardless, and its result is unaffected by self-check outcome. Ordering must not allow a slow probe to starve the recompute.

14. **On-demand route.** `GET /admin/selfcheck` returns the full report as JSON. It is a flat route (origin-level control state, not tenant data — the same class as `/admin/backfill`), and is **not** added under `/r/:owner/:repo`.

15. **Dual authentication.** The route is authorized by **either** an `isAdmin` session cookie **or** a valid `canopy_mcp_` bearer token. Either principal suffices.

    The bearer path is load-bearing, not a convenience: bearer tokens are hashed in D1 and validated with no dependence on the GitHub App, so they keep working during exactly the auth outage this tool is for. A session-only route would be unavailable in its primary scenario. No new auth flow is introduced — both classes already exist.

16. Unauthenticated → `401`. Authenticated but neither admin nor valid bearer → `403`. Neither response leaks whether the route exists beyond the normal gate behaviour.

### Output safety

17. The report **never** includes a secret's value, any prefix or suffix of it, or its **length**. Length alone would have disclosed that the client secret was 17 bytes of junk; the report needs to say *which* secret is wrong, not anything about its contents.

18. Report shape, per secret: the secret's name, its status, `verified` (boolean — whether the status reflects a functional probe or mere presence), and a short human-readable note. Plus a top-level summary with counts per status and an overall boolean that is true only when no secret is `fail`.

## Out of Scope

- Verifying `GITHUB_WEBHOOK_SECRET` actually matches GitHub's copy. Impossible from the Worker; covered by webhook alerting instead.
- Any repair, rotation, or writing of secrets. The check is strictly read-only and diagnostic.
- A second cron trigger or any faster schedule.
- Persisting check history, counters, or trends. The check is stateless; no D1 migration.
- Configuration for which secrets are required vs optional. That set is fixed in code.
- Alerting configuration itself (Cloudflare Notifications) — that is issue #28, manual dashboard work.
- A UI surface in the web SPA.
- Checking non-secret configuration (`[vars]` such as `GITHUB_REPO`, `ADMIN_LOGINS`, `LOGIN_ALLOWLIST`).

## Constraints

- **Stack:** TypeScript on Cloudflare Workers, Hono routing, existing project layout (`src/auth/`, `src/log.ts`, `src/routes.ts`, `src/index.ts`).
- **No new auth flow.** `CLAUDE.md` is explicit — three auth classes exist, do not add a fourth. Reuse session and bearer resolution as-is.
- **Testability:** all GitHub I/O must be dependency-injected (`fetchImpl?: typeof fetch`, matching the existing convention), because the vitest pool exports no fetch mock. Tests must never hit the network.
- **Test harness:** real Miniflare D1 via `npm test`; `npm run typecheck` must also pass (it does not run as part of `npm test`).
- **TDD:** tests written first and observed failing for the right reason before implementation, per repo convention.
- **No new D1 migration.**
- **Abuse safety:** the invalid-code probe hits GitHub's OAuth token endpoint. At the 6-hour cadence this is 4 requests/day — deliberately chosen so a health check cannot resemble credential probing to GitHub's abuse heuristics. Do not increase frequency.
- **Empty means absent.** A secret that is an empty or whitespace-only string is treated exactly as if unset. This is the runbook's central gotcha: interactive `wrangler secret put` through an automation shell stores an empty value and still prints "Success!", while `secret list` shows the name as present.
- **Latency:** probes run with a bounded timeout so the cron cannot hang; a timeout yields `indeterminate`.

## Edge Cases

| Case | Expected behaviour |
| --- | --- |
| Required secret unset | `fail`, error-level line naming that secret |
| Required secret set to `""` or whitespace | `fail` — treated as absent, never `pass` |
| `GEMINI_API_KEY` unset (current prod state) | `degraded`, info level, never alerts |
| `GITHUB_WEBHOOK_SECRET` set | `pass` with `verified: false` and a note; never reported as verified |
| `GITHUB_WEBHOOK_SECRET` unset/empty | `fail` |
| GitHub returns 5xx or times out | `indeterminate`, info level — not an alert |
| GitHub returns 200 with an unrecognised `error` value | `indeterminate`, not `pass` — never assume good |
| A probe throws unexpectedly | `indeterminate`; the throw is contained, other probes still run |
| Every probe throws | Cron still completes; progress recompute still runs and succeeds |
| Self-check exceeds its time budget | Contained; cron's recompute unaffected |
| Route hit with no credentials | `401` |
| Route hit with a valid non-admin session | `403` |
| Route hit with a valid bearer while GitHub App creds are broken | **`200` with the report** — the break-glass path must work |
| Route hit with a revoked/expired bearer | `401` |
| Multiple secrets failing at once | All reported; one error line per failing secret |
| App credentials correct but rate-limited by GitHub | `indeterminate`, not `fail` |

## Definition of Done

A reviewer can verify each of these by inspection or by running a command.

**Behaviour**

1. `GET /admin/selfcheck` with no credentials returns `401`.
2. The same route with a valid non-admin session returns `403`.
3. The same route with an `isAdmin` session returns `200` and a report covering every secret in the registry.
4. The same route with a valid `canopy_mcp_` bearer returns `200` and the identical report shape — proven by a test in which App-credential probes fail, demonstrating the break-glass path.
5. A probe whose injected fetch returns `incorrect_client_credentials` yields `fail` for `GITHUB_APP_CLIENT_SECRET`.
6. A probe whose injected fetch returns `bad_verification_code` yields `pass` for the same secret.
7. A probe whose injected fetch returns HTTP 503 yields `indeterminate`, not `fail`.
8. `COOKIE_SECRET` set to a working value yields `pass`; a seal/unseal mismatch yields `fail`.
9. `GEMINI_API_KEY` absent yields `degraded`, and no `console.error` is emitted for it.
10. `GITHUB_WEBHOOK_SECRET` present yields `pass` with `verified: false`; absent yields `fail`.
11. Every required secret set to `""` yields `fail`, not `pass`.

**Alerting contract**

12. A `fail` emits exactly one `console.error` line, parseable as JSON, containing `event: "selfcheck"`, `outcome`, `secret`, and `reason`.
13. `indeterminate` and `degraded` emit **no** `console.error` — asserted by spying on `console.error` and observing zero calls.
14. `selfcheck` is present in the `LogEventName` union in `src/log.ts`.

**Isolation**

15. A test in which every probe throws still shows the scheduled progress recompute running and completing.
16. No self-check failure changes the recompute's result.

**Safety**

17. A test asserts that for a known-bad secret value, the serialized report contains neither the value, nor any 4+ character substring of it, nor its length as a number.

**Gates**

18. `cd canopy && npm test` passes with no failures and no unhandled errors, and the total test count has increased.
19. `cd canopy && npm run typecheck` exits 0.
20. `git status` is clean apart from the intended new/modified files.
21. No new file under `canopy/migrations/`.
22. `wrangler.toml` still contains exactly one cron entry: `crons = ["0 */6 * * *"]`.

**Documentation**

23. The runbook's structured-log table gains a `selfcheck` row describing the event, its outcomes, and its extras.
