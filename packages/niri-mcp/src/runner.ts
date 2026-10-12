import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface CommandRunner {
  run(cmd: string, args: string[]): Promise<RunResult>;
}

/** 真实执行：spawn 子进程跑命令。测试用 fake 实现替换。 */
export class ShellRunner implements CommandRunner {
  async run(cmd: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", (err) => resolve({ stdout, stderr: `${stderr}${err.message}`, code: null }));
      p.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }
}
