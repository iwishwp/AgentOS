import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Policy } from "@agentos/policy";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";

let client: Client;

beforeEach(async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(
    {
      launch: () => {},
      httpGetJson: async () => [{ type: "page", webSocketDebuggerUrl: "ws://x" }],
      connect: async () => ({
        send: async (method: string) => {
          if (method === "Runtime.evaluate") return { result: { value: "ok" } };
          if (method === "Page.navigate") return {};
          throw new Error("nope");
        },
        close() {},
      }),
      wait: () => Promise.resolve(),
    },
    Policy.fromRules({}),
  ).connect(st);
  client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
});

function textOf(r: { content: unknown }): string {
  return (r.content as Array<{ text?: string }>)[0]?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 3 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["browser_eval", "browser_open", "browser_screenshot"]);
  });

  it("browser_open + browser_eval 闭环", async () => {
    const o = await client.callTool({
      name: "browser_open",
      arguments: { url: "https://example.com/" },
    });
    expect(textOf(o)).toContain("已导航");
    const e = await client.callTool({
      name: "browser_eval",
      arguments: { js: "document.title" },
    });
    expect(textOf(e)).toContain("ok");
  });

  it("策略 deny 拦截", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildServer(
      { launch: () => {}, httpGetJson: async () => { throw new Error("x"); }, wait: () => Promise.resolve() },
      Policy.fromRules({ browser: { "*": "deny" } }),
    ).connect(st);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(ct);
    const r = await c.callTool({ name: "browser_open", arguments: { url: "https://x.com/" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("策略拒绝");
  });
});
