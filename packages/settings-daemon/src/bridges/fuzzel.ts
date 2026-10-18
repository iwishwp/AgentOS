/**
 * bridges/fuzzel.ts —— 启动器桥：从选定变体色板生成 fuzzel.ini。
 * 照搬 scripts/theme-fuzzel.sh：fuzzel 只认 8 位 #RRGGBBAA（6 位被拒收），
 * 圆角/描边三项在独立 [border] 小节（fuzzel 1.14 语义），底色 ~94% 不透明。
 */
import { pick, toRgba8 } from "../palette.js";
import { writeIfChanged } from "../fsutil.js";
import type { BridgeCtx, BridgeResult } from "./types.js";

export function fuzzelIniText(palette: Parameters<typeof pick>[0]): string {
  const c = (key: string, fb: string) => pick(palette, key, fb);
  const BG = c("surface_container", "#37362f"); // 面板底
  const BG_SEL = c("surface_container_highest", "#3d3b34"); // 选中行底
  const TXT = c("on_surface", "#f3f3f2"); // 主文字
  const ACCENT = c("primary", "#dad8ce"); // 匹配高亮（暖米白）
  const TXT_DIM = c("on_surface_variant", "#b5b4b0"); // 输入提示符
  const BORDER = c("outline_variant", "#6c6a61"); // 描边
  return `# 由 agentos-settings（settings-daemon）生成——莫兰迪系统主题（源：规范色板）
[main]
font=Noto Sans CJK SC:size=11
# 形态：顶部居中悬浮卡片（状态栏 37px + 16px 间距）
anchor=top
y-margin=53
x-margin=0
lines=8
width=52
horizontal-pad=18
vertical-pad=16
inner-pad=10

# 圆角/描边对齐系统卡片档位（mako：radius 12 / border 2）
# 注：fuzzel 1.14 里这三项在独立 [border] 小节，不是 [main] 的键
[border]
width=2
radius=12
selection-radius=8

[colors]
background=${toRgba8(BG, "ee")}
text=${toRgba8(TXT)}
match=${toRgba8(ACCENT)}
selection=${toRgba8(BG_SEL)}
selection-text=${toRgba8(TXT)}
selection-match=${toRgba8(ACCENT)}
border=${toRgba8(BORDER)}
prompt=${toRgba8(TXT_DIM)}
`;
}

export async function applyFuzzel(ctx: BridgeCtx, opts: { config: string }): Promise<BridgeResult> {
  const text = fuzzelIniText(ctx.palette);
  const changed = await writeIfChanged(opts.config, text);
  if (changed) ctx.onWrite?.(opts.config, text);
  return {
    name: "fuzzel",
    ok: true,
    changed,
    detail: `${changed ? "已写" : "（内容一致，跳过）"} ${opts.config}（下次唤起生效）`,
  };
}
