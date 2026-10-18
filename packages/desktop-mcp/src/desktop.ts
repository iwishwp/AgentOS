import { spawn } from "node:child_process";
import type { CommandRunner } from "@agentos/proc";
import {
  NOTIFY_SHIM_PY,
  chromiumAppArgs,
  dbusEnv,
  type NotifyShimParams,
} from "./notify-action.js";

export class DesktopError extends Error {}

export type Urgency = "low" | "normal" | "critical";

/** 后台拉起应用不等待（fire-and-forget），注入以便测试 */
export type DetachFn = (cmd: string, args: string[]) => void;

function defaultDetach(cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.unref();
}

/** “指定应用打开”支持的别名（白名单，避免任意程序执行） */
const OPEN_WITH_APPS: Record<string, string> = {
  libreoffice: "soffice",
  soffice: "soffice",
};

export interface DesktopBins {
  xdgOpen: string;
  notifySend: string;
  wlCopy: string;
  wlPaste: string;
  /** 动作通知的 D-Bus shim 解释器 */
  python3?: string;
  /** open_url 动作用的应用窗口浏览器 */
  chromium?: string;
}

/** 二进制可用环境变量覆盖，便于测试与发行版路径差异 */
function defaultBins(): DesktopBins {
  return {
    xdgOpen: process.env["XDG_OPEN_BIN"] ?? "xdg-open",
    notifySend: process.env["NOTIFY_SEND_BIN"] ?? "notify-send",
    wlCopy: process.env["WL_COPY_BIN"] ?? "wl-copy",
    wlPaste: process.env["WL_PASTE_BIN"] ?? "wl-paste",
    python3: process.env["PYTHON3_BIN"] ?? "python3",
    chromium: process.env["CHROMIUM_BIN"] ?? "chromium-browser",
  };
}

/** 动作通知 shim 的 stdout 事件（每行一个 JSON） */
export interface ShimEvent {
  sent?: boolean;
  id?: number;
  error?: string;
  invoked?: boolean;
  reason?: string;
}

/** 长 lived shim 进程的抽象（真实现 spawn python3；测试注入替身） */
export type ShimProc = { kill(): void };
export type ShimSpawn = (
  cmd: string,
  args: string[],
  opts: { input: string; env: Record<string, string>; onLine: (e: ShimEvent) => void; onExit: (code: number | null) => void },
) => ShimProc;

function defaultShimSpawn(
  cmd: string,
  args: string[],
  opts: { input: string; env: Record<string, string>; onLine: (e: ShimEvent) => void; onExit: (code: number | null) => void },
): ShimProc {
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, ...opts.env },
  });
  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === "") continue;
      try {
        opts.onLine(JSON.parse(line) as ShimEvent);
      } catch {
        // shim 的非 JSON 输出（警告等）忽略
      }
    }
  });
  child.on("error", () => opts.onExit(null));
  child.on("close", (code) => opts.onExit(code));
  child.stdin?.write(opts.input);
  child.stdin?.end();
  return { kill: () => child.kill() };
}

/**
 * 桌面交互客户端：打开目标（系统默认应用）、桌面通知（含动作型）、剪贴板读写。
 * 依赖系统包：xdg-utils、libnotify(notify-send)、wl-clipboard、python3+PyGObject
 * （动作通知 shim）、通知守护进程（如 mako）。
 */
export class DesktopClient {
  private readonly bins: DesktopBins;
  constructor(
    private readonly runner: CommandRunner,
    bins: DesktopBins = defaultBins(),
    private readonly detach: DetachFn = defaultDetach,
    private readonly spawnShim: ShimSpawn = defaultShimSpawn,
  ) {
    // 与缺省合并：注入方可只覆盖关心的键（向后兼容旧测试的 BINS 字面量）
    this.bins = { ...defaultBins(), ...bins };
  }

  async open(target: string): Promise<void> {
    if (!target.trim()) {
      throw new DesktopError("open 需要非空目标（文件路径/目录/URL）");
    }
    const r = await this.runner.run(this.bins.xdgOpen, [target]);
    if (r.code !== 0) {
      throw new DesktopError(`xdg-open 失败: ${describe(r)}（xdg-utils 装了吗？）`);
    }
  }

  /** 指定应用打开（白名单别名，如 libreoffice）。系统 MIME 关联不可靠时的兜底。 */
  async openWith(app: string, target: string): Promise<void> {
    const bin = OPEN_WITH_APPS[app];
    if (!bin) {
      throw new DesktopError(`不支持的应用别名: ${app}（支持: ${Object.keys(OPEN_WITH_APPS).join("/")}）`);
    }
    if (!target.trim()) {
      throw new DesktopError("open 需要非空目标（文件路径/目录/URL）");
    }
    this.detach(bin, [target]);
  }

  async notify(
    summary: string,
    body: string | undefined,
    urgency: Urgency,
    timeoutMs: number | undefined,
  ): Promise<void> {
    if (!summary.trim()) {
      throw new DesktopError("notify 需要 summary");
    }
    const args = ["-u", urgency];
    if (timeoutMs !== undefined) args.push("-t", String(timeoutMs));
    args.push(summary);
    if (body !== undefined) args.push(body);
    const r = await this.runner.run(this.bins.notifySend, args);
    if (r.code !== 0) {
      throw new DesktopError(`notify-send 失败: ${describe(r)}（libnotify 装了吗？通知守护进程 mako 在跑吗？）`);
    }
  }

  /**
   * 动作型通知：发一条带默认动作（"点击即触发"）的 D-Bus 通知。
   * 返回投递结果：python3/gi/通知守护进程任一不可用 → "fallback"（调用方降级为
   * 普通 notify-send，正文带目标地址）。点击与否不阻塞本调用：终态事件异步回调
   * onResult（invoked=true 才有业务意义；dismissed/expired/timeout 仅收尾）。
   */
  notifyAction(
    params: NotifyShimParams & { actionLabel?: string },
    onResult: (outcome: { invoked: boolean; reason?: string }) => void,
  ): Promise<{ delivered: "action"; notifId?: number } | { delivered: "fallback"; reason: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let firstEvent = true;
      this.spawnShim(
        this.bins.python3 ?? "python3",
        ["-c", NOTIFY_SHIM_PY],
        {
          // shim 是 python（snake_case）：这里做一次键名转换，VM 实测曾因 camelCase
          // 键 KeyError 崩在 watchdog 注册（notify-action 的教训）
          input: JSON.stringify({
            summary: params.summary,
            body: params.body,
            urgency: params.urgency,
            timeout_ms: params.timeoutMs,
            wait_ms: params.waitMs,
            action_label: params.actionLabel,
          }),
          env: dbusEnv(),
          onLine: (e) => {
            if (firstEvent) {
              firstEvent = false;
              settled = true;
              if (e.sent) resolve({ delivered: "action", notifId: e.id });
              else resolve({ delivered: "fallback", reason: e.error ?? "notify shim 未送达" });
              return;
            }
            if (e.invoked === true) onResult({ invoked: true });
            else if (e.invoked === false) onResult({ invoked: false, reason: e.reason });
          },
          onExit: (code) => {
            if (!settled) {
              settled = true;
              resolve({ delivered: "fallback", reason: `shim 退出（code ${code ?? "null"}）` });
            }
          },
        },
      );
    });
  }

  /** URL 以 chromium 应用窗口呈现（--password-store=basic 必带，M3 教训） */
  openUrl(url: string): void {
    this.detach(this.bins.chromium ?? "chromium-browser", chromiumAppArgs(url));
  }

  async clipboardRead(): Promise<string> {
    const r = await this.runner.run(this.bins.wlPaste, ["--no-newline"]);
    if (r.code !== 0) {
      throw new DesktopError(`wl-paste 失败: ${describe(r)}（wl-clipboard 装了吗？在 Wayland 会话内吗？）`);
    }
    return r.stdout;
  }

  async clipboardWrite(text: string): Promise<void> {
    const r = await this.runner.run(this.bins.wlCopy, [], { input: text });
    if (r.code !== 0) {
      throw new DesktopError(`wl-copy 失败: ${describe(r)}（wl-clipboard 装了吗？在 Wayland 会话内吗？）`);
    }
  }
}

function describe(r: { stderr: string; code: number | null }): string {
  return r.stderr.trim() || `exit ${r.code}`;
}
