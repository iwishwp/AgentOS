import type { CommandRunner, RunOptions, RunResult } from "./runner.js";

export interface RecordedCall {
  cmd: string;
  args: string[];
  input?: string;
  env?: Record<string, string>;
}

/** 测试替身：记录调用、按前缀返回预置结果，不真跑命令。 */
export class FakeRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  private readonly replies: { match: (args: string[]) => boolean; result: RunResult }[] = [];

  /** args 前缀完全匹配的调用返回给定结果；stdout 默认 ""、code 默认 0。 */
  on(prefix: string[], result: Partial<RunResult> = {}): this {
    const full: RunResult = { stdout: "", stderr: "", code: 0, ...result };
    this.replies.push({
      match: (args) => prefix.every((p, i) => args[i] === p),
      result: full,
    });
    return this;
  }

  async run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ cmd, args, input: options.input, env: options.env });
    const hit = this.replies.find((r) => r.match(args));
    return hit ? hit.result : { stdout: "", stderr: "fake: 未预置该命令的返回", code: 1 };
  }

  lastArgs(): string[] | undefined {
    return this.calls.at(-1)?.args;
  }

  last(): RecordedCall | undefined {
    return this.calls.at(-1);
  }
}
