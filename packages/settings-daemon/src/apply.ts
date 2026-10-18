/**
 * apply.ts —— 统一编排器：theme-apply-all.sh 的 TS 化。
 * 变体决定：--dark/--light 强制，否则看 noctalia settings.json 的 colorSchemes.darkMode
 * （读不到按暗色兜底）。选定后全部桥同源取色（旧链的 AGENTOS_COLORS_JSON 语义）。
 * 桥顺序同旧链：noctalia → mako → fuzzel → ghostty → gtk → ghostty 已开窗口热重载。
 * 单桥失败不中断其余桥；结束后写状态快照。
 */
import { ShellRunner, type CommandRunner } from "@agentos/proc";
import { existsSync } from "node:fs";
import type { Paths } from "./paths.js";
import type { Palette, Variant } from "./palette.js";
import { loadPalette, isLightPalette } from "./palette.js";
import type { WatchHub } from "./hub.js";
import type { BridgeResult, BridgeCtx } from "./bridges/types.js";
import { applyNoctalia } from "./bridges/noctalia.js";
import { applyMako } from "./bridges/mako.js";
import { applyFuzzel } from "./bridges/fuzzel.js";
import { applyGhostty } from "./bridges/ghostty.js";
import { applyGtk } from "./bridges/gtk.js";
import { reloadGhosttyWindows, type GhosttyReloadResult } from "./ghostty-reload.js";
import { readTextIfExists } from "./fsutil.js";
import { parseDarkMode, saveState } from "./state.js";

export type VariantArg = Variant | "auto";

export class ApplyError extends Error {}

export interface ApplyReport {
  /** 实际应用的变体 */
  variant: Variant;
  forced: boolean;
  /** 真相：noctalia settings.json 的 darkMode */
  darkMode: boolean;
  palettePath: string;
  lightFallbackToDark: boolean;
  bridges: BridgeResult[];
  ghosttyReload: GhosttyReloadResult | null;
}

export interface ApplyDeps {
  runner?: CommandRunner;
  paths: Paths;
  hub?: WatchHub;
  logger?: (line: string) => void;
}

export interface ApplyOptions {
  variant?: VariantArg;
  reason: string;
  appliedBy: "daemon" | "cli";
  reloadGhostty?: boolean;
}

export async function applyTheme(deps: ApplyDeps, opts: ApplyOptions): Promise<ApplyReport> {
  const { paths } = deps;
  const runner = deps.runner ?? new ShellRunner();
  const log = deps.logger ?? (() => {});

  // ---- 变体决定（theme-apply-all.sh 同语义）----
  const darkMode = parseDarkMode(await readTextIfExists(paths.noctaliaSettings));
  const forcedVariant = opts.variant === "dark" || opts.variant === "light" ? opts.variant : null;
  const forced = forcedVariant !== null;
  const wanted: Variant = forcedVariant ?? (darkMode ? "dark" : "light");

  let variant = wanted;
  let palettePath = variant === "light" ? paths.paletteLight : paths.paletteDark;
  let lightFallbackToDark = false;
  if (!existsSync(palettePath)) {
    if (wanted === "light" && existsSync(paths.paletteDark)) {
      lightFallbackToDark = true;
      variant = "dark";
      palettePath = paths.paletteDark;
      log(`警告: 浅色板缺失（${paths.paletteLight}），回落暗色板`);
    } else {
      throw new ApplyError(`找不到色板 ${palettePath}（部署: apply-lanrhyme-theme.sh）`);
    }
  }

  const palette: Palette = await loadPalette(palettePath);
  const ctx: BridgeCtx = {
    palette,
    variant,
    runner,
    onWrite: (p, c) => deps.hub?.recordSelfWrite(p, c),
  };

  const variantLabel = variant === "light" ? "浅" : "暗";
  log(`== 主题联动（${variantLabel}档，${opts.reason}）: 色板 ${palettePath} ==`);

  // ---- 依次跑桥：单桥失败记录不中断 ----
  const bridges: BridgeResult[] = [];
  const runBridge = async (name: string, fn: () => Promise<BridgeResult>) => {
    try {
      bridges.push(await fn());
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      bridges.push({ name, ok: false, changed: false, detail });
    }
  };

  await runBridge("noctalia", () => applyNoctalia(ctx, { colorsJson: paths.colorsJson }));
  await runBridge("mako", () => applyMako(ctx, { config: paths.makoConfig }));
  await runBridge("fuzzel", () => applyFuzzel(ctx, { config: paths.fuzzelConfig }));
  await runBridge("ghostty", () => applyGhostty(ctx, { config: paths.ghosttyConfig }));
  await runBridge("gtk", () =>
    applyGtk(ctx, {
      gtk4Css: paths.gtk4Css,
      gtk3Css: paths.gtk3Css,
      gtk4Ini: paths.gtk4Ini,
      gtk3Ini: paths.gtk3Ini,
    }),
  );

  // ---- ghostty 已开窗口热重载 ----
  let ghosttyReload: GhosttyReloadResult | null = null;
  if (opts.reloadGhostty !== false) {
    ghosttyReload = await reloadGhosttyWindows(runner, paths.runtimeDir);
    if (ghosttyReload.attempted) {
      log(`ghostty 热重载: ${ghosttyReload.reloaded} 个已开窗口`);
    }
  }

  // ---- 状态快照（daemon 的单一状态源；真相仍在 noctalia 侧文件）----
  await saveState(paths.stateFile, {
    darkMode,
    paletteVariant: variant,
    palettePath,
    lastAppliedAt: new Date().toISOString(),
    appliedBy: opts.appliedBy,
    bridges: Object.fromEntries(
      bridges.map((b) => [b.name, b.ok ? (b.changed ? "ok" : "unchanged") : `fail:${b.detail}`]),
    ),
  });

  return { variant, forced, darkMode, palettePath, lightFallbackToDark, bridges, ghosttyReload };
}

/** 状态展示辅助：色板极性（按内容，非真相） */
export function palettePolarity(palette: Palette): Variant {
  return isLightPalette(palette) ? "light" : "dark";
}
