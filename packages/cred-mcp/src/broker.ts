import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner, RunResult } from "@agentos/proc";
import { parse } from "yaml";

export class CredError extends Error {}

/** 通道白名单值（credentials.yaml 的 allow 字段） */
export type Channel = "autofill" | "execute" | "inject";

/** 每条凭据的使用策略（~/.config/agentos/credentials.yaml） */
export interface CredPolicy {
  label?: string;
  /** 允许的通道（autofill/execute/inject；缺省仅 execute——向后兼容通道 B） */
  allow?: string | string[];
  /** 允许使用该凭据的可执行文件名（basename 精确匹配）——通道 B/C 的安全边界 */
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

/** cred_inject 的 TTL 上下限（秒）：短 TTL 是通道 C 的安全语义本身 */
export const INJECT_TTL_RANGE = { min: 1, max: 3600 } as const;

const REDACTED = "«redacted»";

/**
 * 凭据代理（通道 B：代执行 ✅ / 通道 A：自动填充 / 通道 C：短期注入）。
 *
 * 安全模型：
 * 1. agent 只传命令数组（无 shell），argv[0] 的 basename 必须命中该凭据的 exec_allow 白名单；
 * 2. 明文只存在于 broker 进程与目标子进程的内存/环境变量里，不进入 agent 上下文；
 * 3. 返回给 agent 的 stdout/stderr 中所有明文出现处一律打码；通道 A 只回长度与 sha256；
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
        allow: allowedChannels(p),
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
    const policy = this.requirePolicy(ref);
    assertChannel(policy, ref, "execute");
    assertExecAllowed(policy, ref, command[0]!);

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

  /**
   * 通道 C：短期注入。broker 起 wrapper 子进程（cred-mcp 自带的 inject-wrapper.js），
   * secret 只进 wrapper 的 env（不上命令行），wrapper 把 env 透传给目标命令并作为独立进程组，
   * TTL 到点收割整组并写"过期"审计。agent 拿到的是 wrapper 的（打码后）输出与存活时长。
   */
  async inject(
    ref: string,
    command: string[],
    ttlSeconds: number,
    onAudit: (entry: { tool: string; detail: string }) => void,
  ): Promise<RunResult & { ttl: number; expired: boolean }> {
    assertRef(ref);
    if (command.length === 0) {
      throw new CredError("command 不能为空");
    }
    const ttl = ttlSeconds;
    if (!Number.isInteger(ttl) || ttl < INJECT_TTL_RANGE.min || ttl > INJECT_TTL_RANGE.max) {
      throw new CredError(`ttl_seconds 须为 ${INJECT_TTL_RANGE.min}–${INJECT_TTL_RANGE.max} 之间的整数（短 TTL 是通道 C 的安全语义）`);
    }
    const policy = this.requirePolicy(ref);
    assertChannel(policy, ref, "inject");
    assertExecAllowed(policy, ref, command[0]!);

    const value = await this.lookup(ref);
    const envName = policy.env ?? "AGENTOS_SECRET";

    const r = await this.runner.run(
      process.execPath,
      [injectWrapperPath(), "--ttl", String(ttl), "--env-name", envName, "--", ...command],
      { env: { AGENTOS_INJECT_SECRET: value, AGENTOS_INJECT_REF: ref } },
    );
    // wrapper 过期收割时 exit code 固定为 124（约定），stderr 会带 AGENTOS_EXPIRED=1 标记
    const expired = /AGENTOS_EXPIRED=1/.test(r.stderr) || r.code === 124;
    if (expired) {
      onAudit({ tool: "cred_inject", detail: `ref=${ref} ttl=${ttl}s expired` });
    }
    return {
      code: r.code,
      stdout: redact(r.stdout, value),
      stderr: redact(r.stderr, value),
      ttl,
      expired,
    };
  }

  /**
   * 通道 A：自动填充。取明文 → 经 CDP 在目标页面里设值+派发事件 → 页面内计算
   * 长度与 sha256 作为唯一回执 → 明文即刻丢弃。
   *
   * cdp 参数是已连接的浏览器客户端（browser-mcp 的 BrowserClient——同一个水族馆浏览器），
   * broker 只依赖它的 open/eval 两个方法（结构类型，避免包间硬依赖）。
   */
  async autofill(
    ref: string,
    url: string,
    selector: string,
    cdp: AutofillTarget,
  ): Promise<{ url: string; selector: string; bytes: number; sha256: string }> {
    assertRef(ref);
    assertSelector(selector);
    if (!/^(https?|data|file|about):/i.test(url)) {
      throw new CredError(`url 须为 http(s)/data/file/about 之一: ${url.slice(0, 100)}`);
    }
    const policy = this.requirePolicy(ref);
    assertChannel(policy, ref, "autofill");

    const value = await this.lookup(ref); // 明文只在本函数栈内存在
    try {
      await cdp.open(url);
      const js = buildFillExpression(selector, value);
      const r = (await cdp.eval(js)) as { value?: { bytes?: number; sha256?: string; error?: string } };
      if (!r?.value || typeof r.value.bytes !== "number" || !r.value.sha256) {
        throw new CredError(`填充失败: ${r?.value?.error ?? "页面内执行无返回"}`);
      }
      return { url, selector, bytes: r.value.bytes, sha256: r.value.sha256 };
    } finally {
      // 明文生命周期 = 本函数栈（JS 字符串不可变，无法"置零"——不把它传出本函数即边界；
      // 与通道 B 同款纪律：只回长度/哈希，值绝不进返回值、日志、审计）
    }
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

  private requirePolicy(ref: string): CredPolicy {
    const file = this.loadPolicyFile();
    const policy = file.credentials?.[ref];
    if (!policy) {
      throw new CredError(`凭据 ${ref} 不在策略文件中（${this.policyPath}），拒绝执行`);
    }
    return policy;
  }

  private loadPolicyFile(): CredPolicyFile {
    try {
      return parse(fs.readFileSync(this.policyPath, "utf8")) as CredPolicyFile;
    } catch {
      throw new CredError(`无法读取凭据策略文件 ${this.policyPath}`);
    }
  }
}

/** 通道 A 的 CDP 目标（browser-mcp BrowserClient 的结构子集） */
export interface AutofillTarget {
  open(url: string): Promise<string>;
  eval(js: string): Promise<unknown>;
}

/** 构造页面内填充表达式（独立导出便于单测）。值经 JSON.stringify 内嵌，无注入面。 */
export function buildFillExpression(selector: string, value: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { error: "selector 未命中: " + ${JSON.stringify(selector)} };
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return { error: "目标不是 input/textarea: " + (el.tagName || "?") };
  }
  const setter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(el.value)).then((buf) => ({
    bytes: new TextEncoder().encode(el.value).length,
    sha256: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  }));
})()`;
}

function allowedChannels(p: CredPolicy): Channel[] {
  if (p.allow === undefined) return ["execute"]; // v0 兼容：只写了 exec_allow 的旧条目
  const arr = Array.isArray(p.allow) ? p.allow : [p.allow];
  return arr.filter((c): c is Channel => c === "autofill" || c === "execute" || c === "inject");
}

function assertChannel(p: CredPolicy, ref: string, channel: Channel): void {
  if (!allowedChannels(p).includes(channel)) {
    throw new CredError(
      `凭据 ${ref} 未开放 ${channel} 通道（credentials.yaml 里该条目需 allow: ${channel}），拒绝执行`,
    );
  }
}

function assertExecAllowed(p: CredPolicy, ref: string, cmd0: string): void {
  const bin = path.basename(cmd0);
  const allow = p.exec_allow ?? [];
  if (!allow.includes(bin)) {
    throw new CredError(`命令 ${bin} 不在 ${ref} 的 exec_allow 白名单（${allow.join("/")}），拒绝执行`);
  }
}

function assertRef(ref: string): void {
  if (!/^vault:\/\/[a-zA-Z0-9._\/-]{1,200}$/.test(ref)) {
    throw new CredError(`非法凭据引用: ${ref}（形如 vault://组/名）`);
  }
}

function assertSelector(selector: string): void {
  if (!selector.trim() || selector.length > 300) {
    throw new CredError("selector 不能为空且须短于 300 字符");
  }
}

function redact(text: string, secret: string): string {
  if (!secret) return text;
  let out = text.split(secret).join(REDACTED);
  const bare = secret.trim();
  if (bare && bare !== secret) out = out.split(bare).join(REDACTED);
  return out;
}

/** wrapper 路径（dist/ 旁的 inject-wrapper.js；可用 AGENTOS_INJECT_WRAPPER 覆盖） */
export function injectWrapperPath(): string {
  return (
    process.env["AGENTOS_INJECT_WRAPPER"] ??
    path.join(path.dirname(new URL(import.meta.url).pathname), "inject-wrapper.js")
  );
}
