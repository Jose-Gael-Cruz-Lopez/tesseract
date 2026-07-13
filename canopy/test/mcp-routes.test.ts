import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import worker, { _mcpTestHooks, _resetMcpTestHooks } from "../src/index";
import { mintToken } from "../src/auth/tokens";
import { storeUserToken } from "../src/auth/user-token";
import { run, nowIso } from "../src/db";
import { write_plan } from "../src/tools/plan";
import type { Env } from "../src/env";

// Phase 3 (issue #10, multi-tenant MCP routing): /mcp/:owner/:repo, gated exactly
// like the /r/:owner/:repo hub routes (authorizeRepo: connected + collaborator) but
// for the bearer/agent surface. The flat /mcp (defaultRepo(env)) stays additive —
// unauthenticated/unauthorized shapes must be byte-for-byte with the pre-#10 code.

const LOGIN = "octocat";
const ctx = { waitUntil() {}, passThroughException() {} } as unknown as ExecutionContext;

async function seedUserWithBearer(login: string): Promise<string> {
  await env.DB.prepare(`INSERT OR IGNORE INTO users (github_login, name, created_at) VALUES (?, ?, ?)`)
    .bind(login, login, nowIso()).run();
  const { raw } = await mintToken(env.DB, login);
  return raw;
}

async function connect(repo: string): Promise<void> {
  await run(
    env.DB,
    `INSERT OR REPLACE INTO repos (repo, added_at, added_by, installation_id, status) VALUES (?, ?, ?, ?, 'connected')`,
    repo,
    nowIso(),
    LOGIN,
    1
  );
}

function req(path: string, token?: string): Request {
  return new Request(`https://canopy.example${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => { _resetMcpTestHooks(); });
afterEach(() => { _resetMcpTestHooks(); });

describe("/mcp/:owner/:repo authorization (mirrors repoGate)", () => {
  it("401s with no bearer at all", async () => {
    const res = await worker.fetch(req("/mcp/octo/a"), env as unknown as Env, ctx);
    expect(res.status).toBe(401);
  });

  it("401s with a bad bearer", async () => {
    const res = await worker.fetch(req("/mcp/octo/a", "canopy_mcp_nope"), env as unknown as Env, ctx);
    expect(res.status).toBe(401);
  });

  it("401s (reauthorize) when the principal has no stored user token", async () => {
    await connect("octo/a");
    const raw = await seedUserWithBearer(LOGIN);
    // Deliberately no storeUserToken call — exercised against the REAL getUserToken
    // (no _mcpTestHooks.getUserToken override), proving the DB-backed lookup itself
    // 401s a principal who never connected a user token.
    const res = await worker.fetch(req("/mcp/octo/a", raw), env as unknown as Env, ctx);
    expect(res.status).toBe(401);
  });

  it("404s an unconnected repo (no existence leak)", async () => {
    const raw = await seedUserWithBearer(LOGIN);
    await storeUserToken(env.DB, LOGIN, { token: "user-tok", refreshToken: null, expiresAt: null });
    _mcpTestHooks.listRepos = [{ repo: "octo/a", can_push: true }];
    const res = await worker.fetch(req("/mcp/octo/a", raw), env as unknown as Env, ctx);
    expect(res.status).toBe(404);
  });

  it("404s a connected repo the principal can't reach (not a collaborator) — same shape as unconnected", async () => {
    await connect("octo/a");
    const raw = await seedUserWithBearer(LOGIN);
    await storeUserToken(env.DB, LOGIN, { token: "user-tok", refreshToken: null, expiresAt: null });
    _mcpTestHooks.listRepos = [{ repo: "octo/other", can_push: true }]; // octo/a NOT in the access set
    const res = await worker.fetch(req("/mcp/octo/a", raw), env as unknown as Env, ctx);
    expect(res.status).toBe(404);
  });
});

describe("/mcp (no repo) — backward compat, unchanged", () => {
  it("still 401s with no bearer, byte-for-byte with the pre-#10 shape", async () => {
    const res = await worker.fetch(req("/mcp"), env as unknown as Env, ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("does NOT run the repo-authorization gate — a valid bearer with no user token/repo access still reaches handleMcp", async () => {
    const raw = await seedUserWithBearer(LOGIN);
    // No repos connected, no user token stored, no listRepos hook. If /mcp ran the
    // new /mcp/:owner/:repo gate this would 401/404; unchanged behavior means the
    // request reaches handleMcp (some non-401/404 MCP-protocol response).
    const res = await worker.fetch(req("/mcp", raw), env as unknown as Env, ctx);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
  });
});

// Full HTTP round trip: a real MCP Client speaking Streamable HTTP through
// worker.fetch (no network — the transport's fetch is wired straight to the
// in-process handler, same in-process pattern as webhook.test.ts's
// worker.fetch(request, env, ctx)). This is the ONLY test that proves the wire-up
// all the way through createMcpHandler: the SDK 404s internally whenever
// url.pathname !== the configured route, so handleMcp must pass the REQUEST's own
// pathname as that route — a route hardcoded to the literal "/mcp" would silently
// 404 every /mcp/:owner/:repo call before it ever reached a tool.
async function mcpClient(path: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`https://canopy.example${path}`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => worker.fetch(new Request(input, init), env as unknown as Env, ctx),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("/mcp/:owner/:repo — authorized end-to-end tool call", () => {
  it("a tool call over the real HTTP route returns the gated repo's data", async () => {
    await connect("octo/a");
    const raw = await seedUserWithBearer(LOGIN);
    await storeUserToken(env.DB, LOGIN, { token: "user-tok", refreshToken: null, expiresAt: null });
    _mcpTestHooks.listRepos = [{ repo: "octo/a", can_push: true }];
    await write_plan(env.DB, { narrative: "octo/a plan", milestones: [] }, LOGIN, "octo/a");

    const client = await mcpClient("/mcp/octo/a", raw);
    try {
      const res = (await client.callTool({ name: "get_roadmap", arguments: {} })) as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(res.content[0].text) as { narrative: string };
      expect(data.narrative).toBe("octo/a plan");
    } finally {
      await client.close();
    }
  });
});
