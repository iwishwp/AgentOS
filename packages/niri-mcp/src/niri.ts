import type { CommandRunner } from "@agentos/proc";

export class NiriError extends Error {}

/**
 * niri IPC 客户端。统一走 `niri msg` CLI（而非裸 socket 协议），
 * 以官方 CLI 参数面为稳定契约；NIRI_MSG_BIN 可覆盖二进制路径（测试/移植用）。
 */
export class NiriClient {
  readonly bin: string;

  constructor(
    private readonly runner: CommandRunner,
    bin: string = process.env["NIRI_MSG_BIN"] ?? "niri",
  ) {
    this.bin = bin;
  }

  async windows(): Promise<unknown> {
    return this.queryJson("windows");
  }

  async workspaces(): Promise<unknown> {
    return this.queryJson("workspaces");
  }

  async outputs(): Promise<unknown> {
    return this.queryJson("outputs");
  }

  async focusWindow(id: number): Promise<void> {
    await this.action("focus-window", ["--id", String(id)]);
  }

  async focusWorkspace(reference: string): Promise<void> {
    await this.action("focus-workspace", [reference]);
  }

  async moveWindowToWorkspace(id: number | undefined, reference: string): Promise<void> {
    // 注意：niri 各 action 的 id 参数名不一致——move-window-to-workspace 用
    // --window-id（实测 26.04），focus-window/close-window 用 --id
    const args =
      id === undefined ? [reference] : ["--window-id", String(id), reference];
    await this.action("move-window-to-workspace", args);
  }

  async closeWindow(id: number | undefined): Promise<void> {
    const args = id === undefined ? [] : ["--id", String(id)];
    await this.action("close-window", args);
  }

  async spawn(command: string[]): Promise<void> {
    if (command.length === 0) {
      throw new NiriError("spawn 需要至少一个命令参数");
    }
    await this.action("spawn", ["--", ...command]);
  }

  private async queryJson(what: string): Promise<unknown> {
    const r = await this.runner.run(this.bin, ["msg", "--json", what]);
    if (r.code !== 0) {
      throw new NiriError(`niri msg --json ${what} 失败: ${describeFailure(r)}`);
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw new NiriError(`niri msg --json ${what} 输出不是合法 JSON`);
    }
  }

  private async action(name: string, args: string[]): Promise<void> {
    const r = await this.runner.run(this.bin, ["msg", "action", name, ...args]);
    if (r.code !== 0) {
      throw new NiriError(`niri msg action ${name} 失败: ${describeFailure(r)}`);
    }
  }
}

function describeFailure(r: { stderr: string; code: number | null }): string {
  const detail = r.stderr.trim() || `exit ${r.code}`;
  // niri 不在 PATH（或不在 niri 会话内）是最常见的环境问题，给出可操作的提示
  if (r.code === null) {
    return `无法启动 niri（不在 PATH 或不在 niri 会话内？）: ${detail}`;
  }
  return detail;
}
