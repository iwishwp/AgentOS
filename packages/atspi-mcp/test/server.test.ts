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
let client: Client;
let script: string;

beforeEach(async () => {
  runner = new FakeRunner();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-atspi-mcp-"));
  script = path.join(dir, "atspi_bridge.py");
  fs.writeFileSync(script, "# fake");
  process.env["ATSPI_BRIDGE"] = script;
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(runner).connect(st);
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
      "a11y_click",
      "a11y_click_sequence",
      "a11y_dump_tree",
      "a11y_list_apps",
      "a11y_read_texts",
      "a11y_set_text",
    ]);
  });

  it("list_apps 返回桥的 JSON", async () => {
    runner.on([script, "apps"], { stdout: '{"apps":[{"name":"x"}]}' });
    const r = await client.callTool({ name: "a11y_list_apps", arguments: {} });
    expect(textOf(r)).toContain('"name"');
  });

  it("dump_tree 默认走桥的 interactive 模式（不附加参数）", async () => {
    runner.on([script, "tree"], { stdout: '{"mode":"interactive","count":2}' });
    await client.callTool({ name: "a11y_dump_tree", arguments: { app: "gnome-calculator" } });
    expect(runner.lastArgs()).toEqual([script, "tree", "gnome-calculator", "16"]);
  });

  it("dump_tree interactive_only=false + compact + roles 透传", async () => {
    runner.on([script, "tree"], { stdout: "{}" });
    await client.callTool({
      name: "a11y_dump_tree",
      arguments: {
        app: "app",
        interactive_only: false,
        compact: true,
        roles: "button, toggle button",
      },
    });
    expect(runner.lastArgs()).toEqual([
      script,
      "tree",
      "app",
      "16",
      "mode=full",
      "compact=1",
      "roles=button,toggle button",
    ]);
  });

  it("click_sequence 按序展开按钮名", async () => {
    runner.on([script, "clickseq"], {
      stdout: '{"done":true,"clicked":8,"failed":null,"results":[]}',
    });
    const r = await client.callTool({
      name: "a11y_click_sequence",
      arguments: { app: "gnome-calculator", names: ["1", "2", "×", "="] },
    });
    expect(textOf(r)).toContain("done");
    expect(runner.lastArgs()).toEqual([
      script,
      "clickseq",
      "gnome-calculator",
      "1",
      "2",
      "×",
      "=",
    ]);
  });

  it("click_sequence 空名单被拒且不触碰桥", async () => {
    const r = await client.callTool({
      name: "a11y_click_sequence",
      arguments: { app: "app", names: [] },
    });
    expect(r.isError).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it("click 按名称寻址", async () => {
    runner.on([script, "click"], { stdout: '{"done":true,"clicked":"7"}' });
    const r = await client.callTool({
      name: "a11y_click",
      arguments: { app: "gnome-calculator", buttonName: "7" },
    });
    expect(textOf(r)).toContain("clicked");
    expect(runner.lastArgs()).toEqual([script, "click", "gnome-calculator", "7"]);
  });

  it("set_text 传 match 与新文本", async () => {
    runner.on([script, "settext"], { stdout: '{"done":true}' });
    const r = await client.callTool({
      name: "a11y_set_text",
      arguments: { app: "app", match: "搜索", text: "AgentOS" },
    });
    expect(textOf(r)).toContain("done");
    expect(runner.lastArgs()).toEqual([script, "settext", "app", "搜索", "AgentOS"]);
  });

  it("桥失败返回 isError 而非协议错误", async () => {
    const r = await client.callTool({ name: "a11y_list_apps", arguments: {} });
    expect(r.isError).toBe(true);
  });

  it("策略 deny 拦截 click 且不触碰桥", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildServer(runner, Policy.fromRules({ a11y: { a11y_click: "deny" } })).connect(st);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(ct);
    const r = await c.callTool({
      name: "a11y_click",
      arguments: { app: "x", buttonName: "7" },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("策略拒绝");
    expect(runner.calls).toHaveLength(0);
  });
});
