/**
 * ghostty-reload.ts —— 已开 ghostty 窗口热重载。
 * 照搬 scripts/theme-apply-all.sh 的 reload_ghostty_windows：
 *   focus 每个窗口 + wtype 注入默认键 ctrl+shift+,（reload_config）。
 * 条件全满足才做：niri socket 可发现 + wtype 存在；失败静默跳过（新开窗口本就生效）。
 * WAYLAND_DISPLAY 缺失时从 niri socket 文件名推导（niri.wayland-1.1437.sock → wayland-1），
 * 让 systemd 用户单例（无会话 env 继承）也能注入。
 */
import type { CommandRunner } from "@agentos/proc";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sleep } from "./fsutil.js";

export interface GhosttyReloadResult {
  attempted: boolean;
  reloaded: number;
  reason?: string;
}

export async function discoverNiriSocket(runtimeDir: string): Promise<string | null> {
  try {
    const entries = await readdir(runtimeDir);
    const hit = entries.find((n) => /^niri\.wayland-.*\.sock$/.test(n));
    return hit ? join(runtimeDir, hit) : null;
  } catch {
    return null;
  }
}

/** niri.wayland-1.1437.sock → wayland-1（推导不到返回 null） */
export function deriveWaylandDisplay(socketPath: string): string | null {
  const m = /niri\.(.+)\.\d+\.sock$/.exec(socketPath);
  return m?.[1] ?? null;
}

export async function reloadGhosttyWindows(
  runner: CommandRunner,
  runtimeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GhosttyReloadResult> {
  const sock = await discoverNiriSocket(runtimeDir);
  if (!sock) return { attempted: false, reloaded: 0, reason: "niri socket 未发现" };
  const wtype = await runner.run("sh", ["-c", "command -v wtype"]);
  if (wtype.code !== 0) return { attempted: false, reloaded: 0, reason: "wtype 不存在" };

  const childEnv: Record<string, string> = { ...filterEnv(env), NIRI_SOCKET: sock };
  if (!childEnv.WAYLAND_DISPLAY) {
    const derived = deriveWaylandDisplay(sock);
    if (derived) childEnv.WAYLAND_DISPLAY = derived;
  }

  // 记住当前焦点，重载后还原
  const focused = await runner.run("niri", ["msg", "--json", "focused-window"], { env: childEnv });
  let prevId: number | null = null;
  try {
    prevId = (JSON.parse(focused.stdout) as { id?: number }).id ?? null;
  } catch {
    prevId = null;
  }

  const windows = await runner.run("niri", ["msg", "--json", "windows"], { env: childEnv });
  let ids: number[] = [];
  try {
    const list = JSON.parse(windows.stdout) as Array<{ id?: number; app_id?: string }>;
    ids = list.filter((w) => w.app_id === "com.mitchellh.ghostty" && typeof w.id === "number").map((w) => w.id!);
  } catch {
    ids = [];
  }

  let reloaded = 0;
  for (const gid of ids) {
    const focus = await runner.run("niri", ["msg", "action", "focus-window", "--id", String(gid)], { env: childEnv });
    if (focus.code !== 0) continue;
    await sleep(150);
    const inject = await runner.run("wtype", ["-M", "ctrl", "-M", "shift", "-k", "comma", "-m", "shift", "-m", "ctrl"], { env: childEnv });
    if (inject.code === 0) reloaded++;
    await sleep(250);
  }
  if (prevId !== null) {
    await runner.run("niri", ["msg", "action", "focus-window", "--id", String(prevId)], { env: childEnv });
  }
  return { attempted: true, reloaded };
}

/** 只保留字符串值 env（spawn 类型安全） */
function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  return out;
}
