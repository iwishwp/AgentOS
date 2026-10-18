/** bridges/types.ts —— 桥的公共上下文/结果类型 */
import type { CommandRunner } from "@agentos/proc";
import type { Palette, Variant } from "../palette.js";

export interface BridgeCtx {
  /** 选定变体的蛇形色板（apply-all 时代的 AGENTOS_COLORS_JSON 同源） */
  palette: Palette;
  /** 编排器按真相选择的变体；桥内颜色极性仍按色板 surface 检测（与旧脚本一致） */
  variant: Variant;
  /** 副作用注入点（makoctl/gsettings/wtype/niri；测试用 FakeRunner） */
  runner: CommandRunner;
  /** daemon 模式下登记自写哈希（环保护） */
  onWrite?: (path: string, content: string) => void;
}

export interface BridgeResult {
  name: string;
  ok: boolean;
  /** 是否真的写了文件（false = 内容一致幂等跳过） */
  changed: boolean;
  detail: string;
}
