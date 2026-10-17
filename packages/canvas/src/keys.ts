import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** niri 配置部署位（可用环境变量 AGENTOS_NIRI_CONFIG 覆盖，测试指向 fixture） */
export const DEFAULT_NIRI_CONFIG = path.join(os.homedir(), ".config", "niri", "config.kdl");

export interface KeyBind {
  /** 键位组合，如 "Super+Shift+Return"、"Mod+Ctrl+Left" */
  keys: string;
  /** hotkey-overlay-title；没有注记的 bind 用 action 文本兜底 */
  title: string;
  /** niri 动作，如 'spawn "firefox"'、"focus-workspace 1"（去尾分号、压空白） */
  action: string;
}

export interface KeySection {
  /** binds 段内的分组注释标题（// ==== 标题 ==== 形式） */
  section: string;
  binds: KeyBind[];
}

/** 出现在任何分组注释之前的 bind 归入此节（当前模板没有这种情况，容错用） */
export const UNGROUPED = "未分组";

/** 分组注释：// ============ 标题 ============（等号数量不限） */
const SECTION_RE = /^\s*\/\/\s*=+\s*(.+?)\s*=+\s*$/;
/** 键位组合：字母开头，仅字母/数字/+（Super+Shift+Return、Mod+1、Print） */
const KEYS_RE = /^[A-Za-z][A-Za-z0-9+]*$/;
/** bind 参数里的速查注记（支持转义引号） */
const TITLE_RE = /hotkey-overlay-title\s*=\s*"((?:[^"\\]|\\.)*)"/;

/**
 * 引号外的大括号序列。引号内的 {} 与 // 一律不算——spawn 参数里的
 * URL（http://127.0.0.1/...）自带 // 与 :，不能当注释/括号处理。
 */
function bracesOutsideStrings(line: string): { ch: "{" | "}"; idx: number }[] {
  const out: { ch: "{" | "}"; idx: number }[] = [];
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === "\\") i++; // 转义字符（含 \"）整体跳过
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "}") out.push({ ch: c, idx: i });
  }
  return out;
}

function pushBind(sec: KeySection, keys: string, title: string, rawAction: string): void {
  const action = rawAction.replace(/\s+/g, " ").trim().replace(/;$/, "").trim();
  if (!action) return;
  sec.binds.push({ keys, title: title || action, action });
}

/**
 * 解析 niri config.kdl 的 binds 段 → 按分组注释分节的键位表。
 * 容错原则：认不出的行跳过不炸；跨行 bind 支持到配对为止；
 * EOF 仍未闭合的 bind 丢弃。只认键位数据本身，不做任何手工副本。
 */
export function parseNiriBinds(source: string): KeySection[] {
  const sections: KeySection[] = [];
  const sectionOf = (name: string): KeySection => {
    let s = sections.find((x) => x.section === name);
    if (!s) {
      s = { section: name, binds: [] };
      sections.push(s);
    }
    return s;
  };

  let inBinds = false;
  let depth = 0; // binds 自身的大括号深度为 1
  let section = UNGROUPED;
  let pending: { keys: string; title: string; buf: string } | null = null;

  for (const line of source.split(/\r?\n/)) {
    const braces = bracesOutsideStrings(line);
    const delta =
      braces.filter((b) => b.ch === "{").length - braces.filter((b) => b.ch === "}").length;

    if (!inBinds) {
      if (/^\s*binds\s*\{/.test(line)) {
        inBinds = true;
        depth = delta;
      }
      continue;
    }

    // 跨行 bind 的续行：括号补齐（回到深度 1）即收尾
    if (pending) {
      pending.buf += "\n" + line;
      depth += delta;
      if (depth <= 1) {
        const raw = pending.buf.trimEnd();
        const close = raw.lastIndexOf("}");
        pushBind(sectionOf(section), pending.keys, pending.title, close >= 0 ? raw.slice(0, close) : raw);
        pending = null;
      }
      continue;
    }

    depth += delta;
    if (depth <= 0) {
      inBinds = false; // binds 段结束（独立的 } 行）
      continue;
    }

    // 分组注释 → 切节
    const sec = SECTION_RE.exec(line);
    if (sec) {
      section = sec[1]!.trim();
      continue;
    }
    // 其余注释与空行跳过
    if (line.trim() === "" || /^\s*\/\//.test(line)) continue;

    const open = braces.find((b) => b.ch === "{");
    if (!open) continue; // 认不出的行：容错跳过

    const prefix = line.slice(0, open.idx);
    const keys = prefix.trim().split(/\s+/)[0] ?? "";
    if (!KEYS_RE.test(keys)) continue; // 不以键位组合开头，跳过
    const t = TITLE_RE.exec(prefix);
    const title = t ? t[1]!.replace(/\\"/g, '"').replace(/\\n/g, " ") : "";

    // 从第一个 { 起找配对的 }：配上了是单行 bind，没配上进跨行缓冲
    let local = 0;
    let endIdx = -1;
    for (const b of braces) {
      local += b.ch === "{" ? 1 : -1;
      if (local === 0) {
        endIdx = b.idx;
        break;
      }
    }
    if (endIdx >= 0) {
      pushBind(sectionOf(section), keys, title, line.slice(open.idx + 1, endIdx));
    } else {
      pending = { keys, title, buf: line.slice(open.idx + 1) };
    }
  }
  // EOF 仍未闭合的 pending 丢弃（配置本身已损坏，解析器不该替它编造）

  return sections.filter((s) => s.binds.length > 0);
}

/** 读文件并解析；文件缺失抛出带路径与覆盖方法的明确错误（路由层转 500 JSON） */
export function readKeys(configPath: string): KeySection[] {
  let source: string;
  try {
    source = fs.readFileSync(configPath, "utf8");
  } catch {
    throw new Error(
      `niri 配置不可读：${configPath}（部署位 ~/.config/niri/config.kdl；可用环境变量 AGENTOS_NIRI_CONFIG 指定其他路径）`,
    );
  }
  return parseNiriBinds(source);
}
