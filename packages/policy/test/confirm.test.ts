import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ConfirmClient,
  parseReqId,
  parseWaitResult,
  Policy,
  summarizeArgs,
  audit,
  DEFAULT_AUDIT_PATH,
} from "../src/index.js";
import type { AuditEntry } from "../src/index.js";
import { DEFAULT_POLICY_PATH } from "../src/index.js";

/** gdbus 替身：按调用序返回预置输出 */
class FakeGdbus {
  readonly calls: { args: string[] }[] = [];
  private replies: { method: string; result: { stdout: string; code: number | null } }[] = [];

  on(method: string, stdout: string, code: number | null = 0): this {
    this.replies.push({ method, result: { stdout, code } });
    return this;
  }

  run = async (_cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
    this.calls.push({ args });
    const method = args[args.indexOf("--method") + 1] ?? "";
    const hit = this.replies.find((r) => method.endsWith(`.${r.method}`));
    if (!hit) return { stdout: "", stderr: "fake: 未预置", code: 1 };
    const i = this.replies.indexOf(hit);
    this.replies.splice(i, 1); // 一次性消费，按序匹配
    return { stdout: hit.result.stdout, stderr: "", code: hit.result.code };
  };
}

describe("gdbus 输出解析", () => {
  it("Request 返回值 → req_id", () => {
    expect(parseReqId("(uint32 3,)")).toBe(3);
    expect(parseReqId("（error）")).toBeNull();
  });

  it("Wait 返回值 → choice/by/elapsed", () => {
    const r = parseWaitResult("('allow_once', 'notify-action', uint32 2312,)");
    expect(r).toEqual({ choice: "allow_once", by: "notify-action", elapsedMs: 2312 });
    expect(parseWaitResult("()")).toBeNull();
  });
});

describe("ConfirmClient.ask", () => {
  it("allow_once 放行且不记忆", async () => {
    const g = new FakeGdbus().on("Request", "(uint32 1,)").on("Wait", "('allow_once', 'notify-action', uint32 800,)");
    const c = new ConfirmClient({ run: g.run });
    const r1 = await c.ask("niri", "open_app", "command=alacritty", "t1");
    expect(r1.choice).toBe("allow_once");
    expect(r1.responseMs).toBe(800);
    // 第二次仍要问（allow_once 不记忆）
    g.on("Request", "(uint32 2,)").on("Wait", "('deny_once', 'timeout', uint32 30000,)");
    const r2 = await c.ask("niri", "open_app", "command=alacritty", "t1");
    expect(r2.choice).toBe("deny_once");
  });

  it("allow_session 记内存表：同工具本次会话不再问", async () => {
    const g = new FakeGdbus().on("Request", "(uint32 1,)").on("Wait", "('allow_session', 'notify-action', uint32 900,)");
    const c = new ConfirmClient({ run: g.run });
    const r1 = await c.ask("desktop", "open", "target=/tmp", "t1");
    expect(r1.choice).toBe("allow_session");
    const r2 = await c.ask("desktop", "open", "target=/tmp2", "t1");
    expect(r2.by).toBe("session-memory");
    expect(r2.responseMs).toBe(0);
    // 其他工具不受影响
    g.on("Request", "(uint32 2,)").on("Wait", "('allow_once', 'notify-action', uint32 100,)");
    const r3 = await c.ask("desktop", "notify", "", "t1");
    expect(r3.choice).toBe("allow_once");
  });

  it("always_deny：内存立即生效 + 写回 policy.yaml", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-confirm-"));
    const policyFile = path.join(dir, "policy.yaml");
    fs.writeFileSync(policyFile, "version: 1\nrules:\n  desktop:\n    open: confirm\n");
    const g = new FakeGdbus()
      .on("Request", "(uint32 1,)")
      .on("Wait", "('always_deny', 'notify-action', uint32 1500,)");
    const c = new ConfirmClient({ run: g.run, policyPath: policyFile });
    const r1 = await c.ask("desktop", "open", "target=x", "t1");
    expect(r1.choice).toBe("always_deny");
    // 写回了 deny
    const onDisk = Policy.load(policyFile);
    expect(onDisk.decide("desktop", "open").decision).toBe("deny");
    // 本进程立即拒绝（不再发 D-Bus）
    const r2 = await c.ask("desktop", "open", "target=x", "t1");
    expect(r2.by).toBe("always-deny-memory");
    expect(g.calls).toHaveLength(2); // 只有第一次真正问了
  });

  it("服务不可达 → unavailable（安全默认拒绝）", async () => {
    const g = new FakeGdbus().on("Request", "", 1);
    const c = new ConfirmClient({ run: g.run });
    const r = await c.ask("niri", "close_window", "", "t1");
    expect(r.choice).toBe("deny_once");
    expect(r.unavailable).toBe(true);
  });

  it("Wait 超时返回空 → 客户端兜底 deny_once", async () => {
    const g = new FakeGdbus().on("Request", "(uint32 7,)").on("Wait", "('', '', uint32 0,)");
    const c = new ConfirmClient({ run: g.run });
    const r = await c.ask("niri", "close_window", "", "t1");
    expect(r.choice).toBe("deny_once");
    expect(r.by).toBe("client-timeout");
  });

  it("未知应答值按拒绝处理", async () => {
    const g = new FakeGdbus().on("Request", "(uint32 1,)").on("Wait", "('yes', 'x', uint32 5,)");
    const c = new ConfirmClient({ run: g.run });
    const r = await c.ask("niri", "close_window", "", "t1");
    expect(r.choice).toBe("deny_once");
  });

  it("Request 参数截断到 300 字符（通知正文防线）", async () => {
    const g = new FakeGdbus().on("Request", "(uint32 1,)").on("Wait", "('allow_once', 'notify-action', uint32 1,)");
    const c = new ConfirmClient({ run: g.run });
    await c.ask("niri", "open_app", "x".repeat(1000), "t1");
    const reqArgs = g.calls[0]!.args;
    const i = reqArgs.indexOf("Request") >= 0 ? reqArgs.findIndex((a) => a.endsWith(".Request")) : -1;
    expect(reqArgs[i + 4]!.length).toBeLessThanOrEqual(300);
  });
});

describe("Policy v1（confirm 决策）", () => {
  it("confirm 决策可从规则与默认值读出", () => {
    const p = Policy.fromRules({ desktop: { "*": "confirm", notify: "allow" } }, "deny");
    expect(p.decide("desktop", "open").decision).toBe("confirm");
    expect(p.decide("desktop", "notify").decision).toBe("allow");
    expect(p.decide("niri", "list_windows").decision).toBe("deny");
  });

  it("YAML 文件解析 confirm", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-policy-"));
    const file = path.join(dir, "policy.yaml");
    fs.writeFileSync(file, ["rules:", "  desktop:", '    "*": confirm'].join("\n"));
    const p = Policy.load(file);
    expect(p.decide("desktop", "open").decision).toBe("confirm");
  });

  it("setRule + save 写回后重新加载生效", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-policy-"));
    const file = path.join(dir, "policy.yaml");
    const p = Policy.load(file);
    p.setRule("desktop", "open", "deny");
    p.save(file);
    expect(Policy.load(file).decide("desktop", "open").decision).toBe("deny");
  });
});

describe("审计扩字段", () => {
  it("tier / confirm / snapshot 字段落盘", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-audit-"));
    const file = path.join(dir, "audit.jsonl");
    const entry: AuditEntry = {
      ts: "2026-10-18T00:00:00Z",
      extension: "system",
      tool: "package_install",
      decision: "confirm",
      tier: "t2",
      confirm: { asked: true, result: "allow_once", by: "notify-action", response_ms: 2312 },
      snapshot: "42",
    };
    audit(entry, file);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").trim());
    expect(parsed.tier).toBe("t2");
    expect(parsed.confirm.result).toBe("allow_once");
    expect(parsed.confirm.response_ms).toBe(2312);
    expect(parsed.snapshot).toBe("42");
  });
});

describe("summarizeArgs", () => {
  it("对象参数拼 k=v 摘要并截断", () => {
    expect(summarizeArgs({ target: "/tmp/x" })).toBe("target=/tmp/x");
    expect(summarizeArgs({ a: "x".repeat(200) }, 50).length).toBeLessThanOrEqual(50);
  });
});

describe("默认路径", () => {
  it("audit/policy 路径约定不变", () => {
    expect(DEFAULT_AUDIT_PATH).toContain("agentos/audit.jsonl");
    expect(DEFAULT_POLICY_PATH).toContain("agentos/policy.yaml");
  });
});
