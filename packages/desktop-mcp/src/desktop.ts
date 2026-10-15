import { spawn } from "node:child_process";
import type { CommandRunner } from "@agentos/proc";

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
}

/** 二进制可用环境变量覆盖，便于测试与发行版路径差异 */
function defaultBins(): DesktopBins {
  return {
    xdgOpen: process.env["XDG_OPEN_BIN"] ?? "xdg-open",
    notifySend: process.env["NOTIFY_SEND_BIN"] ?? "notify-send",
    wlCopy: process.env["WL_COPY_BIN"] ?? "wl-copy",
    wlPaste: process.env["WL_PASTE_BIN"] ?? "wl-paste",
  };
}

/**
 * 桌面交互客户端：打开目标（系统默认应用）、桌面通知、剪贴板读写。
 * 依赖系统包：xdg-utils、libnotify(notify-send)、wl-clipboard；通知守护进程（如 mako）。
 */
export class DesktopClient {
  constructor(
    private readonly runner: CommandRunner,
    private readonly bins: DesktopBins = defaultBins(),
    private readonly detach: DetachFn = defaultDetach,
  ) {}

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
