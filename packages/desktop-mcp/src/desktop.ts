import type { CommandRunner } from "@agentos/proc";

export class DesktopError extends Error {}

export type Urgency = "low" | "normal" | "critical";

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
