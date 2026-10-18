import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { DesktopClient } from "../src/desktop.js";
import type { ShimEvent, ShimSpawn } from "../src/desktop.js";
import {
  OFFICE_EXTS,
  NotifyActionError,
  NOTIFY_SHIM_PY,
  actionTarget,
  chromiumAppArgs,
  parseNotifyAction,
  resolveOpenPath,
} from "../src/notify-action.js";

describe("parseNotifyAction 参数校验", () => {
  it("open_url/open_path 合法形态通过", () => {
    expect(parseNotifyAction({ kind: "open_url", url: "http://127.0.0.1:7788/weekly/" })).toEqual({
      kind: "open_url",
      url: "http://127.0.0.1:7788/weekly/",
    });
    expect(parseNotifyAction({ kind: "open_path", path: "reports/weekly.fodt" })).toEqual({
      kind: "open_path",
      path: "reports/weekly.fodt",
    });
  });

  it("非法 kind 拒绝", () => {
    expect(() => parseNotifyAction({ kind: "run_command", cmd: "rm -rf /" })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction({ kind: "open_url" })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction(null)).toThrow(NotifyActionError);
    expect(() => parseNotifyAction("open_url")).toThrow(NotifyActionError);
  });

  it("open_url 只认 http(s)——防 file:// 与 flag 注入", () => {
    expect(() => parseNotifyAction({ kind: "open_url", url: "file:///etc/passwd" })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction({ kind: "open_url", url: "ftp://x" })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction({ kind: "open_url", url: "--disable-web-security" })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction({ kind: "open_url", url: "" })).toThrow(NotifyActionError);
  });

  it("open_path 拒空与 - 开头（防参数注入）", () => {
    expect(() => parseNotifyAction({ kind: "open_path", path: "  " })).toThrow(NotifyActionError);
    expect(() => parseNotifyAction({ kind: "open_path", path: "--no-sandbox" })).toThrow(NotifyActionError);
  });

  it("actionTarget/resolveOpenPath/chromiumAppArgs", () => {
    expect(actionTarget({ kind: "open_url", url: "https://x/" })).toBe("https://x/");
    const ws = mkdtempSync(path.join(os.tmpdir(), "agentos-ws-"));
    expect(resolveOpenPath("reports/a.fodt", ws)).toBe(path.join(ws, "reports", "a.fodt"));
    expect(resolveOpenPath("/tmp/abs.docx", ws)).toBe("/tmp/abs.docx");
    expect(chromiumAppArgs("http://127.0.0.1:7788/w/")).toEqual([
      "--app=http://127.0.0.1:7788/w/",
      "--password-store=basic",
    ]);
  });
});

/** 可编程 shim 替身：捕获 stdin 参数，按脚本逐行回放 stdout 事件 */
function fakeShim(script: ShimEvent[] | "exit") {
  const seen: { cmd: string; args: string[]; input: unknown }[] = [];
  const spawn: ShimSpawn = (cmd, args, opts) => {
    seen.push({ cmd, args, input: JSON.parse(opts.input) });
    if (script === "exit") {
      opts.onExit(1);
    } else {
      for (const e of script) opts.onLine(e);
    }
    return { kill: () => undefined };
  };
  return { seen, spawn };
}

function makeClient(spawn: ShimSpawn) {
  const detached: { cmd: string; args: string[] }[] = [];
  const desktop = new DesktopClient(new FakeRunner(), {}, (cmd, args) => detached.push({ cmd, args }), spawn);
  return { desktop, detached };
}

const PARAMS = { summary: "周报完成", urgency: "low" as const, timeoutMs: 8000, waitMs: 600_000 };

describe("notifyAction 投递与点击事件", () => {
  it("送达成功 → action 通道；后续 invoked=true 触发回调", async () => {
    const shim = fakeShim([
      { sent: true, id: 42 },
      { invoked: true },
    ]);
    const { desktop } = makeClient(shim.spawn);
    const results: { invoked: boolean; reason?: string }[] = [];
    const delivered = await desktop.notifyAction({ ...PARAMS, actionLabel: "查看产物" }, (o) => results.push(o));
    expect(delivered).toEqual({ delivered: "action", notifId: 42 });
    expect(results).toEqual([{ invoked: true }]);
    // shim 收到完整参数（python3 -c 内嵌脚本 + stdin JSON，键名必须 snake_case——
    // VM 实测曾因 camelCase 键让 shim 崩在 watchdog 注册）
    expect(shim.seen[0]!.cmd).toBe("python3");
    expect(shim.seen[0]!.args[0]).toBe("-c");
    expect(shim.seen[0]!.input).toMatchObject({ summary: "周报完成", urgency: "low" });
    expect(Object.keys(shim.seen[0]!.input as object)).toEqual(
      expect.arrayContaining(["wait_ms", "timeout_ms", "action_label"]),
    );
  });

  it("用户没点（dismissed/expired）→ onResult invoked=false", async () => {
    const shim = fakeShim([
      { sent: true, id: 7 },
      { invoked: false, reason: "expired" },
    ]);
    const { desktop } = makeClient(shim.spawn);
    const results: { invoked: boolean; reason?: string }[] = [];
    const delivered = await desktop.notifyAction(PARAMS, (o) => results.push(o));
    expect(delivered.delivered).toBe("action");
    expect(results).toEqual([{ invoked: false, reason: "expired" }]);
  });

  it("守护进程不可用（sent:false）→ fallback 带原因", async () => {
    const shim = fakeShim([{ sent: false, error: "no notification daemon" }]);
    const { desktop } = makeClient(shim.spawn);
    const delivered = await desktop.notifyAction(PARAMS, () => undefined);
    expect(delivered).toEqual({ delivered: "fallback", reason: "no notification daemon" });
  });

  it("shim 进程直接退出（无 gi/无 python3）→ fallback", async () => {
    const shim = fakeShim("exit");
    const { desktop } = makeClient(shim.spawn);
    const delivered = await desktop.notifyAction(PARAMS, () => undefined);
    expect(delivered).toMatchObject({ delivered: "fallback" });
  });

  it("openUrl：chromium --app + --password-store=basic，不等待退出", () => {
    const { desktop, detached } = makeClient(fakeShim([]).spawn);
    desktop.openUrl("http://127.0.0.1:7788/weekly/");
    expect(detached).toEqual([
      { cmd: "chromium-browser", args: ["--app=http://127.0.0.1:7788/weekly/", "--password-store=basic"] },
    ]);
  });

  it("shim 脚本自带 default 动作与看门狗收尾（防 mako critical 不过期残留）", () => {
    expect(NOTIFY_SHIM_PY).toContain('"default"');
    expect(NOTIFY_SHIM_PY).toContain("CloseNotification");
    expect(NOTIFY_SHIM_PY).toContain("ActionInvoked");
    expect(NOTIFY_SHIM_PY).toContain("NotificationClosed");
  });
});

describe("resolveOpenPath 工作区语义", () => {
  it("AGENTOS_WORKSPACE 覆盖生效（与 files-mcp 同一约定）", () => {
    const prev = process.env.AGENTOS_WORKSPACE;
    try {
      process.env.AGENTOS_WORKSPACE = "/data/ws";
      expect(resolveOpenPath("reports/a.fodt")).toBe(path.join("/data/ws", "reports", "a.fodt"));
    } finally {
      if (prev === undefined) delete process.env.AGENTOS_WORKSPACE;
      else process.env.AGENTOS_WORKSPACE = prev;
    }
  });

  it("office 扩展集合覆盖 fodt/docx 场景；pdf/png 走系统关联", () => {
    expect(OFFICE_EXTS.has(".fodt")).toBe(true);
    expect(OFFICE_EXTS.has(".docx")).toBe(true);
    expect(OFFICE_EXTS.has(".pdf")).toBe(false); // pdf 的系统关联已够可靠
    expect(OFFICE_EXTS.has(".png")).toBe(false);
  });
});
