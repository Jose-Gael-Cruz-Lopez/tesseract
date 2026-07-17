// Structured observability logs for the multi-tenant flows (issue #22). One call
// per occurrence emits ONE single-line JSON record to console, which Workers Logs
// (the [observability] block in wrangler.toml) captures, indexes, and makes
// filterable — see docs/runbooks/secrets-and-observability.md for where the lines
// land and the recommended alerting on top of them.
//
// Field discipline: `event` names the flow, `outcome` its result; `repo` / `login`
// scope the record to a tenant when known; small scalar extras (reason, status,
// tool, github_event, counts) carry the rest. NEVER log token, secret, cookie, or
// payload VALUES — identifiers only. Log volume stays sane because each flow logs
// exactly once per request/decision (and the installation-token cache hit path
// doesn't log at all).

/** The five instrumented flows. */
export type LogEventName = "signin" | "repo_gate" | "installation_token" | "webhook" | "mcp_tool";

/**
 * Per-flow results. The failure class (`failure` / `deny` / `unauthorized` /
 * `error`) is emitted via console.error — level "error" in Workers Logs — so
 * auth-failure spikes are filterable/alertable without parsing message text;
 * everything else goes to console.log ("log").
 */
export type LogOutcome =
  | "success"      // signin, installation_token, mcp_tool
  | "allow"        // repo_gate
  | "processed"    // webhook (a surface we capture/sync)
  | "ignored"      // webhook (verified, but not a captured surface)
  | "failure"      // signin, installation_token
  | "deny"         // repo_gate (the 401/404 branches)
  | "unauthorized" // webhook (bad/absent HMAC or unset secret)
  | "error";       // mcp_tool (the tool body threw)

const FAILURE_OUTCOMES: ReadonlySet<LogOutcome> = new Set(["failure", "deny", "unauthorized", "error"]);

export interface LogRecord {
  event: LogEventName;
  outcome: LogOutcome;
  repo?: string;
  login?: string;
  // Small scalar extras only (reason, status, tool, github_event, counts, …).
  [extra: string]: string | number | boolean | undefined;
}

/**
 * Emit one structured log line. `undefined` fields are dropped by JSON.stringify,
 * so callers can pass optional context (repo/login) unconditionally and the line
 * stays compact. Failure-class outcomes route to console.error (see LogOutcome).
 */
export function logEvent(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (FAILURE_OUTCOMES.has(record.outcome)) console.error(line);
  else console.log(line);
}
