import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandRunner } from "@agentos/proc";

export class AtspiError extends Error {}

/** 调 scripts/atspi_bridge.py（Python + pyatspi），输出 JSON。 */
export class AtspiBridge {
  private readonly python: string;
  private readonly script: string;

  constructor(
    private readonly runner: CommandRunner,
    python: string = process.env["ATSPI_PY_BIN"] ?? "python3",
    script: string = process.env["ATSPI_BRIDGE"] ??
      path.join(repoRoot(), "scripts", "atspi_bridge.py"),
  ) {
    this.python = python;
    this.script = script;
    if (!fs.existsSync(this.script)) {
      throw new AtspiError(`找不到桥脚本 ${this.script}`);
    }
  }

  async apps(): Promise<unknown> {
    return this.call(["apps"]);
  }

  async tree(app: string, depth: number): Promise<unknown> {
    assertAppName(app);
    return this.call(["tree", app, String(depth)]);
  }

  /** 按名称点击按钮（推荐：树结构跨进程不稳定，名称寻址稳定） */
  async click(app: string, buttonName: string): Promise<unknown> {
    assertAppName(app);
    if (!buttonName.trim()) throw new AtspiError("按钮名不能为空");
    return this.call(["click", app, buttonName]);
  }

  /** 读取应用内全部非空文本节点（读显示屏/结果的主力） */
  async texts(app: string): Promise<unknown> {
    assertAppName(app);
    return this.call(["texts", app]);
  }

  /** 对匹配的可编辑文本节点设置内容（match 为 * 时取第一个） */
  async setTextByMatch(app: string, match: string, text: string): Promise<unknown> {
    assertAppName(app);
    return this.call(["settext", app, match, text]);
  }

  async doAction(app: string, path: number[], actionIndex: number): Promise<unknown> {
    assertAppName(app);
    if (path.length === 0 || path.some((n) => !Number.isInteger(n) || n < 0)) {
      throw new AtspiError("路径必须是非负整数的索引序列");
    }
    return this.call(["action", app, path.join(","), String(actionIndex)]);
  }

  async setText(app: string, path: number[], text: string): Promise<unknown> {
    assertAppName(app);
    if (path.length === 0) throw new AtspiError("路径不能为空");
    return this.call(["text", app, path.join(","), text]);
  }

  private async call(args: string[]): Promise<unknown> {
    const r = await this.runner.run(this.python, [this.script, ...args]);
    if (r.code !== 0) {
      throw new AtspiError(
        `atspi 桥失败: ${r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`}`,
      );
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw new AtspiError("atspi 桥输出不是合法 JSON");
    }
  }
}

function repoRoot(): string {
  // dist/bridge.js → packages/atspi-mcp/dist → 仓库根
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function assertAppName(app: string): void {
  if (!/^[a-zA-Z0-9@._+-]{1,120}$/.test(app)) {
    throw new AtspiError(`非法应用名: ${app}`);
  }
}
