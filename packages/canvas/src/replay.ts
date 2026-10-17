import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 审计日志路径（与 @agentos/policy 同一约定） */
export const DEFAULT_AUDIT_PATH = path.join(
  process.env["XDG_STATE_HOME"] ?? path.join(os.homedir(), ".local", "state"),
  "agentos",
  "audit.jsonl",
);

/** 录像目录（scripts/record-session.sh 的输出约定：~/Agent/recordings/<时间戳>.mkv） */
export const DEFAULT_RECORDINGS_DIR = path.join(os.homedir(), "Agent", "recordings");

export interface AuditQuery {
  tool?: string;
  tier?: string;
  ext?: string;
  decision?: string;
  since?: string;
  limit?: number;
}

/** JSONL 审计 → 倒序条目（最新在前），可选过滤 */
export function readAudit(file: string, q: AuditQuery = {}): unknown[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  let entries = raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return { ts: "", extension: "?", tool: "(unparsable-line)", decision: "?" };
      }
    });
  if (q.tool) entries = entries.filter((e) => String(e["tool"] ?? "").includes(q.tool!));
  if (q.ext) entries = entries.filter((e) => String(e["extension"] ?? "") === q.ext);
  if (q.tier) entries = entries.filter((e) => String(e["tier"] ?? "") === q.tier);
  if (q.decision) entries = entries.filter((e) => String(e["decision"] ?? "") === q.decision);
  if (q.since) {
    const since = Date.parse(q.since);
    if (!Number.isNaN(since)) {
      entries = entries.filter((e) => {
        const ts = Date.parse(String(e["ts"] ?? ""));
        return !Number.isNaN(ts) && ts >= since;
      });
    }
  }
  entries.reverse(); // 最新在前
  const limit = Math.max(1, Math.min(2000, q.limit ?? 500));
  return entries.slice(0, limit).map(redactEntry);
}

const REDACTED = "«redacted»";
const SECRET_KEY_RE = /pass(word)?|pwd|secret|token|api[-_]?key|credential|private[-_]?key/i;
const TOKEN_VALUE_RES = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI 风格
  /gh[pousr]_[A-Za-z0-9]{8,}/g, // GitHub
  /AKIA[0-9A-Z]{12,}/g, // AWS
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /xox[baprs]-[A-Za-z0-9-]{8,}/g, // Slack
];

/**
 * 打码器兜底：审计日志本身不该有明文（写入侧纪律），这里是出口侧的第二道闸——
 * ① 键名像敏感项（password/secret/token/...）的值一律打码；
 * ② 值里命中常见 token 形态（sk-/ghp_/AKIA/JWT/...）的子串打码。
 */
export function redactEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === "string") {
      out[k] = maskValue(SECRET_KEY_RE.test(k), v);
    } else if (v !== null && typeof v === "object") {
      out[k] = redactDeep(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactDeep(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = maskValue(SECRET_KEY_RE.test(k), v);
    else if (v !== null && typeof v === "object") out[k] = redactDeep(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

function maskValue(keyIsSecret: boolean, v: string): string {
  let s = v;
  if (keyIsSecret && s !== "") s = REDACTED;
  for (const re of TOKEN_VALUE_RES) s = s.replace(re, REDACTED);
  return s;
}

export interface RecordingInfo {
  name: string;
  size: number;
  mtime: string;
}

/** 列出可回放的会话录像（recording 脚本约定 .mkv，忽略隐藏文件与状态文件） */
export function listRecordings(dir: string): RecordingInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: RecordingInfo[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (!e.isFile()) continue;
    if (!/\.(mkv|webm|mp4)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    const st = fs.statSync(full);
    out.push({ name: e.name, size: st.size, mtime: st.mtime.toISOString() });
  }
  // mtime 为主序，同名精度不足时按文件名倒序补齐（录像名即时间戳）
  out.sort((a, b) => b.mtime.localeCompare(a.mtime) || b.name.localeCompare(a.name));
  return out;
}
