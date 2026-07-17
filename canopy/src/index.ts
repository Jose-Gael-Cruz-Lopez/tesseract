import { app } from "./routes";
import { handleMcp } from "./mcp";
import { handleGithubWebhook } from "./webhook";
import { logEvent } from "./log";
import { resolveBearerPrincipal } from "./auth/principal";
import { authorizeRepoAccess } from "./auth/repo-gate";
import { getUserToken } from "./auth/user-token";
import type { AccessibleRepo } from "./auth/app";
import { corsHeaders, handlePreflight } from "./cors";
import { bootstrapRepo } from "./db";
import type { Env } from "./env";

// Test seam for the /mcp/:owner/:repo authorization path (Phase 3, issue #10):
// mirrors src/hub.ts's _hubTestHooks. When set, these override the live wiring the
// gate builds from env. Production leaves them undefined → the real getUserToken +
// accessibleRepos run. Tests set them to avoid real GitHub + token storage.
export const _mcpTestHooks: {
  getUserToken?: (login: string) => Promise<string | null>;
  listRepos?: AccessibleRepo[] | ((token: string) => Promise<AccessibleRepo[]>);
} = {};

export function _resetMcpTestHooks(): void {
  _mcpTestHooks.getUserToken = undefined;
  _mcpTestHooks.listRepos = undefined;
}

const jsonError = (error: string, status: number): Response =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

// Matches /mcp/:owner/:repo — exactly two more non-empty path segments after /mcp —
// mirroring the /r/:owner/:repo hub routes. Bare /mcp (no owner/repo) is the flat,
// defaultRepo(env) surface and must keep working unchanged.
const MCP_REPO_PATH = /^\/mcp\/([^/]+)\/([^/]+)$/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // CORS preflight for the read routes (browsers only; allowed origins only).
    const pre = handlePreflight(request, env);
    if (pre) return pre;
    // Complete migration 0020's backfill once per isolate (guarded + best-effort):
    // register GITHUB_REPO and rewrite the transient repo='' sentinel on legacy rows.
    await bootstrapRepo(env, env.DB);
    // Static assets are served by the assets binding before this handler runs.
    const repoMatch = MCP_REPO_PATH.exec(url.pathname);
    if (url.pathname === "/mcp" || repoMatch) {
      // Bearer ONLY. On missing/invalid credentials: bare 401, NO WWW-Authenticate,
      // NO OAuth discovery/metadata — Claude Code must use the configured header.
      const principal = await resolveBearerPrincipal(request, env);
      if (!principal) {
        // One detail-free structured line (issue #22), mirroring the webhook's
        // pre-auth convention: the request is UNVERIFIED here, so no header/token
        // material is logged — an attacker controls all of it. Bearer tokens are
        // the long-lived static credential (canopy_mcp_…): a revoked/leaked token
        // being probed must land at error level so the auth-failure-spike alert
        // (docs/runbooks/secrets-and-observability.md) counts it.
        logEvent({ event: "mcp_auth", outcome: "unauthorized" });
        return jsonError("unauthorized", 401);
      }

      if (!repoMatch) return handleMcp(request, env, ctx, principal);

      // /mcp/:owner/:repo (Phase 3, additive): authorize exactly like the hub gate
      // (repoGate) — connected + collaborator — but for the bearer/agent surface. A
      // denial never leaks existence: an unconnected repo and one the principal can't
      // reach both 404 the same way.
      const repo = `${repoMatch[1]}/${repoMatch[2]}`;
      const listRepos = _mcpTestHooks.listRepos;
      const auth = await authorizeRepoAccess({
        db: env.DB,
        login: principal.login,
        repo,
        getUserToken: _mcpTestHooks.getUserToken ?? ((login) => getUserToken(env.DB, env, login)),
        ...(listRepos ? { listRepos: typeof listRepos === "function" ? listRepos : async () => listRepos } : {}),
      });
      if (!auth.allowed) return jsonError(auth.error, auth.status);

      // Thread the gate's per-repo canPush through so update_plan (the authored/
      // promote-class MCP write) authorizes on it — NOT global isAdmin (issue #20).
      return handleMcp(request, env, ctx, principal, repo, auth.canPush);
    }
    // Third auth class: GitHub webhook deliveries, HMAC-verified over the raw
    // body against GITHUB_WEBHOOK_SECRET. Never touches sessionGate.
    if (url.pathname === "/webhook/github" && request.method === "POST") {
      return handleGithubWebhook(request, env);
    }
    // The Hono app (read routes etc.). Add CORS for allowed origins so the
    // Mnemosphere dev sphere can read cross-origin.
    const res = await app.fetch(request, env, ctx);
    const ch = corsHeaders(request.headers.get("origin"), env);
    if (Object.keys(ch).length === 0) return res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(ch)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },

  // Backstop: recompute per-milestone progress from GitHub on a schedule — a computed
  // direct writer (promote class), never on the render path.
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Per-installation tokens now (GITHUB_SERVICE_TOKEN retired). No App configured → no-op.
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return;
    const { recomputeConnectedRepos } = await import("./tools/progress");
    await recomputeConnectedRepos(env.DB, env);
  },
} satisfies ExportedHandler<Env>;
