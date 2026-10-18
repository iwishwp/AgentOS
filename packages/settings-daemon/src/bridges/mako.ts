/**
 * bridges/mako.ts —— 通知桥：从选定变体色板生成 mako 配置并 makoctl reload。
 * 照搬 scripts/theme-mako.sh：三档紧急度（low 淡 / normal 标准 / critical 醒目
 * 描边+不过期）。色板缺键用内置莫兰迪同值兜底。
 */
import { pick } from "../palette.js";
import { writeIfChanged } from "../fsutil.js";
import type { BridgeCtx, BridgeResult } from "./types.js";

export function makoConfigText(palette: Parameters<typeof pick>[0]): string {
  const c = (key: string, fb: string) => pick(palette, key, fb);
  const BG = c("surface_container", "#37362f"); // 面板底
  const BG_HI = c("surface_container_highest", "#3d3b34");
  const TXT = c("on_surface", "#f3f3f2"); // 主文字
  const TXT_DIM = c("on_surface_variant", "#b5b4b0"); // 次文字
  const ACCENT = c("primary", "#dad8ce"); // 强调（描边/标题）
  const BORDER = c("outline_variant", "#6c6a61");
  return `# 由 agentos-settings（settings-daemon）生成——莫兰迪系统主题（源：规范色板）
anchor=top-right
width=340
margin=10
padding=12
border-size=2
border-radius=12
default-timeout=8000
ignore-timeout=false
font=Noto Sans CJK SC 11
text-alignment=left
icon-location=left
max-icon-size=48

background-color=${BG}
text-color=${TXT}
border-color=${BORDER}

# 低紧急度（常规完成通知）：更淡，不打扰
[urgency=low]
background-color=${BG}
text-color=${TXT_DIM}
border-color=${BORDER}
border-size=1

# 高紧急度（确认横幅/失败）：醒目描边 + 不过期（M4 确认横幅靠它常驻）
[urgency=critical]
background-color=${BG_HI}
text-color=${TXT}
border-color=${ACCENT}
border-size=3
default-timeout=0
`;
}

export async function applyMako(ctx: BridgeCtx, opts: { config: string }): Promise<BridgeResult> {
  const text = makoConfigText(ctx.palette);
  const changed = await writeIfChanged(opts.config, text);
  if (changed) ctx.onWrite?.(opts.config, text);
  // makoctl 不可用不算失败（重启 mako 生效）——与旧脚本一致
  const r = await ctx.runner.run("makoctl", ["reload"]);
  return {
    name: "mako",
    ok: true,
    changed,
    detail: `${changed ? "已写" : "（内容一致，跳过）"} ${opts.config}；makoctl reload ${r.code === 0 ? "成功" : "不可用（重启 mako 生效）"}`,
  };
}
