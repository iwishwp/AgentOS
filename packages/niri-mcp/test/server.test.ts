import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { FakeRunner } from "./fake.js";

const TOOL_NAMES = [
  "list_windows",
  "list_workspaces",
  "list_outputs",
  "focus_window",
  "focus_workspace",
  "move_window_to_workspace",
  "close_window",
  "open_app",
];

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
  it("注册全部 8 个工具，描述非空", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("list_windows 返回解析好的 JSON", async () => {
    runner.on(["msg", "-j", "windows"], {
      stdout: '[{"id":3,"title":"firefox","is_focused":true}]',
    });
    const r = await client.callTool({ name: "list_windows", arguments: {} });
    expect(JSON.parse(textOf(r))).toEqual([{ id: 3, title: "firefox", is_focused: true }]);
  });

  it("open_app 转发命令并确认", async () => {
    runner.on(["msg", "action", "spawn"]);
    const r = await client.callTool({
      name: "open_app",
      arguments: { command: ["firefox", "--new-window"] },
    });
    expect(textOf(r)).toContain("firefox --new-window");
    expect(runner.lastArgs()).toEqual([
      "msg",
      "action",
      "spawn",
      "--",
      "firefox",
      "--new-window",
    ]);
  });

  it("focus_window 缺 id 时参数校验失败，返回 isError 且不触碰 niri", async () => {
    const r = await client.callTool({ name: "focus_window", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("id");
    expect(runner.calls).toHaveLength(0);
  });

  it("niri 失败时返回 isError 结果而非协议错误", async () => {
    const r = await client.callTool({
      name: "focus_workspace",
      arguments: { reference: "web" },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("focus-workspace");
  });
});
