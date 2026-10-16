import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner, RunResult } from "@agentos/proc";
import { parse } from "yaml";

export class CredError extends Error {}

/** 每条凭据的使用策略（~/.config/agentos/credentials.yaml） */
export interface CredPolicy {
  label?: string;
  /** 允许使用该凭据的可执行文件名（basename 精确匹配）——通道 B 的安全边界 */
  exec_allow?: string[];
  /** 注入子进程的环境变量名（默认 AGENTOS_SECRET） */
  env?: string;
}

export interface CredPolicyFile {
  credentials?: Record<string, CredPolicy>;
}

export const DEFAULT_CRED_POLICY_PATH = path.join(
  process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
  "agentos",
  "credentials.yaml",
);

const REDACTED = "«redacted»";

/**
 * 凭据代理（通道 B：代执行）。
 *
 * 安全模型：
 * 1. agent 只传命令数组（无 shell），argv[0] 的 basename 必须命中该凭据的 exec_allow 白名单；
 * 2. 明文只注入子进程的环境变量，不进入 agent 上下文；
 * 3. 返回给 agent 的 stdout/stderr 中所有明文出现处一律打码；
 * 4. 审计只记 引用+命令+决策，永不记值。
 *
 * 后端：Secret Service（经 secret-tool；键属性 agentos-ref=<引用>）。
 */
export class CredBroker {
  private readonly secretTool: string;
  private readonly policyPath: string;

  constructor(
    private readonly runner: CommandRunner,
    opts: { secretTool?: string; policyPath?: string } = {},
  ) {
    this.secretTool = opts.secretTool ?? process.env["SECRET_TOOL_BIN"] ?? "secret-tool";
    this.policyPath = opts.policyPath ?? DEFAULT_CRED_POLICY_PATH;
  }

  /** 列出可用凭据引用与策略（绝不返回值） */
  async list(): Promise<unknown> {
    const file = this.loadPolicyFile();
    const creds = file.credentials ?? {};
    return {
      policy: this.policyPath,
      credentials: Object.entries(creds).map(([ref, p]) => ({
        ref,
        label: p.label ?? "",
        exec_allow: p.exec_allow ?? [],
        env: p.env ?? "AGENTOS_SECRET",
      })),
    };
  }

  /**
   * 通道 B：代执行。secret 注入子进程 env，agent 只拿到打码后的输出。
   * 返回 RunResult 的深拷贝，绝不携带明文。
   */
  async exec(ref: string, command: string[]): Promise<RunResult> {
    assertRef(ref);
    if (command.length === 0) {
      throw new CredError("command 不能为空");
    }
    const file = this.loadPolicyFile();
    const policy = file.credentials?.[ref];
    if (!policy) {
      throw new CredError(`凭据 ${ref} 不在策略文件中（${this.policyPath}），拒绝执行`);
    }
    const bin = path.basename(command[0]!);
    const allow = policy.exec_allow ?? [];
    if (!allow.includes(bin)) {
      throw new CredError(
        `命令 ${bin} 不在 ${ref} 的 exec_allow 白名单（${allow.join("/")}），拒绝执行`,
      );
    }

    const value = await this.lookup(ref);
    const envName = policy.env ?? "AGENTOS_SECRET";

    const r = await this.runner.run(command[0]!, command.slice(1), {
      env: { [envName]: value },
    });
    // 双保险：输出里的明文（含可能的变体）一律打码后再给 agent
    return {
      code: r.code,
      stdout: redact(r.stdout, value),
      stderr: redact(r.stderr, value),
    };
  }

  /** 从 Secret Service 取值（仅存在于 broker 进程内） */
  private async lookup(ref: string): Promise<string> {
    const r = await this.runner.run(this.secretTool, ["lookup", "agentos-ref", ref]);
    if (r.code !== 0) {
      throw new CredError(`secret-tool 查询失败: ${r.stderr.trim() || `exit ${r.code}`}`);
    }
    const value = r.stdout.replace(/\n+$/, "");
    if (!value) {
      throw new CredError(`凭据 ${ref} 无值（不存在，或钥匙环未解锁）`);
    }
    return value;
  }

  private loadPolicyFile(): CredPolicyFile {
    try {
      return parse(fs.readFileSync(this.policyPath, "utf8")) as CredPolicyFile;
    } catch {
      throw new CredError(`无法读取凭据策略文件 ${this.policyPath}`);
    }
  }
}

function assertRef(ref: string): void {
  if (!/^vault:\/\/[a-zA-Z0-9._\/-]{1,200}$/.test(ref)) {
    throw new CredError(`非法凭据引用: ${ref}（形如 vault://组/名）`);
  }
}

function redact(text: string, secret: string): string {
  if (!secret) return text;
  let out = text.split(secret).join(REDACTED);
  const bare = secret.trim();
  if (bare && bare !== secret) out = out.split(bare).join(REDACTED);
  return out;
}
