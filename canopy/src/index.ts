import { app } from "./routes";
import { handleMcp } from "./mcp";
import { handleGithubWebhook } from "./webhook";
import { resolveBearerPrincipal } from "./auth/principal";
import { corsHeaders, handlePreflight } from "./cors";
import { bootstrapRepo } from "./db";
import type { Env } from "./env";

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
    if (url.pathname === "/mcp") {
      // Bearer ONLY. On missing/invalid credentials: bare 401, NO WWW-Authenticate,
      // NO OAuth discovery/metadata — Claude Code must use the configured header.
      const principal = await resolveBearerPrincipal(request, env);
      if (!principal) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return handleMcp(request, env, ctx, principal);
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
