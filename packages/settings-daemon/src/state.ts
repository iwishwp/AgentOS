/**
 * state.ts —— 状态模块：~/.config/agentos/settings-state.json 是 daemon 的单一状态快照，
 * 但 v1 的**真相**仍来自现有文件——noctalia settings.json 的 colorSchemes.darkMode +
 * 两个色板文件。daemon 读取映射到这里，不另立竞争真相（手动改 state 文件不会反过来改主题）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Variant } from "./palette.js";

export interface SettingsState {
  /** 真相：noctalia settings.json colorSchemes.darkMode（读不到按暗色兜底） */
  darkMode: boolean;
  /** 本次实际应用的变体（强制 --dark/--light 时可能与 darkMode 短暂不一致） */
  paletteVariant: Variant;
  /** 本次实际使用的色板文件 */
  palettePath: string;
  lastAppliedAt: string;
  /** daemon | cli */
  appliedBy: string;
  /** 桥名 → ok | unchanged | fail:<原因> */
  bridges: Record<string, string>;
}

/** 读 noctalia settings.json 的 darkMode（theme-apply-all.sh 同语义：读不到按暗色） */
export function parseDarkMode(text: string | null): boolean {
  if (text === null) return true;
  try {
    const d = JSON.parse(text) as { colorSchemes?: { darkMode?: boolean } };
    return d.colorSchemes?.darkMode ?? true;
  } catch {
    return true;
  }
}

export async function loadState(path: string): Promise<SettingsState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SettingsState;
  } catch {
    return null;
  }
}

export async function saveState(path: string, state: SettingsState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}
