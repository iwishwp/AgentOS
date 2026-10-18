import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { DesktopClient } from "../src/desktop.js";
import type { ShimEvent, ShimSpawn } from "../src/desktop.js";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";

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
  it("注册 5 个工具（含 T1 确认入口 confirm）", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "clipboard_read",
      "clipboard_write",
      "confirm",
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

/** 带可编程 shim 的 server（动作通知测试用，不依赖真 python3/D-Bus） */
async function makeActionServer(script: ShimEvent[] | "exit") {
  const r = new FakeRunner();
  const detached: { cmd: string; args: string[] }[] = [];
  const spawn: ShimSpawn = (_cmd, _args, opts) => {
    if (script === "exit") opts.onExit(1);
    else for (const e of script) opts.onLine(e);
    return { kill: () => undefined };
  };
  const desktop = new DesktopClient(r, {}, (cmd, args) => detached.push({ cmd, args }), spawn);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(r, undefined, { desktop }).connect(st);
  const c = new Client({ name: "action-test", version: "0.0.0" });
  await c.connect(ct);
  return { client: c, runner: r, detached };
}

function readAuditRows(): Record<string, string>[] {
  try {
    return fs
      .readFileSync("/tmp/agentos-test-audit.jsonl", "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, string>);
  } catch {
    return [];
  }
}

describe("notify 动作型通知（M2：查看产物）", () => {
  it("带 action 的通知送达成功，返回文案说明点击即打开", async () => {
    const s = await makeActionServer([{ sent: true, id: 5 }]);
    const r = await s.client.callTool({
      name: "notify",
      arguments: {
        summary: "周报完成",
        urgency: "low",
        action: { kind: "open_url", url: "http://127.0.0.1:7788/weekly/" },
      },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("查看产物");
    expect(textOf(r)).toContain("http://127.0.0.1:7788/weekly/");
  });

  it("非法 action.kind 被 zod 判别联合拒在 schema 层（isError，不投递）", async () => {
    const s = await makeActionServer([{ sent: true, id: 1 }]);
    const r = await s.client.callTool({
      name: "notify",
      arguments: { summary: "x", action: { kind: "run_command", cmd: "rm -rf /" } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("open_url");
    expect(textOf(r)).toContain("open_path");
  });

  it("open_url 非法（file://）在 parseNotifyAction 层拒绝", async () => {
    const s = await makeActionServer([{ sent: true, id: 1 }]);
    const r = await s.client.callTool({
      name: "notify",
      arguments: { summary: "x", action: { kind: "open_url", url: "file:///etc/passwd" } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("http");
  });

  it("open_url 点击 → chromium --app 打开 + 审计 notify_action", async () => {
    const s = await makeActionServer([
      { sent: true, id: 9 },
      { invoked: true },
    ]);
    const before = readAuditRows().length;
    const r = await s.client.callTool({
      name: "notify",
      arguments: { summary: "完成", action: { kind: "open_url", url: "http://127.0.0.1:7788/w/" } },
    });
    expect(r.isError).toBeFalsy();
    await new Promise((res) => setTimeout(res, 20)); // 点击回调异步执行
    expect(s.detached).toEqual([
      { cmd: "chromium-browser", args: ["--app=http://127.0.0.1:7788/w/", "--password-store=basic"] },
    ]);
    const rows = readAuditRows().slice(before);
    expect(rows.find((e) => e["tool"] === "notify_action")).toMatchObject({
      extension: "desktop",
      decision: "allow",
      detail: "open_url http://127.0.0.1:7788/w/",
    });
  });

  it("open_path 点击 office 文档 → soffice（detach 白名单）+ 审计", async () => {
    const s = await makeActionServer([
      { sent: true, id: 10 },
      { invoked: true },
    ]);
    const before = readAuditRows().length;
    process.env.AGENTOS_WORKSPACE = "/tmp/agentos-ws-test";
    const r = await s.client.callTool({
      name: "notify",
      arguments: { summary: "报告生成", action: { kind: "open_path", path: "reports/weekly.fodt" } },
    });
    delete process.env.AGENTOS_WORKSPACE;
    expect(r.isError).toBeFalsy();
    await new Promise((res) => setTimeout(res, 20));
    expect(s.detached).toEqual([{ cmd: "soffice", args: ["/tmp/agentos-ws-test/reports/weekly.fodt"] }]);
    const rows = readAuditRows().slice(before);
    expect(rows.find((e) => e["tool"] === "notify_action")).toMatchObject({
      detail: "open_path(soffice) reports/weekly.fodt",
    });
  });

  it("动作通道不可用 → 降级普通通知，正文带目标与交互约定", async () => {
    const s = await makeActionServer([{ sent: false, error: "no notification daemon" }]);
    s.runner.on(["-u", "low"]);
    const r = await s.client.callTool({
      name: "notify",
      arguments: {
        summary: "完成",
        urgency: "low",
        action: { kind: "open_path", path: "reports/a.fodt" },
      },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("动作通道不可用");
    // 降级通知正文含查看目标 + "对我说打开"约定
    const args = s.runner.lastArgs() ?? [];
    expect(args.join(" ")).toContain("reports/a.fodt");
    expect(args.join(" ")).toContain("打开");
  });

  it("shim 崩溃（无 python3/gi 环境）→ 同样走降级路径", async () => {
    const s = await makeActionServer("exit");
    s.runner.on(["-u", "normal"]);
    const r = await s.client.callTool({
      name: "notify",
      arguments: { summary: "x", action: { kind: "open_url", url: "http://127.0.0.1:7788/" } },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("动作通道不可用");
  });
});
