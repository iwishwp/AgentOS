/**
 * bridges/gtk.ts —— GTK 桥：双载体。照搬 scripts/theme-gtk.sh：
 *   1) gtk-4.0/gtk.css + gtk-3.0/gtk.css 的 @define-color 标记块
 *      （libadwaita 命名色 35 项 + GTK3 旧色名 22 项）；
 *   2) settings.ini 的 gtk-application-prefer-dark-theme **单行翻转**（其余行原样保留）。
 * 变体按 surface 的 HLS 明度识别（>0.5 浅），单独跑本桥也能站对边。
 * daemon 追加一项与单行翻转同方向的副作用：gsettings color-scheme 尽力翻转
 * （无 dconf/无会话守护时静默 no-op，不影响旧链像素结果）。
 */
import { pick, hlsLightness } from "../palette.js";
import { writeIfChanged, readTextIfExists } from "../fsutil.js";
import type { BridgeCtx, BridgeResult } from "./types.js";

const MARK_BEGIN = "/* ===== BEGIN agentos-morandi（agentos-settings 生成，勿手改） ===== */";
const MARK_END = "/* ===== END agentos-morandi ===== */";
/** 宽容匹配：同时清掉旧 shell 脚本写的标记块（迁移期双块防重） */
function stripOldBlock(text: string): string {
  return text.replace(
    /\/\* ===== BEGIN agentos-morandi[\s\S]*?===== END agentos-morandi ===== \*\/\n?/g,
    "",
  );
}

async function mergeBlock(path: string, lines: string[], onWrite?: (p: string, c: string) => void): Promise<boolean> {
  let text = await readTextIfExists(path);
  if (text === null) text = "";
  text = stripOldBlock(text).replace(/\n+$/, "");
  const block = [MARK_BEGIN, ...lines, MARK_END].join("\n") + "\n";
  text = (text ? text + "\n\n" : "") + block;
  const changed = await writeIfChanged(path, text);
  if (changed) onWrite?.(path, text);
  return changed;
}

function rgbaTuple(hex: string): string {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
}

export function gtk4Lines(palette: Parameters<typeof pick>[0]): string[] {
  const dc = (name: string, key: string, fb: string) => `@define-color ${name} ${pick(palette, key, fb)};`;
  const c = (key: string, fb: string) => pick(palette, key, fb);
  return [
    // 强调（开关/选中/链接/焦点环）
    dc("accent_color", "primary", "#dad8ce"),
    dc("accent_bg_color", "primary", "#dad8ce"),
    dc("accent_fg_color", "on_primary", "#22211c"),
    // 窗体/视图（Entry、TextView 列表底）
    dc("window_bg_color", "surface", "#21201c"),
    dc("window_fg_color", "on_surface", "#f3f3f2"),
    dc("view_bg_color", "surface_container_low", "#1c1b17"),
    dc("view_fg_color", "on_surface", "#f3f3f2"),
    // 标题栏/弹层/卡片/对话框/侧栏
    dc("headerbar_bg_color", "surface_container", "#37362f"),
    dc("headerbar_fg_color", "on_surface", "#f3f3f2"),
    dc("headerbar_backdrop_color", "surface_container_low", "#1c1b17"),
    dc("popover_bg_color", "surface_container", "#37362f"),
    dc("popover_fg_color", "on_surface", "#f3f3f2"),
    dc("card_bg_color", "surface_container", "#37362f"),
    dc("card_fg_color", "on_surface", "#f3f3f2"),
    dc("dialog_bg_color", "surface_container_low", "#1c1b17"),
    dc("dialog_fg_color", "on_surface", "#f3f3f2"),
    dc("sidebar_bg_color", "surface_container_low", "#1c1b17"),
    dc("sidebar_fg_color", "on_surface", "#f3f3f2"),
    dc("secondary_sidebar_bg_color", "surface_container_low", "#1c1b17"),
    dc("secondary_sidebar_fg_color", "on_surface", "#f3f3f2"),
    // 边框/投影（shade_color 带透明度，取 shadow 色）
    dc("borders", "outline_variant", "#6c6a61"),
    dc("unfocused_borders", "outline_variant", "#6c6a61"),
    `@define-color shade_color rgba(${rgbaTuple(c("shadow", "#21201c"))},0.36);`,
    // 语义色（莫兰迪化：success=鼠尾草、warning=暖褐、error/destructive=莫兰迪红）。
    // *_color 是图标/文字强调——必须取随变体自适应明度的主强调键（tertiary/primary，
    // 暗板浅调、浅板深调，两档都可见）；*_bg_color 才用 container tint。
    dc("success_color", "tertiary", "#d5d8d0"),
    dc("success_bg_color", "tertiary_container", "#7f8c69"),
    dc("success_fg_color", "on_tertiary_container", "#000000"),
    dc("warning_color", "primary", "#dad8ce"),
    dc("warning_bg_color", "primary_container", "#8d8768"),
    dc("warning_fg_color", "on_primary_container", "#000000"),
    dc("error_color", "error", "#fd4663"),
    dc("error_bg_color", "error", "#fd4663"),
    dc("error_fg_color", "on_error", "#22211c"),
    dc("destructive_color", "error", "#fd4663"),
    dc("destructive_bg_color", "error", "#fd4663"),
    dc("destructive_fg_color", "on_error", "#22211c"),
  ];
}

export function gtk3Lines(palette: Parameters<typeof pick>[0]): string[] {
  const dc = (name: string, key: string, fb: string) => `@define-color ${name} ${pick(palette, key, fb)};`;
  return [
    dc("theme_bg_color", "surface", "#21201c"),
    dc("theme_fg_color", "on_surface", "#f3f3f2"),
    dc("theme_base_color", "surface_container_low", "#1c1b17"),
    dc("theme_text_color", "on_surface", "#f3f3f2"),
    dc("theme_selected_bg_color", "primary", "#dad8ce"),
    dc("theme_selected_fg_color", "on_primary", "#22211c"),
    dc("theme_unfocused_bg_color", "surface", "#21201c"),
    dc("theme_unfocused_base_color", "surface_container_low", "#1c1b17"),
    dc("theme_unfocused_fg_color", "on_surface_variant", "#b5b4b0"),
    dc("theme_unfocused_text_color", "on_surface", "#f3f3f2"),
    dc("theme_unfocused_selected_bg_color", "outline_variant", "#6c6a61"),
    dc("theme_unfocused_selected_fg_color", "on_primary", "#22211c"),
    dc("insensitive_bg_color", "surface_container_low", "#1c1b17"),
    dc("insensitive_fg_color", "outline_variant", "#6c6a61"),
    dc("insensitive_base_color", "surface_container_low", "#1c1b17"),
    dc("borders", "outline_variant", "#6c6a61"),
    dc("unfocused_borders", "outline_variant", "#6c6a61"),
    dc("warning_color", "primary", "#dad8ce"),
    dc("error_color", "error", "#fd4663"),
    dc("success_color", "tertiary", "#d5d8d0"),
    dc("wm_title", "on_surface", "#f3f3f2"),
    dc("wm_title_unfocused", "on_surface_variant", "#b5b4b0"),
  ];
}

/** settings.ini 单行翻转（缺文件给最小骨架；其余内容不动） */
export async function flipPreferDark(path: string, want: boolean): Promise<boolean> {
  const val = want ? "true" : "false";
  let text = await readTextIfExists(path);
  if (text === null) {
    text = `[Settings]\ngtk-application-prefer-dark-theme=${val}\n`;
  } else if (/^\s*gtk-application-prefer-dark-theme\s*=/m.test(text)) {
    text = text.replace(/^(\s*gtk-application-prefer-dark-theme\s*=\s*).*$/m, `$1${val}`);
  } else {
    text += `\ngtk-application-prefer-dark-theme=${val}\n`;
  }
  return writeIfChanged(path, text);
}

export interface GtkOptions {
  gtk4Css: string;
  gtk3Css: string;
  gtk4Ini: string;
  gtk3Ini: string;
}

export async function applyGtk(ctx: BridgeCtx, opts: GtkOptions): Promise<BridgeResult> {
  const isLight = hlsLightness(pick(ctx.palette, "surface", "#21201c")) > 0.5;
  const gtk4 = gtk4Lines(ctx.palette);
  const gtk3 = gtk3Lines(ctx.palette);
  const c4 = await mergeBlock(opts.gtk4Css, gtk4, ctx.onWrite);
  const c3 = await mergeBlock(opts.gtk3Css, gtk3, ctx.onWrite);
  const i4 = await flipPreferDark(opts.gtk4Ini, !isLight);
  const i3 = await flipPreferDark(opts.gtk3Ini, !isLight);
  // gsettings 尽力翻转：与单行翻转同方向；无 dconf/键缺失时静默 no-op
  await ctx.runner.run("gsettings", [
    "set", "org.gnome.desktop.interface", "color-scheme", isLight ? "default" : "prefer-dark",
  ]);
  const variant = isLight ? "浅" : "暗";
  return {
    name: "gtk",
    ok: true,
    changed: c4 || c3 || i4 || i3,
    detail: `变体=${variant}；libadwaita ${gtk4.length} 项 + GTK3 ${gtk3.length} 项；settings.ini prefer-dark=${!isLight ? "true" : "false"}（单行翻转）`,
  };
}
