import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";
import { buildServer } from "../src/server.js";

let runner: FakeRunner;
let client: Client;

beforeEach(async () => {
  runner = new FakeRunner();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(runner).connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

function textOf(result: { content: unknown }): string {
  const first = (result.content as Array<{ text?: string }>)[0];
  return first?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 4 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "clipboard_read",
      "clipboard_write",
      "notify",
      "open",
    ]);
  });

  it("open 调 xdg-open 并确认", async () => {
    runner.on(["/tmp/a.pdf"]);
    const r = await client.callTool({ name: "open", arguments: { target: "/tmp/a.pdf" } });
    expect(textOf(r)).toContain("/tmp/a.pdf");
    expect(runner.lastArgs()).toEqual(["/tmp/a.pdf"]);
  });

  it("clipboard_write 的文本经 stdin 传递", async () => {
    runner.on([]);
    const r = await client.callTool({
      name: "clipboard_write",
      arguments: { text: "hello" },
    });
    expect(textOf(r)).toContain("5 字符");
    expect(runner.last()?.input).toBe("hello");
  });

  it("notify 非法 urgency 返回 isError", async () => {
    const r = await client.callTool({
      name: "notify",
      arguments: { summary: "x", urgency: "urgent" },
    });
    expect(r.isError).toBe(true);
  });

  it("命令失败时返回 isError 且不中断会话", async () => {
    const r = await client.callTool({ name: "clipboard_read", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("wl-paste");
  });
});
