/**
 * settings.ts —— /settings 页的后端数据面。
 *
 * 纪律：canvas 不做编排——
 *   - 外观操作经 settings-daemon 的 CLI 子进程（agentos-settings apply），不在 canvas 里重写桥逻辑；
 *   - 状态只读 daemon 的单一状态快照 ~/.config/agentos/settings-state.json（写者是 daemon）；
 *   - 快照列表复用 scripts/snapshot.sh list --json；
 *   - 状态迁移导出复用 scripts/agentos-state-export.sh。
 * 这里只做"读文件 + 起子进程 + 解析输出"，路径全部支持 env/opts 覆盖以便测试。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandRunner } from "@agentos/proc";

/** settings-daemon 的状态快照（packages/settings-daemon/src/state.ts 的 SettingsState） */
export interface SettingsState {
  darkMode: boolean;
  paletteVariant: "dark" | "light";
  palettePath: string;
  lastAppliedAt: string;
  appliedBy: string;
  /** 桥名 → ok | unchanged | fail:<原因> */
  bridges: Record<string, string>;
}

/** Noctalia 主配置（colorSchemes.darkMode 是变体真相——daemon watcher 只认真相） */
export function noctaliaSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? os.homedir();
  return env["AGENTOS_NOCTALIA_SETTINGS"] ?? path.join(home, ".config", "noctalia", "settings.json");
}

/**
 * 翻真相：改 noctalia settings.json 的 colorSchemes.darkMode（保持其余键不动）。
 * 只做这一个键的外科修改——这是 Noctalia 面板自己的切换路径，daemon watcher 盯着它。
 * 文件缺失/坏 JSON：返回 false（调用方降级为强制变体 apply，行为同旧路）。
 */
export function flipDarkMode(file: string, dark: boolean): boolean {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  const cs = (parsed["colorSchemes"] ?? {}) as Record<string, unknown>;
  cs["darkMode"] = dark;
  parsed["colorSchemes"] = cs;
  try {
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 仓库根（dist: packages/canvas/dist → ../../..；src/test: packages/canvas/src → ../../..） */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export interface SettingsPaths {
  /** daemon 状态快照 */
  stateFile: string;
  /** daemon 的 unix socket（存活探测） */
  socketPath: string;
  /** settings-daemon CLI（apply 子进程） */
  settingsCli: string | null;
  /** scripts/snapshot.sh */
  snapshotScript: string | null;
  /** scripts/agentos-state-export.sh */
  exportScript: string | null;
  /** 导出产物落点（迁移小节的说明文案用） */
  exportsDir: string;
}

/** 候选里第一个存在的文件；都不在则 null（API 如实报"找不到"，不瞎猜） */
function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

export function settingsPaths(env: NodeJS.ProcessEnv = process.env): SettingsPaths {
  const home = env.HOME ?? os.homedir();
  const root = repoRoot();
  const runtimeDir = env.XDG_RUNTIME_DIR ?? path.join("/run/user", String(process.getuid?.() ?? 1000));
  return {
    stateFile:
      env["AGENTOS_STATE_FILE"] ?? path.join(home, ".config", "agentos", "settings-state.json"),
    socketPath: env["AGENTOS_SETTINGS_SOCKET"] ?? path.join(runtimeDir, "agentos-settings.sock"),
    settingsCli: firstExisting([
      env["AGENTOS_SETTINGS_CLI"] ?? "",
      path.join(home, "AgentOS", "packages", "settings-daemon", "dist", "cli.js"),
      path.join(root, "packages", "settings-daemon", "dist", "cli.js"),
    ]),
    snapshotScript: firstExisting([
      env["AGENTOS_SNAPSHOT_SCRIPT"] ?? "",
      path.join(home, "AgentOS", "scripts", "snapshot.sh"),
      path.join(root, "scripts", "snapshot.sh"),
    ]),
    exportScript: firstExisting([
      env["AGENTOS_EXPORT_SCRIPT"] ?? "",
      path.join(home, "AgentOS", "scripts", "agentos-state-export.sh"),
      path.join(root, "scripts", "agentos-state-export.sh"),
    ]),
    exportsDir: path.join(home, "Agent"),
  };
}

/** 读 daemon 状态快照（文件缺失/坏 JSON → null，由页面呈现"尚未 apply"） */
export function readSettingsState(stateFile: string): SettingsState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8")) as SettingsState;
  } catch {
    return null;
  }
}

export interface DaemonProbe {
  alive: boolean;
  paletteVariant?: "dark" | "light";
  darkMode?: boolean;
}

/** daemon 存活探测：socket 发一行 Get（与 settings-daemon socketCall 同协议），超时/拒绝即 down */
export function probeSettingsDaemon(socketPath: string, timeoutMs = 500): Promise<DaemonProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: DaemonProbe) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(r);
    };
    const sock = net.connect(socketPath);
    let buf = "";
    sock.on("connect", () => sock.write(JSON.stringify({ method: "Get" }) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      if (buf.includes("\n")) {
        try {
          const reply = JSON.parse(buf.trim()) as { ok?: boolean; paletteVariant?: "dark" | "light"; darkMode?: boolean };
          done(reply.ok ? { alive: true, paletteVariant: reply.paletteVariant, darkMode: reply.darkMode } : { alive: false });
        } catch {
          done({ alive: false });
        }
      }
    });
    sock.on("error", () => done({ alive: false }));
    setTimeout(() => done({ alive: false }), timeoutMs).unref();
  });
}

/** systemd user 单元状态（is-active 输出原样：active/inactive/failed/…） */
export async function readUnitStates(
  runner: CommandRunner,
  units: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const unit of units) {
    const r = await runner.run("systemctl", ["--user", "is-active", unit]);
    // is-active 对 inactive/failed 也是非零退出码，状态看 stdout
    const s = r.stdout.trim();
    out[unit] = s || (r.code === null ? "不可执行" : `exit ${r.code}`);
  }
  return out;
}

export const AGENTOS_UNITS = ["agentos-canvas", "agentos-settings", "agentos-orb", "agentos-confirm"] as const;

export interface SnapshotRow {
  number: number;
  date: string;
  description: string;
}

export interface SnapshotList {
  snapshots: SnapshotRow[];
  error?: string;
}

/** 快照列表：复用 scripts/snapshot.sh list --json（sudo snapper 由脚本内处理） */
export async function listSnapshots(runner: CommandRunner, script: string | null): Promise<SnapshotList> {
  if (!script) return { snapshots: [], error: "找不到 scripts/snapshot.sh" };
  const r = await runner.run(script, ["list", "--json"]);
  if (r.code !== 0) {
    return { snapshots: [], error: (r.stderr.trim() || `exit ${r.code}`).slice(0, 300) };
  }
  try {
    const parsed = JSON.parse(r.stdout) as SnapshotRow[];
    if (!Array.isArray(parsed)) throw new Error("不是数组");
    return { snapshots: parsed };
  } catch {
    return { snapshots: [], error: "snapshot.sh 输出无法解析" };
  }
}

export type AppearanceVariant = "dark" | "light";

export interface ApplyResult {
  ok: boolean;
  detail: string;
  /** 真相是否翻转成功（false = 降级为强制变体，daemon watcher 可能按旧真相回滚） */
  truthFlipped: boolean;
  state: SettingsState | null;
}

/**
 * 外观切换。语义（实测教训 2026-10-19：只强制变体会被 daemon watcher 立即回滚——
 * 真相是 noctalia settings.json 的 colorSchemes.darkMode）：
 *   ① 翻真相文件 darkMode → ② 起 settings-daemon CLI apply（auto：读真相、跑五桥）。
 * canvas 仍不做编排，只是"改真相 + 请 daemon 收敛"。真相文件不可写时降级为
 * apply --dark/--light（行为同 D-Bus Apply(s)，可能与 watcher 短暂打架）。
 */
export async function applyAppearance(
  runner: CommandRunner,
  settingsCli: string | null,
  stateFile: string,
  variant: AppearanceVariant,
  noctaliaSettings?: string,
): Promise<ApplyResult> {
  if (!settingsCli) {
    return {
      ok: false,
      detail: "找不到 agentos-settings CLI（packages/settings-daemon/dist/cli.js）",
      truthFlipped: false,
      state: readSettingsState(stateFile),
    };
  }
  const truthFile = noctaliaSettings ?? noctaliaSettingsPath();
  const truthFlipped = flipDarkMode(truthFile, variant === "dark");
  const r = await runner.run(process.execPath, [settingsCli, "apply", ...(truthFlipped ? [] : [`--${variant}`])]);
  const state = readSettingsState(stateFile);
  if (r.code !== 0) {
    return { ok: false, detail: (r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 500), truthFlipped, state };
  }
  return { ok: true, detail: r.stdout.trim(), truthFlipped, state };
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  detail: string;
}

/** 迁移导出：复用 scripts/agentos-state-export.sh（产物落 ~/Agent，脚本末行 EXPORTED_PATH= 机器可读） */
export async function runStateExport(
  runner: CommandRunner,
  exportScript: string | null,
  withSecrets: boolean,
): Promise<ExportResult> {
  if (!exportScript) {
    return { ok: false, detail: "找不到 scripts/agentos-state-export.sh" };
  }
  const args = withSecrets ? ["--with-secrets"] : [];
  const r = await runner.run(exportScript, args);
  if (r.code !== 0) {
    return { ok: false, detail: (r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 500) };
  }
  const m = /EXPORTED_PATH=(\S+)/.exec(`${r.stdout}\n${r.stderr}`);
  return { ok: true, path: m?.[1], detail: r.stdout.trim() };
}
