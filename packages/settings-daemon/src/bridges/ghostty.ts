/**
 * bridges/ghostty.ts —— 终端桥：16 色莫兰迪 + 背景/前景/光标/选区，幂等标记块。
 * 照搬 scripts/theme-ghostty.sh：变体极性必须翻转——浅色档 ANSI 前景全部向深字色
 * （on_surface）调和（container 系原生是浅背景色，直接用会看不清）；浅色档背景
 * 压一档（surface_container）。旧 Catppuccin theme= 行注释保留可回切。
 * 已开窗口热重载由 ghostty-reload.ts 负责（本桥只写文件）。
 */
import { pick, blend, luma } from "../palette.js";
import { writeIfChanged, readTextIfExists } from "../fsutil.js";
import type { BridgeCtx, BridgeResult } from "./types.js";

const MARK_BEGIN = "# ===== BEGIN agentos-morandi（agentos-settings 生成，勿手改） =====";
const MARK_END = "# ===== END agentos-morandi =====";
/** 宽容匹配：同时清掉旧 shell 脚本写的标记块（迁移期双块防重） */
const OLD_BLOCK = /^# ===== BEGIN agentos-morandi[\s\S]*?# ===== END agentos-morandi =====\n?/gm;

export function ghosttyBlock(palette: Parameters<typeof pick>[0]): string {
  const c = (key: string, fb: string) => pick(palette, key, fb);
  const SURFACE = c("surface", "#21201c");
  const ON = c("on_surface", "#f3f3f2");
  const HIGH = c("surface_container_highest", "#3d3b34");
  const ERR = c("error", "#fd4663");
  const SAGE = c("tertiary_container", "#7f8c69");
  const OLIVE = c("secondary_container", "#898d68");
  const WARM = c("primary_container", "#8d8768");
  const PRIM = c("primary", "#dad8ce");
  const TER = c("tertiary", "#d5d8d0");
  const SEC = c("secondary", "#d8d9cf");

  const LIGHT = luma(SURFACE) > 0.5;
  let BG: string, FG: string, SELBG: string, CURSOR: string;
  let ansi: Array<[string, string]>;
  if (LIGHT) {
    // 浅色档：背景压一档；ANSI 前景全部向深色（on_surface）调和
    BG = c("surface_container", "#f0efe8");
    FG = ON;
    SELBG = c("surface_container_highest", "#e5e4da");
    CURSOR = c("on_surface", ON);
    const dark = (base: string, r = 0.45) => blend(base, ON, r);
    const MAGENTA = blend(ERR, TER, 0.45);
    ansi = [
      ["0", BG], ["8", blend(BG, ON, 0.22)],
      ["1", dark(ERR)], ["9", dark(ERR, 0.60)],
      ["2", dark(SAGE)], ["10", dark(SAGE, 0.60)],
      ["3", dark(OLIVE)], ["11", dark(OLIVE, 0.60)],
      ["4", dark(WARM)], ["12", dark(WARM, 0.60)],
      ["5", dark(MAGENTA)], ["13", dark(MAGENTA, 0.60)],
      ["6", dark(TER)], ["14", dark(TER, 0.60)],
      ["7", blend(ON, SURFACE, 0.30)], ["15", ON],
    ];
  } else {
    BG = SURFACE; FG = ON; SELBG = HIGH; CURSOR = PRIM;
    const MAGENTA = blend(ERR, TER, 0.45);
    ansi = [
      ["0", SURFACE], ["8", HIGH],
      ["1", ERR], ["9", blend(ERR, ON, 0.30)],
      ["2", SAGE], ["10", blend(SAGE, ON, 0.30)],
      ["3", OLIVE], ["11", blend(OLIVE, ON, 0.30)],
      ["4", WARM], ["12", blend(WARM, ON, 0.30)],
      ["5", MAGENTA], ["13", blend(MAGENTA, ON, 0.30)],
      ["6", TER], ["14", blend(TER, ON, 0.30)],
      ["7", SEC], ["15", ON],
    ];
  }

  const lines = [
    MARK_BEGIN,
    `background = ${BG}`,
    `foreground = ${FG}`,
    `cursor-color = ${CURSOR}`,
    `selection-background = ${SELBG}`,
    `selection-foreground = ${FG}`,
    ...ansi.map(([n, col]) => `palette = ${n}=${col}`),
    MARK_END,
  ];
  return lines.join("\n") + "\n";
}

export async function applyGhostty(ctx: BridgeCtx, opts: { config: string }): Promise<BridgeResult> {
  const block = ghosttyBlock(ctx.palette);
  let text = await readTextIfExists(opts.config);
  if (text === null) text = "";
  // 幂等：去掉旧标记块（含旧 shell 脚本块）；注释掉内置主题行
  text = text.replace(OLD_BLOCK, "");
  text = text.replace(/^(theme\s*=\s*.*)$/gm, "# [agentos-morandi 已接管] $1");
  text = text.replace(/\n+$/, "") + "\n\n" + block;
  const changed = await writeIfChanged(opts.config, text);
  if (changed) ctx.onWrite?.(opts.config, text);
  return {
    name: "ghostty",
    ok: true,
    changed,
    detail: `${changed ? "已写" : "（内容一致，跳过）"} ${opts.config}（16 色莫兰迪 + 背景/前景/光标/选区；新开窗口生效，已开窗口由热重载处理）`,
  };
}
