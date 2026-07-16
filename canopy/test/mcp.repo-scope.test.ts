import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCanopyMcpServer } from "../src/mcp";
import { write_plan } from "../src/tools/plan";
import { run, nowIso } from "../src/db";
import type { Env } from "../src/env";

// Phase 3 (issue #10): the `repo` threaded into buildCanopyMcpServer/handleMcp must
// actually scope every repo-capable tool — that's the whole point of
// /mcp/:owner/:repo. These drive the REAL registered tools through real MCP dispatch
// (mirrors test/mcp.plan.test.ts's withClient), under two DIFFERENT explicit repos,
// to prove isolation AND fail loudly if repo threading is broken: if a tool silently
// ignored the passed repo (e.g. fell back to defaultRepo(env)), BOTH "octo/a" and
// "octo/b" calls below would resolve to the SAME (wrong) repo's data and every
// cross-repo assertion would fail.

const LOGIN = "agent";

async function withClient<T>(repo: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildCanopyMcpServer(env as unknown as Env, { login: LOGIN }, repo);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function callTool(repo: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  return withClient(repo, async (client) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    return { text: res.content[0].text, isError: res.isError };
  });
}

// A live (promoted) doc seeded directly — column shape copied verbatim from
// test/hub-routes.test.ts's seedDoc, so docs_fts (populated by a trigger on the
// `docs` table only, never doc_versions) actually indexes the body for query().
function seedDoc(repo: string, slug: string, title: string, body: string): Promise<unknown> {
  return run(
    env.DB,
    `INSERT INTO docs (repo, slug, section, title, body, current_version, updated_at, updated_by, space)
     VALUES (?, ?, 'reference', ?, ?, 1, ?, 'author', 'canopy')`,
    repo, slug, title, body, nowIso()
  );
}

describe("MCP tools are scoped to the repo threaded through buildCanopyMcpServer", () => {
  it("get_roadmap returns the CALLED repo's plan, never the other repo's", async () => {
    await write_plan(env.DB, { narrative: "repo A plan", milestones: [] }, LOGIN, "octo/a");
    await write_plan(env.DB, { narrative: "repo B plan", milestones: [] }, LOGIN, "octo/b");

    const a = JSON.parse((await callTool("octo/a", "get_roadmap", {})).text) as { narrative: string };
    const b = JSON.parse((await callTool("octo/b", "get_roadmap", {})).text) as { narrative: string };
    expect(a.narrative).toBe("repo A plan");
    expect(b.narrative).toBe("repo B plan");
  });

  it("query is isolated to the called repo — a same-term doc in the other repo never surfaces", async () => {
    await seedDoc("octo/a", "a-doc", "A Doc", "zephyr in repo a");
    await seedDoc("octo/b", "b-doc", "B Doc", "zephyr in repo b");

    const a = JSON.parse((await callTool("octo/a", "query", { q: "zephyr" })).text) as {
      primary: Array<{ id: string }>;
      pointers: Array<{ id: string }>;
    };
    const ids = [...a.primary, ...a.pointers].map((h) => h.id);
    expect(ids).toContain("a-doc");
    expect(ids).not.toContain("b-doc");
  });

  it("get_doc only sees the called repo's doc, even when the other repo has the SAME slug", async () => {
    await seedDoc("octo/a", "shared-slug", "A", "a body");
    await seedDoc("octo/b", "shared-slug", "B", "b body");

    const a = JSON.parse((await callTool("octo/a", "get_doc", { slug: "shared-slug" })).text) as { doc: { body: string } };
    expect(a.doc.body).toBe("a body");
  });

  it("append_feed writes into the called repo, not the other one", async () => {
    const res = JSON.parse((await callTool("octo/a", "append_feed", { summary: "shipped in a", tags: ["infra"] })).text) as { outcome: string };
    expect(res.outcome).toBe("written");

    const aFeed = await env.DB.prepare(`SELECT id FROM feed WHERE repo = 'octo/a'`).all();
    const bFeed = await env.DB.prepare(`SELECT id FROM feed WHERE repo = 'octo/b'`).all();
    expect(aFeed.results.length).toBe(1);
    expect(bFeed.results.length).toBe(0);
  });

  it("record_session writes into the called repo (feed item lands under octo/a, not defaultRepo)", async () => {
    const res = JSON.parse(
      (
        await callTool("octo/a", "record_session", {
          session: { id: "repo-scope-s1", author: "ignored-client-value", ended_at: "2026-01-01T01:00:00Z", skill_version: "1.0" },
          feed_entries: [{ summary: "session summary", body: "", tags: ["infra"], artifacts: { prs: [], commits: [], issues: [] } }],
        })
      ).text
    ) as { feed: { written: number } };
    expect(res.feed).toEqual({ written: 1, unchanged: 0, triaged: 0 });

    const row = await env.DB.prepare(`SELECT repo FROM feed WHERE summary = 'session summary'`).first<{ repo: string }>();
    expect(row?.repo).toBe("octo/a");
  });
});
