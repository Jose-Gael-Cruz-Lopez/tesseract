import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCanopyMcpServer } from "../src/mcp";
import { logEvent } from "../src/log";
import type { Env } from "../src/env";

// Issue #22: the structured-log helper — one single-line JSON record per call,
// failure-class outcomes routed to console.error (level "error" in Workers Logs)
// so auth-failure spikes are filterable — plus the mcp_tool call site (every MCP
// tool invocation logs once, scoped to principal + gated repo). The other call
// sites are covered next to their surfaces: repo-gate.test.ts, webhook.test.ts,
// app-login.test.ts, github-app.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

// Spy on both console channels, silenced so test output stays clean.
function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

// The structured lines a spy captured for one `event` flow (other console traffic
// — e.g. the MCP SDK's own output — never parses to a matching record).
function linesFor(spy: { mock: { calls: unknown[][] } }, event: string): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(String(c[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r !== null && r.event === event);
}

describe("logEvent (src/log.ts)", () => {
  it("emits ONE single-line JSON record with event/outcome/repo/login via console.log", () => {
    const spies = spyConsole();
    logEvent({ event: "repo_gate", outcome: "allow", repo: "acme/app", login: "octocat", can_push: true });
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.error).not.toHaveBeenCalled();
    const line = String(spies.log.mock.calls[0][0]);
    expect(line).not.toContain("\n"); // single-line — Workers Logs indexes one record per line
    expect(JSON.parse(line)).toEqual({ event: "repo_gate", outcome: "allow", repo: "acme/app", login: "octocat", can_push: true });
  });

  it("drops undefined fields so optional context (repo/login) never bloats the line", () => {
    const spies = spyConsole();
    logEvent({ event: "webhook", outcome: "processed", github_event: "issues", repo: undefined });
    expect(JSON.parse(String(spies.log.mock.calls[0][0]))).toEqual({ event: "webhook", outcome: "processed", github_event: "issues" });
  });

  it.each(["failure", "deny", "unauthorized", "error"] as const)(
    "routes the failure-class outcome %s to console.error",
    (outcome) => {
      const spies = spyConsole();
      logEvent({ event: "signin", outcome });
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.log).not.toHaveBeenCalled();
      expect(JSON.parse(String(spies.error.mock.calls[0][0]))).toEqual({ event: "signin", outcome });
    }
  );

  it.each(["success", "allow", "processed", "ignored"] as const)(
    "routes the non-failure outcome %s to console.log",
    (outcome) => {
      const spies = spyConsole();
      logEvent({ event: "webhook", outcome });
      expect(spies.log).toHaveBeenCalledTimes(1);
      expect(spies.error).not.toHaveBeenCalled();
    }
  );
});

// The mcp_tool call site: drive a REAL registered tool through real MCP dispatch
// (mirrors test/mcp.repo-scope.test.ts's withClient) and assert the one structured
// line it must emit.
describe("MCP tool calls emit one mcp_tool line (src/mcp.ts)", () => {
  async function callTool(repo: string | undefined, name: string, args: Record<string, unknown>): Promise<void> {
    const server = buildCanopyMcpServer(env as unknown as Env, { login: "agent" }, repo);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("a repo-scoped call logs success with tool/login/repo", async () => {
    const spies = spyConsole();
    await callTool("octo/a", "get_feed", {});
    const lines = linesFor(spies.log, "mcp_tool");
    expect(lines).toEqual([{ event: "mcp_tool", outcome: "success", tool: "get_feed", login: "agent", repo: "octo/a" }]);
  });

  it("a flat /mcp call (no repo) logs success without a repo field", async () => {
    const spies = spyConsole();
    await callTool(undefined, "get_feed", {});
    const lines = linesFor(spies.log, "mcp_tool");
    expect(lines).toEqual([{ event: "mcp_tool", outcome: "success", tool: "get_feed", login: "agent" }]);
  });
});
