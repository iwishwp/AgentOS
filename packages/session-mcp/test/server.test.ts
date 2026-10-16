import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import { Policy } from "@agentos/policy";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";

let runner: FakeRunner;
let runtimeDir: string;
let client: Client;

beforeEach(async () => {
  runner = new FakeRunner();
  runtimeDir = mkdtempSync(path.join(os.tmpdir(), "agentos-mcp-rt-"));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer({
    runner,
    runtimeDir,
    screenshotsDir: mkdtempSync(path.join(os.tmpdir(), "agentos-mcp-shots-")),
    launch: () => {
      fs.writeFileSync(path.join(runtimeDir, "niri.wayland-9.41234.sock"), "");
      return 41234;
    },
    wait: () => Promise.resolve(),
  }).connect(st);
  client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
});

function textOf(r: { content: unknown }): string {
  return (r.content as Array<{ text?: string }>)[0]?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 6 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "agent_list_windows",
      "agent_open_app",
      "agent_screenshot",
      "agent_session_start",
      "agent_session_status",
      "agent_session_stop",
    ]);
  });

  it("start → open_app → windows 全链路（env 路由到嵌套会话）", async () => {
    await client.callTool({ name: "agent_session_start", arguments: {} });
    runner.on(["msg", "action", "spawn"]);
    const open = await client.callTool({
      name: "agent_open_app",
      arguments: { command: ["alacritty"] },
    });
    expect(textOf(open)).toContain("alacritty");
    expect(runner.last()?.env?.["NIRI_SOCKET"]).toContain("wayland-9");
    runner.on(["msg", "--json", "windows"], { stdout: "[]" });
    const wins = await client.callTool({ name: "agent_list_windows", arguments: {} });
    expect(textOf(wins)).toContain("[]");
  });

  it("未启动时 open_app 返回 isError 且信息可读", async () => {
    const r = await client.callTool({
      name: "agent_open_app",
      arguments: { command: ["x"] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("未运行");
  });

  it("策略 deny 拦截", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildServer(
      { runner, runtimeDir, launch: () => 1, wait: () => Promise.resolve() },
      Policy.fromRules({ session: { agent_session_start: "deny" } }),
    ).connect(st);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(ct);
    const r = await c.callTool({ name: "agent_session_start", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("策略拒绝");
  });
});
