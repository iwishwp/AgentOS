import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * artifacts 全类型统一索引（M2 收尾）：扫描整个工作区（默认 ~/Agent，与 files-mcp
 * 的 Workspace 同一约定，AGENTOS_WORKSPACE 可覆盖），不只 canvas 的 HTML——
 * 文档/图片/数据/录像全部呈现在 http://127.0.0.1:7788/artifacts。
 *
 * 沙箱纪律与 canvas 静态服务同款：所有出网文件经 resolveInside 做 realpath
 * 越界检查（../ 逃逸、指向外部的符号链接都拒绝），.trash（回收站）与隐藏
 * 文件不进索引。
 */

/** 工作区根（files-mcp Workspace 同款语义） */
export const DEFAULT_WORKSPACE = path.join(os.homedir(), "Agent");

/** 工作区根下不做索引的目录名（回收站 + 系统噪音） */
const SKIPPED_DIRS = new Set([".trash", "node_modules"]);

/** 单次扫描的条目上限（与 files-mcp findByName 的 MAX_WALK_ENTRIES 同量级） */
const MAX_WALK_ENTRIES = 10_000;

/** 呈现通道决定分组：网页在线看 / 文档图片由 agent 桌面打开 / 数据杂项下载 */
export type ArtifactKind = "html" | "document" | "image" | "data" | "media" | "misc";

export const KIND_LABELS: Record<ArtifactKind, string> = {
  html: "网页",
  document: "文档",
  image: "图片",
  data: "数据",
  media: "影音",
  misc: "其他",
};

const EXT_KINDS: Record<string, ArtifactKind> = {
  html: "html",
  htm: "html",
  fodt: "document",
  fodp: "document",
  fods: "document",
  odt: "document",
  odp: "document",
  ods: "document",
  doc: "document",
  docx: "document",
  ppt: "document",
  pptx: "document",
  xls: "document",
  xlsx: "document",
  pdf: "document",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  bmp: "image",
  csv: "data",
  tsv: "data",
  json: "data",
  jsonl: "data",
  ndjson: "data",
  txt: "data",
  md: "data",
  xml: "data",
  yaml: "data",
  yml: "data",
  mkv: "media",
  webm: "media",
  mp4: "media",
  mov: "media",
  mp3: "media",
  wav: "media",
  m4a: "media",
};

export function classify(ext: string): ArtifactKind {
  return EXT_KINDS[ext.replace(/^\./, "").toLowerCase()] ?? "misc";
}

export interface ArtifactItem {
  /** 相对工作区根的 posix 路径（如 reports/weekly.fodt），同时用作稳定 id */
  rel: string;
  name: string;
  /** 一级目录（"" = 工作区根），页面按它分组 */
  group: string;
  size: number;
  mtime: string;
  kind: ArtifactKind;
  ext: string;
}

export interface ArtifactIndex {
  workspace: string;
  generatedAt: string;
  total: number;
  items: ArtifactItem[];
}

/**
 * 递归扫描工作区（跳过隐藏文件/.trash/node_modules，忽略目录本身）。
 * 符号链接一律跳过——出网文件必须走 resolveInside 的 realpath 检查，
 * 索引里出现指向外部的链接等于绕过沙箱做信息披露。
 * mtime 倒序（最新产物在前），与 canvas 索引页同一时间观感。
 */
export function listArtifacts(rootRaw: string): ArtifactIndex {
  const root = fs.realpathSync(fs.mkdirSync(rootRaw, { recursive: true }) ?? rootRaw);
  const items: ArtifactItem[] = [];
  let walked = 0;
  const stack: string[] = [root];
  while (stack.length > 0 && walked < MAX_WALK_ENTRIES) {
    const cur = stack.pop()!;
    walked++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // 单目录读失败不拖垮整个索引
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (SKIPPED_DIRS.has(e.name) && e.isDirectory()) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue; // socket/fifo/符号链接不进索引
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join("/");
      const ext = path.extname(e.name).toLowerCase();
      items.push({
        rel,
        name: e.name,
        group: rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "",
        size: st.size,
        mtime: st.mtime.toISOString(),
        kind: classify(ext),
        ext,
      });
    }
  }
  items.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.rel.localeCompare(b.rel));
  return { workspace: root, generatedAt: new Date().toISOString(), total: items.length, items };
}

/**
 * 把索引页/下载请求里的相对路径解析到工作区内部的真实路径；越界即 null。
 * 与 canvas 静态服务的 safe() 同款 realpath 纪律（含不存在路径的父级回溯）。
 */
export function resolveInsideWorkspace(rootRaw: string, rel: string): string | null {
  const root = fs.realpathSync(rootRaw);
  const clean = rel.replace(/^\/+/, "");
  if (clean === "" || clean.includes("\0")) return null;
  const abs = path.resolve(root, clean);
  let existing = abs;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return null;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  let real: string;
  try {
    real = fs.realpathSync(existing);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return path.join(real, ...tail);
}
