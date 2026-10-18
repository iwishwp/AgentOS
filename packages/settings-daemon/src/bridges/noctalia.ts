/**
 * bridges/noctalia.ts —— 状态栏桥：把选定变体色板写成**双键格式** colors.json。
 * 照搬 scripts/theme-noctalia.sh：蛇形全量键（我们的消费方在读）+ m 驼峰 16 键
 * （Noctalia v4.7.1 的 Color.qml JsonAdapter 只认这套）。Noctalia 暗/亮切换会
 * 覆写该文件（浅色默认顶掉我们的色板）——那正是 daemon watcher 的事件源，
 * 重落本桥即恢复。输出与 python json.dump(indent=2, ensure_ascii=False) 字节一致（无尾换行）。
 */
import { dualKeyMerge, M_CAMEL_MAP } from "../palette.js";
import { writeIfChanged } from "../fsutil.js";
import type { BridgeCtx, BridgeResult } from "./types.js";

export async function applyNoctalia(ctx: BridgeCtx, opts: { colorsJson: string }): Promise<BridgeResult> {
  const merged = dualKeyMerge(ctx.palette);
  const text = JSON.stringify(merged, null, 2);
  const changed = await writeIfChanged(opts.colorsJson, text);
  if (changed) ctx.onWrite?.(opts.colorsJson, text);
  return {
    name: "noctalia",
    ok: true,
    changed,
    detail: `蛇形 ${Object.keys(ctx.palette).length} 键 + m 驼峰 ${Object.keys(M_CAMEL_MAP).length} 键${changed ? " 已写" : "（内容一致，跳过）"}`,
  };
}
