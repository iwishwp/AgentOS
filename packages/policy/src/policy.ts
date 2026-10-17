import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";

/**
 * 决策三值（权限模型 v1，M4）：
 * - allow：T0 免批准，直接执行（仅审计）；
 * - confirm：T1/T2 确认后执行——server 统一包装层（createGate）先发起确认，
 *   批准后执行并把用户选择记入审计；T2 的强认证由工具内的 pkexec/polkit 承担；
 * - deny：拒绝（拒绝原因里指引人工路径）。
 */
export type Decision = "allow" | "deny" | "confirm";

export interface PolicyVerdict {
  decision: Decision;
  /** 命中规则说明，用于审计与拒绝提示 */
  reason: string;
}

interface PolicyFile {
  version?: number;
  defaults?: { decision?: Decision };
  rules?: Record<string, Record<string, Decision>>;
}

export const DEFAULT_POLICY_PATH = path.join(
  process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
  "agentos",
  "policy.yaml",
);

/**
 * 工具级访问策略（权限模型 v1：allow/deny/confirm + 审计 + confirm 决策网关）。
 * 查找顺序：rules[extension][tool] → rules[extension]["*"] → defaults.decision（allow）。
 */
export class Policy {
  private readonly rules: Record<string, Record<string, Decision>>;
  private readonly fallback: Decision;
  private readonly filePath: string | null;

  private constructor(file: PolicyFile, filePath: string | null) {
    this.rules = file.rules ?? {};
    this.fallback = file.defaults?.decision === "deny" ? "deny" : file.defaults?.decision === "confirm" ? "confirm" : "allow";
    this.filePath = filePath;
  }

  static load(file_path: string = DEFAULT_POLICY_PATH): Policy {
    try {
      const raw = fs.readFileSync(file_path, "utf8");
      return new Policy(parse(raw) as PolicyFile, file_path);
    } catch {
      // 无配置文件或解析失败：安全默认（全 allow），当前工具面均非破坏性；
      // 引入敏感动作后默认将改为 deny。
      return new Policy({}, null);
    }
  }

  /** 直接由测试/嵌入方构造（不落盘，always_deny 写回不可用） */
  static fromRules(rules: Record<string, Record<string, Decision>>, fallback: Decision = "allow"): Policy {
    return new Policy({ rules, defaults: { decision: fallback } }, null);
  }

  decide(extension: string, tool: string): PolicyVerdict {
    const ext = this.rules[extension];
    if (ext) {
      const toolDecision = ext[tool];
      if (toolDecision) {
        return { decision: toolDecision, reason: `rule ${extension}.${tool}=${toolDecision}` };
      }
      const star = ext["*"];
      if (star) {
        return { decision: star, reason: `rule ${extension}.*=${star}` };
      }
    }
    return { decision: this.fallback, reason: `default=${this.fallback}` };
  }

  /** 内存中改一条规则（always_deny 写回用） */
  setRule(extension: string, tool: string, decision: Decision): void {
    this.rules[extension] = { ...(this.rules[extension] ?? {}), [tool]: decision };
  }

  /**
   * 把当前规则写回 policy.yaml（always_deny 的持久化路径）。
   * 注意：yaml 序列化会丢掉原文件的注释——这是 v1 的已知取舍，见 permissions.md §4.1。
   */
  save(file_path?: string): void {
    const target = file_path ?? this.filePath;
    if (!target) throw new Error("Policy 由 fromRules 构造，无落盘路径；save 需显式传 file_path");
    const doc: PolicyFile = {
      version: 1,
      defaults: { decision: this.fallback },
      rules: this.rules,
    };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stringify(doc), "utf8");
  }
}

export interface AuditEntry {
  ts: string;
  extension: string;
  tool: string;
  decision: Decision;
  detail?: string;
  /** 权限档位（t0/t1/t2），confirm 决策时必记 */
  tier?: string;
  /** 用户确认过程（M4）：问了吗、用户选了什么、谁回应的、耗时 */
  confirm?: {
    asked: boolean;
    result?: string;
    by?: string;
    response_ms?: number;
  };
  /** 触发的快照编号（T2 变更前快照） */
  snapshot?: string;
}

export const DEFAULT_AUDIT_PATH = path.join(
  process.env["XDG_STATE_HOME"] ?? path.join(os.homedir(), ".local", "state"),
  "agentos",
  "audit.jsonl",
);

/** 追加一条审计记录（失败静默——审计不阻塞工具调用）。路径可用 AGENTOS_AUDIT_PATH 覆盖。 */
export function audit(entry: AuditEntry, file_path?: string): void {
  const target = file_path ?? process.env["AGENTOS_AUDIT_PATH"] ?? DEFAULT_AUDIT_PATH;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // 忽略：磁盘满/权限问题不应让工具调用失败
  }
}
