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

let runner: FakeRunner;
let client: Client;

beforeEach(async () => {
  runner = new FakeRunner();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-atspi-mcp-"));
  // 让 bridge 构造时能找到"脚本"
  process.env["ATSPI_BRIDGE"] = path.join(dir, "atspi_bridge.py");
  fs.writeFileSync(process.env["ATSPI_BRIDGE"], "# fake");
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(runner).connect(st);
  client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
});

function textOf(r: { content: unknown }): string {
  return (r.content as Array<{ text?: string }>)[0]?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 4 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "a11y_do_action",
      "a11y_dump_tree",
      "a11y_list_apps",
      "a11y_set_text",
    ]);
  });

  it("list_apps 返回桥的 JSON", async () => {
    runner.on([process.env["ATSPI_BRIDGE"]!, "apps"], { stdout: '{"apps":[{"name":"x"}]}' });
    const r = await client.callTool({ name: "a11y_list_apps", arguments: {} });
    expect(textOf(r)).toContain('"name"');
  });

  it("do_action 透传路径参数", async () => {
    const script = process.env["ATSPI_BRIDGE"]!;
    runner.on([script, "action"], { stdout: '{"done":true}' });
    const r = await client.callTool({
      name: "a11y_do_action",
      arguments: { app: "calc", path: [0, 1, 2], actionIndex: 0 },
    });
    expect(textOf(r)).toContain("done");
    expect(runner.lastArgs()).toEqual([script, "action", "calc", "0,1,2", "0"]);
  });

  it("桥失败返回 isError 而非协议错误", async () => {
    const r = await client.callTool({ name: "a11y_list_apps", arguments: {} });
    expect(r.isError).toBe(true);
  });

  it("策略 deny 拦截 do_action", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildServer(runner, Policy.fromRules({ a11y: { a11y_do_action: "deny" } })).connect(
      st,
    );
    const c = new Client({ name: "t", version: "0" });
    await c.connect(ct);
    const r = await c.callTool({
      name: "a11y_do_action",
      arguments: { app: "x", path: [0] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("策略拒绝");
    expect(runner.calls).toHaveLength(0);
  });
});
