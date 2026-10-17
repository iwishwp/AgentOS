import { spawn } from "node:child_process";
import { DEFAULT_POLICY_PATH, Policy } from "./policy.js";

/** 用户在确认框四个按钮（+超时/服务不可用）里的选择 */
export type ConfirmChoice =
  | "allow_once"
  | "allow_session"
  | "deny_once"
  | "always_deny";

export interface ConfirmOutcome {
  choice: ConfirmChoice;
  /** 谁做的决定：notify-action（点确认横幅）/ respond（编程应答）/ session-memory /
   *  timeout（30s 超时=deny_once）/ always-deny-memory / service-unavailable */
  by: string;
  /** 从发起确认到出结果的毫秒数（审计用） */
  responseMs: number;
  /** org.agentos.Confirm1 服务不可达（安全默认：视为拒绝） */
  unavailable?: boolean;
}

export interface ConfirmDeps {
  /** 执行 gdbus（默认 spawn 子进程；测试注入替身） */
  run?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  now?: () => number;
  /** always_deny 写回的 policy.yaml 路径 */
  policyPath?: string;
  /** 等用户响应的上限（服务端 30s 超时，客户端默认 32s 兜底） */
  askTimeoutMs?: number;
  gdbusBin?: string;
}

export const CONFIRM_DBUS_NAME = "org.agentos.Confirm1";
export const CONFIRM_DBUS_PATH = "/org/agentos/confirm";

function dbusEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!process.env["XDG_RUNTIME_DIR"]) {
    env["XDG_RUNTIME_DIR"] = `/run/user/${process.getuid?.() ?? 1000}`;
  }
  if (!process.env["DBUS_SESSION_BUS_ADDRESS"]) {
    env["DBUS_SESSION_BUS_ADDRESS"] = `unix:path=${env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"]}/bus`;
  }
  return env;
}

async function spawnCapture(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...dbusEnv() },
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (err) => resolve({ stdout, stderr: `${stderr}${err.message}`, code: null }));
    p.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

/** 解析 gdbus call 的返回值 `(uint32 3,)` → 3 */
export function parseReqId(out: string): number | null {
  const m = /uint32\s+(\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

/** 解析 Wait 的返回 `('allow_once', 'notify-action', uint32 2312,)` */
export function parseWaitResult(
  out: string,
): { choice: string; by: string; elapsedMs: number } | null {
  const strings = [...out.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  const num = /uint32\s+(\d+)/.exec(out);
  if (strings.length < 2) return null;
  return { choice: strings[0]!, by: strings[1]!, elapsedMs: num ? Number(num[1]) : 0 };
}

/**
 * org.agentos.Confirm1 的客户端（T1 确认流，permissions.md §4.1）。
 *
 * - 发起 Request → 阻塞 Wait → 拿到用户选择（点确认横幅 / Respond 编程应答 / 30s 超时）；
 * - allow_session 记内存表（本 server 进程生命周期内不再问）；
 * - always_deny 写回 policy.yaml（注：yaml 重写会丢注释，且其他已在跑的 server 进程
 *   在重启前用旧内存规则——本进程由 denied 集合立即生效）；
 * - 服务不可达时返回 unavailable（安全默认 = 拒绝，gate 会转成可读错误）。
 */
export class ConfirmClient {
  private readonly sessionAllow = new Set<string>();
  private readonly denied = new Set<string>();
  private readonly run: NonNullable<ConfirmDeps["run"]>;
  private readonly now: () => number;
  private readonly policyPath: string;
  private readonly askTimeoutMs: number;
  private readonly gdbusBin: string;

  constructor(deps: ConfirmDeps = {}) {
    this.run = deps.run ?? spawnCapture;
    this.now = deps.now ?? (() => Date.now());
    this.policyPath = deps.policyPath ?? DEFAULT_POLICY_PATH;
    this.askTimeoutMs = deps.askTimeoutMs ?? 32_000;
    this.gdbusBin = deps.gdbusBin ?? process.env["GDBUS_BIN"] ?? "gdbus";
  }

  async ask(extension: string, tool: string, summary: string, tier: string): Promise<ConfirmOutcome> {
    const key = `${extension}.${tool}`;
    if (this.denied.has(key)) {
      return { choice: "deny_once", by: "always-deny-memory", responseMs: 0 };
    }
    if (this.sessionAllow.has(key)) {
      return { choice: "allow_session", by: "session-memory", responseMs: 0 };
    }
    const started = this.now();

    const call = (method: string, args: string[], timeoutSec?: number) =>
      this.run(this.gdbusBin, [
        "call",
        "--session",
        "--dest",
        CONFIRM_DBUS_NAME,
        "--object-path",
        CONFIRM_DBUS_PATH,
        ...(timeoutSec ? ["--timeout", String(timeoutSec)] : []),
        "--method",
        `${CONFIRM_DBUS_NAME}.${method}`,
        ...args,
      ]);

    const req = await call("Request", [extension, tool, summary.slice(0, 300), tier], 10);
    if (req.code !== 0) {
      return {
        choice: "deny_once",
        by: "service-unavailable",
        responseMs: this.now() - started,
        unavailable: true,
      };
    }
    const reqId = parseReqId(req.stdout);
    if (reqId == null) {
      return {
        choice: "deny_once",
        by: "service-unavailable",
        responseMs: this.now() - started,
        unavailable: true,
      };
    }

    const wait = await call("Wait", [String(reqId), String(this.askTimeoutMs)], Math.ceil(this.askTimeoutMs / 1000) + 10);
    const responseMs = this.now() - started;
    if (wait.code !== 0) {
      return { choice: "deny_once", by: "client-timeout", responseMs };
    }
    const parsed = parseWaitResult(wait.stdout);
    if (!parsed || parsed.choice === "") {
      // Wait 超时仍未 resolved（服务端 30s 会给出 deny_once，这里是双保险）
      return { choice: "deny_once", by: "client-timeout", responseMs };
    }
    const outcome: ConfirmOutcome = {
      choice: normalizeChoice(parsed.choice),
      by: parsed.by || "notify-action",
      responseMs: parsed.elapsedMs || responseMs,
    };
    this.remember(key, outcome.choice);
    return outcome;
  }

  private remember(key: string, choice: string): void {
    if (choice === "allow_session") {
      this.sessionAllow.add(key);
    } else if (choice === "always_deny") {
      this.denied.add(key);
      this.persistAlwaysDeny(key);
    }
  }

  /** always_deny → 写回 policy.yaml（rules.<ext>.<tool>=deny） */
  private persistAlwaysDeny(key: string): void {
    try {
      const [ext, tool] = key.split(".");
      if (!ext || !tool) return;
      const p = Policy.load(this.policyPath);
      p.setRule(ext, tool, "deny");
      p.save(this.policyPath);
    } catch {
      // 写盘失败不影响内存拒绝（denied 集合已生效）
    }
  }
}

function normalizeChoice(raw: string): ConfirmChoice {
  switch (raw) {
    case "allow_once":
    case "allow_session":
    case "deny_once":
    case "always_deny":
      return raw;
    default:
      return "deny_once"; // 未知应答一律按拒绝处理
  }
}

/** 便捷函数：拼确认通知里给用户看的参数摘要（各 server 可自定义） */
export function summarizeArgs(args: unknown, maxLen = 120): string {
  try {
    const s =
      typeof args === "object" && args !== null
        ? Object.entries(args as Record<string, unknown>)
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(" ")
        : String(args);
    return s.slice(0, maxLen);
  } catch {
    return "(参数摘要不可用)";
  }
}
