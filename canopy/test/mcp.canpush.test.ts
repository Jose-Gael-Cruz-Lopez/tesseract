import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import worker, { _mcpTestHooks, _resetMcpTestHooks } from "../src/index";
import { mintToken } from "../src/auth/tokens";
import { storeUserToken } from "../src/auth/user-token";
import { run, first, nowIso, defaultRepo } from "../src/db";
import type { PlanRow } from "@shared/rows";
import type { Env } from "../src/env";

// Issue #20: on /mcp/:owner/:repo the authored/promote-class plan write
// (update_plan) must authorize on the PER-REPO canPush the repo gate computed —
// consistent with the hub routes' requirePush — not on global isAdmin
// (ADMIN_LOGINS). The flat /mcp surface keeps the global-isAdmin gate,
// byte-for-byte unchanged. These drive the REAL route end-to-end (worker.fetch →
// authorizeRepoAccess → handleMcp), same wiring as test/mcp-routes.test.ts, so a
// break anywhere in the canPush threading fails loudly.
// ADMIN_LOGINS binds "admin-user" in vitest.config.ts — that login clears isAdmin().

const ADMIN = "admin-user";
const AGENT = "agent";
const REPO = "octo/a";
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
    ADMIN,
    1
  );
}

// Seed everything the /mcp/:owner/:repo gate needs to ADMIT `login` to REPO with
// the given collaborator level: a bearer, a stored user token, the connected repo
// row, and the GitHub access set (via the test hook) carrying can_push.
async function seedCollaborator(login: string, canPush: boolean): Promise<string> {
  await connect(REPO);
  const raw = await seedUserWithBearer(login);
  await storeUserToken(env.DB, login, { token: "user-tok", refreshToken: null, expiresAt: null });
  _mcpTestHooks.listRepos = [{ repo: REPO, can_push: canPush }];
  return raw;
}

// Real MCP client over the real HTTP route (no network — the transport's fetch is
// wired straight to worker.fetch), copied from test/mcp-routes.test.ts.
async function mcpClient(path: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`https://canopy.example${path}`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => worker.fetch(new Request(input, init), env as unknown as Env, ctx),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { text: res.content[0].text, isError: res.isError };
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

beforeEach(() => { _resetMcpTestHooks(); });
afterEach(() => { _resetMcpTestHooks(); });

describe("/mcp/:owner/:repo — update_plan authorizes on per-repo canPush, not global isAdmin", () => {
  it("DENIES a global admin who is only a read collaborator — update_plan absent, calling it errors, nothing written", async () => {
    const raw = await seedCollaborator(ADMIN, false); // read-only on REPO despite ADMIN_LOGINS
    const client = await mcpClient(`/mcp/${REPO}`, raw);
    try {
      const names = await toolNames(client);
      expect(names).not.toContain("update_plan");
      expect(names).toContain("get_roadmap"); // reads are untouched by the push gate

      const res = await callTool(client, "update_plan", { narrative: "should not land" });
      expect(res.isError).toBeTruthy();
      expect(res.text.toLowerCase()).toContain("not found");
    } finally {
      await client.close();
    }

    const plan = await first<PlanRow>(env.DB, `SELECT * FROM plan WHERE repo = ?`, REPO);
    expect(plan).toBeNull();
  });

  it("ALLOWS a push collaborator who is NOT a global admin — the write lands in the gated repo, stamped with the principal", async () => {
    const raw = await seedCollaborator(AGENT, true); // push on REPO, absent from ADMIN_LOGINS
    const client = await mcpClient(`/mcp/${REPO}`, raw);
    try {
      expect(await toolNames(client)).toContain("update_plan");

      const res = await callTool(client, "update_plan", { narrative: "pushed by a collaborator" });
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.text).version).toBe(1);
    } finally {
      await client.close();
    }

    const plan = await first<PlanRow>(env.DB, `SELECT * FROM plan WHERE repo = ?`, REPO);
    expect(plan?.narrative).toBe("pushed by a collaborator");
    expect(plan?.updated_by).toBe(AGENT);
  });
});

describe("flat /mcp — the global-isAdmin gate is unchanged", () => {
  it("a global admin keeps update_plan with NO repo collaborator state at all", async () => {
    // No connected repo, no user token, no listRepos hook: the flat path never
    // runs the repo gate, so isAdmin alone must still grant the tool.
    const raw = await seedUserWithBearer(ADMIN);
    const client = await mcpClient("/mcp", raw);
    try {
      expect(await toolNames(client)).toContain("update_plan");

      const res = await callTool(client, "update_plan", { narrative: "flat admin write" });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }

    const plan = await first<PlanRow>(env.DB, `SELECT * FROM plan WHERE repo = ?`, defaultRepo(env));
    expect(plan?.narrative).toBe("flat admin write");
    expect(plan?.updated_by).toBe(ADMIN);
  });

  it("a non-admin push collaborator does NOT get update_plan — per-repo canPush never leaks into the flat gate", async () => {
    const raw = await seedCollaborator(AGENT, true); // full per-repo push state, ignored by /mcp
    const client = await mcpClient("/mcp", raw);
    try {
      expect(await toolNames(client)).not.toContain("update_plan");

      const res = await callTool(client, "update_plan", { narrative: "should not land" });
      expect(res.isError).toBeTruthy();
      expect(res.text.toLowerCase()).toContain("not found");
    } finally {
      await client.close();
    }

    // The bootstrap-seeded plan singleton is untouched.
    const plan = await first<PlanRow>(env.DB, `SELECT * FROM plan WHERE repo = ?`, defaultRepo(env));
    expect(plan?.narrative).not.toBe("should not land");
  });
});
