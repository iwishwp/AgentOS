import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

export type Decision = "allow" | "deny";

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
 * 工具级访问策略（权限模型 v0：allow/deny + 审计；交互式 confirm 到 M4 权限中心）。
 * 查找顺序：rules[extension][tool] → rules[extension]["*"] → defaults.decision（allow）。
 */
export class Policy {
  private readonly rules: Record<string, Record<string, Decision>>;
  private readonly fallback: Decision;

  private constructor(file: PolicyFile) {
    this.rules = file.rules ?? {};
    this.fallback = file.defaults?.decision === "deny" ? "deny" : "allow";
  }

  static load(file_path: string = DEFAULT_POLICY_PATH): Policy {
    try {
      const raw = fs.readFileSync(file_path, "utf8");
      return new Policy(parse(raw) as PolicyFile);
    } catch {
      // 无配置文件或解析失败：安全默认（全 allow），当前工具面均非破坏性；
      // 引入敏感动作后默认将改为 deny。
      return new Policy({});
    }
  }

  /** 直接由测试/嵌入方构造 */
  static fromRules(rules: Record<string, Record<string, Decision>>, fallback: Decision = "allow"): Policy {
    return new Policy({ rules, defaults: { decision: fallback } });
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
}

export interface AuditEntry {
  ts: string;
  extension: string;
  tool: string;
  decision: Decision;
  detail?: string;
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
