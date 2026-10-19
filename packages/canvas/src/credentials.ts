/**
 * credentials.ts —— /settings 凭据分区的后端（列表 + 吊销）。
 *
 * 零明文纪律（与 cred-mcp broker 同款）：
 *   - keyring 只探"存在性"，不取值——用 `secret-tool search --all agentos-ref <ref>` 列属性
 *     （search 不解锁、不吐 secret；绝不用 lookup——哪怕只做存在性检查也不行）；
 *   - API 返回里只有 引用/标签/通道/白名单/存在性/最近使用时间，永不出现值；
 *   - 最近使用从审计日志反查（extension=cred 的 detail 里带 ref），审计里本来就没有值。
 *
 * 吊销事务（顺序即语义）：①secret-tool clear 删 keyring 条目 → ②从 credentials.yaml
 * 摘除该引用的策略块（缩进块手术，保注释；临时文件+rename 原子落盘，写前 YAML 校验）
 * → ③审计记 credential_revoke（只记引用与结果，永不记值）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { CommandRunner } from "@agentos/proc";

/** 与 cred-mcp broker 同一个策略文件 */
export const DEFAULT_CRED_POLICY_PATH = path.join(
  process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
  "agentos",
  "credentials.yaml",
);

/** 与 broker.assertRef 同款（vault://组/名） */
export function isValidRef(ref: string): boolean {
  return /^vault:\/\/[a-zA-Z0-9._/-]{1,200}$/.test(ref);
}

export interface CredentialRow {
  ref: string;
  label: string;
  /** 开放通道（autofill/execute/inject；与 broker.allowedChannels 同语义） */
  allow: string[];
  exec_allow: string[];
  env: string;
  /** keyring 是否有条目；null = 探测失败（secret-tool 不可用/钥匙环异常），列表照常展示 */
  keyring: boolean | null;
  /** 最近一次被 agent 使用的审计时间（ISO），null = 审计里没有 */
  lastUsed: string | null;
}

interface CredPolicyLike {
  label?: string;
  allow?: string | string[];
  exec_allow?: string[];
  env?: string;
}

function allowedChannels(p: CredPolicyLike): string[] {
  if (p.allow === undefined) return ["execute"]; // 旧条目只写 exec_allow
  const arr = Array.isArray(p.allow) ? p.allow : [p.allow];
  return arr.filter((c) => c === "autofill" || c === "execute" || c === "inject");
}

function readPolicyMap(policyPath: string): Record<string, CredPolicyLike> {
  let raw: string;
  try {
    raw = fs.readFileSync(policyPath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = parseYaml(raw) as { credentials?: Record<string, CredPolicyLike> } | null;
    return parsed?.credentials ?? {};
  } catch {
    return {}; // 坏文件不当机：列表展示空 + 页面提示
  }
}

/** keyring 存在性探测：search --all 只列属性不解锁不取值；secret-tool 不在/报错 → null */
export async function probeKeyring(
  runner: CommandRunner,
  secretTool: string,
  ref: string,
): Promise<boolean | null> {
  const r = await runner.run(secretTool, ["search", "--all", "agentos-ref", ref]);
  if (r.code === 0) return true;
  // 无匹配条目时 secret-tool 以非零退出（通常 1）且 stderr 干净；工具本身缺失/钥匙环异常
  // 会带错误文本（或 code=null spawn 失败）——区分"没有"与"不知道"
  if (r.code === 1 && r.stderr.trim() === "") return false;
  return null;
}

/** 审计反查该 ref 的最近使用时间（detail 只含引用，永不含值） */
export function lastUsedFromAudit(auditPath: string, ref: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(auditPath, "utf8");
  } catch {
    return null;
  }
  let best: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.includes(ref)) continue; // 快速预筛，避免逐行 JSON.parse
    try {
      const e = JSON.parse(line) as { extension?: string; detail?: string; ts?: string };
      if (e.extension === "cred" && typeof e.detail === "string" && e.detail.includes(ref)) {
        const ts = String(e.ts ?? "");
        if (ts && (!best || ts > best)) best = ts;
      }
    } catch {
      // 脏行跳过（readAudit 同款容忍）
    }
  }
  return best;
}

export interface ListDeps {
  runner: CommandRunner;
  policyPath: string;
  auditPath: string;
  secretTool?: string;
}

export async function listCredentials(deps: ListDeps): Promise<CredentialRow[]> {
  const secretTool = deps.secretTool ?? process.env["SECRET_TOOL_BIN"] ?? "secret-tool";
  const map = readPolicyMap(deps.policyPath);
  const rows: CredentialRow[] = [];
  for (const [ref, p] of Object.entries(map)) {
    rows.push({
      ref,
      label: p.label ?? "",
      allow: allowedChannels(p),
      exec_allow: p.exec_allow ?? [],
      env: p.env ?? "AGENTOS_SECRET",
      keyring: await probeKeyring(deps.runner, secretTool, ref),
      lastUsed: lastUsedFromAudit(deps.auditPath, ref),
    });
  }
  return rows;
}

// ---- 吊销：策略文件手术 ----

const indentOf = (line: string): number => (line.match(/^\s*/)?.[0] ?? "").length;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从 credentials.yaml 文本里摘除一个引用的策略块（缩进块手术，保留其余条目与注释）。
 * 返回新文本 + 是否真的摘到了；调用方负责校验与原子落盘。
 */
export function removePolicyEntry(text: string, ref: string): { text: string; removed: boolean } {
  const lines = text.split("\n");
  const keyRe = new RegExp(`^(\\s+)${escapeRegExp(ref)}\\s*:\\s*(#.*)?$`);
  const idx = lines.findIndex((l) => keyRe.test(l));
  if (idx === -1) return { text, removed: false };
  const indent = indentOf(lines[idx]!);
  // 块尾 = 其后最后一条缩进更深（或空行隔开更深）的行；遇到缩进 <= 的行即块结束
  let blockEnd = idx + 1;
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === "") continue;
    if (indentOf(l) > indent) blockEnd = i + 1;
    else break;
  }
  lines.splice(idx, blockEnd - idx);
  return { text: dropEmptyCollectionsKey(lines.join("\n")), removed: true };
}

/** 引用全被摘掉后，把只剩空壳的 `credentials:` 键也收走（避免 YAML 里留 null 键） */
function dropEmptyCollectionsKey(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*credentials\s*:\s*(#.*)?$/.test(l)) {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === "") j++;
      const hasBody = j < lines.length && indentOf(lines[j]!) > indentOf(l);
      if (!hasBody) continue; // 空壳：丢掉这行
    }
    out.push(l);
  }
  return out.join("\n");
}

export interface RevokeDeps {
  runner: CommandRunner;
  policyPath: string;
  auditPath: string;
  secretTool?: string;
  /** 注入时间戳（测试用），缺省 now */
  now?: () => Date;
}

export interface RevokeResult {
  ok: boolean;
  ref: string;
  /** keyring 条目已删（clear 正常返回） */
  keyringCleared: boolean;
  /** secret-tool 报错时的原因（keyringCleared=false 时有意义） */
  keyringError?: string;
  /** 策略条目已从 credentials.yaml 摘除（文件里本来没有则 false） */
  policyRemoved: boolean;
  /** 审计已记 credential_revoke */
  audited: boolean;
  error?: string;
}

/**
 * 吊销一条凭据。步骤失败不静默：①失败会带 keyringError 继续②③（策略摘除后 broker 即拒用，
 * 功能上仍是"已吊销"）；②的写盘校验失败则报错回滚（不落半截文件）。
 */
export async function revokeCredential(deps: RevokeDeps, ref: string): Promise<RevokeResult> {
  if (!isValidRef(ref)) {
    return { ok: false, ref, keyringCleared: false, policyRemoved: false, audited: false, error: `非法凭据引用: ${ref}` };
  }
  const secretTool = deps.secretTool ?? process.env["SECRET_TOOL_BIN"] ?? "secret-tool";

  // ① keyring：删条目（clear 按 agentos-ref 属性精确匹配，幂等——无条目也返回 0）
  const clear = await deps.runner.run(secretTool, ["clear", "agentos-ref", ref]);
  const keyringCleared = clear.code === 0;
  const keyringError = keyringCleared ? undefined : (clear.stderr.trim() || `exit ${clear.code}`).slice(0, 300);

  // ② 策略文件：摘块 → 校验 → 临时文件 + rename 原子落盘
  let policyRemoved = false;
  try {
    const raw = fs.readFileSync(deps.policyPath, "utf8");
    const { text, removed } = removePolicyEntry(raw, ref);
    if (removed) {
      const before = readPolicyMap(deps.policyPath);
      const after = parseYaml(text) as { credentials?: Record<string, unknown> } | null;
      const afterRefs = Object.keys(after?.credentials ?? {});
      const beforeRefs = Object.keys(before);
      if (afterRefs.includes(ref) || afterRefs.length !== beforeRefs.filter((r) => r !== ref).length) {
        throw new Error("摘除后 YAML 校验不符（引用集发生变化），已放弃写入");
      }
      const tmp = `${deps.policyPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, text, "utf8");
      fs.renameSync(tmp, deps.policyPath);
      policyRemoved = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 步骤②失败即中止（不写审计的"成功"口径），①的结果如实带回
    return { ok: false, ref, keyringCleared, keyringError, policyRemoved, audited: false, error: `策略文件更新失败: ${msg}` };
  }

  // ③ 审计：只记引用与三步结果，永不记值（与 @agentos/policy AuditEntry 同构）
  const audited = appendAudit(deps.auditPath, {
    ts: (deps.now ?? (() => new Date()))().toISOString(),
    extension: "settings",
    tool: "credential_revoke",
    decision: "allow",
    detail: `ref=${ref} keyring=${keyringCleared ? "cleared" : `error:${keyringError ?? "?"}`} policy=${policyRemoved ? "removed" : "absent"} via=/settings`,
  });

  return { ok: true, ref, keyringCleared, keyringError, policyRemoved, audited };
}

interface AuditLine {
  ts: string;
  extension: string;
  tool: string;
  decision: string;
  detail?: string;
}

/** 追加一行审计（与 policy.audit 同语义；canvas 不引 policy 包，避免拖依赖面） */
function appendAudit(auditPath: string, entry: AuditLine): boolean {
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch {
    return false; // 审计失败不吊销回滚，但如实上报
  }
}

/** 注册引导文案（cred-store.sh 的用法，路径由调用方解析后传入） */
export function registerGuide(scriptPath: string): string {
  return `printf '凭据明文' | ${scriptPath} vault://组/名 "显示标签" 命令1 命令2
# 例: printf 'ghp_xxx' | ${scriptPath} vault://github/token "GitHub" gh git`;
}
