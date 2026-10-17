import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGate, Policy, ConfirmClient } from "../src/index.js";
import type { AuditEntry } from "../src/index.js";

type Handler = (args: unknown) => Promise<unknown>;
type Result = { content: [{ text: string }]; isError?: boolean };

/** 最小 server 替身：记录注册，直接调 handler */
class FakeServer {
  readonly tools = new Map<string, Handler>();
  registerTool(name: string, _config: unknown, cb: Handler): unknown {
    this.tools.set(name, cb);
    return name;
  }
  async call(name: string, args: unknown): Promise<Result> {
    return (await this.tools.get(name)!(args)) as Result;
  }
}

function readAudit(file: string): AuditEntry[] {
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function makeConfirm(choice: string, by = "notify-action", ms = 100) {
  const g = {
    run: async () => ({ stdout: "", stderr: "", code: 1 as number | null }),
  };
  const c = new ConfirmClient({ run: g.run });
  // 直接预置 ask 的返回：用子类绕过 D-Bus
  return {
    ...c,
    ask: async () => ({
      choice,
      by,
      responseMs: ms,
      ...(by === "service-unavailable" ? { unavailable: true } : {}),
    }),
  } as ConfirmClient;
}

describe("createGate", () => {
  it("allow：执行 + 审计无 confirm 字段", async () => {
    const auditFile = path.join(mkdtempSync(path.join(os.tmpdir(), "g-")), "a.jsonl");
    process.env["AGENTOS_AUDIT_PATH"] = auditFile;
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "niri",
      policy: Policy.fromRules({ niri: { "*": "allow" } }),
    });
    t("list_windows", {}, async () => ({ content: [{ type: "text", text: "ok" }] }));
    const r = await server.call("list_windows", {});
    expect(r.content[0]!.text).toBe("ok");
    const entries = readAudit(auditFile);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.decision).toBe("allow");
    expect(entries[0]!.confirm).toBeUndefined();
    delete process.env["AGENTOS_AUDIT_PATH"];
  });

  it("deny：拒绝文案与 v0 一致", async () => {
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "files",
      policy: Policy.fromRules({ files: { delete: "deny" } }),
    });
    t("delete", {}, async () => ({ content: [{ type: "text", text: "不应执行" }] }));
    const r = await server.call("delete", { path: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("策略拒绝 files.delete");
    expect(r.content[0]!.text).toContain("rule files.delete=deny");
  });

  it("confirm + 用户 allow_once：放行并审计用户选择与耗时", async () => {
    const auditFile = path.join(mkdtempSync(path.join(os.tmpdir(), "g-")), "a.jsonl");
    process.env["AGENTOS_AUDIT_PATH"] = auditFile;
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "desktop",
      policy: Policy.fromRules({ desktop: { open: "confirm" } }),
      confirm: makeConfirm("allow_once", "notify-action", 2312),
      summary: (_tool, args) => `target=${(args as { target?: string }).target ?? ""}`,
    });
    let ran = false;
    t("open", {}, async () => {
      ran = true;
      return { content: [{ type: "text", text: "已打开" }] };
    });
    const r = await server.call("open", { target: "/tmp/x" });
    expect(ran).toBe(true);
    expect(r.content[0]!.text).toBe("已打开");
    const e = readAudit(auditFile).at(-1)!;
    expect(e.decision).toBe("confirm");
    expect(e.tier).toBe("t1");
    expect(e.confirm).toEqual({ asked: true, result: "allow_once", by: "notify-action", response_ms: 2312 });
    delete process.env["AGENTOS_AUDIT_PATH"];
  });

  it("confirm + 用户 deny_once：拒绝执行", async () => {
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "desktop",
      policy: Policy.fromRules({ desktop: { open: "confirm" } }),
      confirm: makeConfirm("deny_once", "notify-action", 800),
    });
    let ran = false;
    t("open", {}, async () => {
      ran = true;
      return { content: [{ type: "text", text: "x" }] };
    });
    const r = await server.call("open", {});
    expect(ran).toBe(false);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("deny_once");
  });

  it("confirm + 无确认客户端：安全默认拒绝", async () => {
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "desktop",
      policy: Policy.fromRules({ desktop: { "*": "confirm" } }),
    });
    t("open", {}, async () => ({ content: [{ type: "text", text: "x" }] }));
    const r = await server.call("open", {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("org.agentos.Confirm1");
  });

  it("confirm + 服务不可用：明确报因", async () => {
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "desktop",
      policy: Policy.fromRules({ desktop: { "*": "confirm" } }),
      confirm: makeConfirm("deny_once", "service-unavailable", 5),
    });
    t("open", {}, async () => ({ content: [{ type: "text", text: "x" }] }));
    const r = await server.call("open", {});
    expect(r.content[0]!.text).toContain("不可用");
  });

  it("handler 异常转 isError（沿用各 server 行为）", async () => {
    const server = new FakeServer();
    const t = createGate({ server, extension: "x", policy: Policy.fromRules({}) });
    t("boom", {}, async () => {
      throw new Error("炸了");
    });
    const r = await server.call("boom", {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("炸了");
  });

  it("tier 选项与 detail 回调生效（T2 工具）", async () => {
    const auditFile = path.join(mkdtempSync(path.join(os.tmpdir(), "g-")), "a.jsonl");
    process.env["AGENTOS_AUDIT_PATH"] = auditFile;
    const server = new FakeServer();
    const t = createGate({
      server,
      extension: "system",
      policy: Policy.fromRules({ system: { package_install: "confirm" } }),
      confirm: makeConfirm("allow_session", "session-memory", 0),
      tier: "t2",
      detail: () => "packages=sl",
    });
    t("package_install", {}, async () => ({ content: [{ type: "text", text: "装好了" }] }));
    await server.call("package_install", { packages: ["sl"] });
    const e = readAudit(auditFile).at(-1)!;
    expect(e.tier).toBe("t2");
    expect(e.detail).toBe("packages=sl");
    delete process.env["AGENTOS_AUDIT_PATH"];
  });
});
