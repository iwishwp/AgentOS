import { spawn } from "node:child_process";

export interface RunOptions {
  /** 写入子进程 stdin 的内容，写完即关闭 stdin */
  input?: string;
  /** 追加/覆盖的环境变量（与当前进程 env 合并） */
  env?: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface CommandRunner {
  run(cmd: string, args: string[], options?: RunOptions): Promise<RunResult>;
}

/** 真实执行：spawn 子进程。测试用 @agentos/proc/testing 的 FakeRunner 替换。 */
export class ShellRunner implements CommandRunner {
  async run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.stdin.on("error", () => {}); // 目标进程不读 stdin 时忽略 EPIPE
      p.stdin.end(options.input ?? "");
      p.on("error", (err) => resolve({ stdout, stderr: `${stderr}${err.message}`, code: null }));
      p.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }
}
