#!/usr/bin/env bash
# =============================================================================
# scripts/theme-gtk.sh —— GTK 桥：全部 GTK3/4 应用吃上系统莫兰迪色板
#
# 覆盖面最大的桥（gnome-calculator/文件管理器/编辑器等所有 GTK 应用）。方式：
#   ~/.config/gtk-4.0/gtk.css  @define-color 覆盖 libadwaita 命名色（accent/window/
#     view/headerbar/popover/card/dialog/sidebar/borders/error/success/warning…）
#   ~/.config/gtk-3.0/gtk.css  同机制但用 GTK3 旧色名（theme_bg_color/
#     theme_selected_bg_color…，Adwaita 系主题消费）
# 与 settings.ini **共存不顶掉**：os/configs/theming/gtk-{3,4}0/settings.ini 的
# 光标/图标/字体/暗色位只做**单行翻转**（gtk-application-prefer-dark-theme 按变体
# 置 true/false——浅色板配 libadwaita 暗色样式会出斑，必须联动），其余行原样保留。
#
# 变体自动识别：从 surface 明度判断暗/浅（>0.5 浅），单独跑本桥也能站对边；
# theme-apply-all.sh 统一调度时经 AGENTOS_COLORS_JSON 传入对应变体色板。
# 幂等：css 用 BEGIN/END 标记块（同 theme-ghostty.sh 模式，先删旧块再写新块）。
# 生效时机：GTK 应用启动时读 css/settings.ini，已开窗口不跟随，新开即生效。
# =============================================================================
set -euo pipefail

COLORS="${AGENTOS_COLORS_JSON:-$HOME/.config/noctalia/lanrhyme-palette.json}"
OUT4="${GTK4_CSS:-$HOME/.config/gtk-4.0/gtk.css}"
OUT3="${GTK3_CSS:-$HOME/.config/gtk-3.0/gtk.css}"
INI4="${GTK4_SETTINGS:-$HOME/.config/gtk-4.0/settings.ini}"
INI3="${GTK3_SETTINGS:-$HOME/.config/gtk-3.0/settings.ini}"

python3 - "$COLORS" "$OUT4" "$OUT3" "$INI4" "$INI3" <<'PY'
import json, re, sys, pathlib

src, out4, out3, ini4, ini3 = sys.argv[1:6]
try:
    d = json.load(open(src))
except Exception:
    d = {}  # 色板缺失 → 全部走内置兜底（暗色 lanrhyme 同值），与 mako/fuzzel 桥一致

def c(key, fallback):
    v = d.get(key)
    return v if isinstance(v, str) and v.startswith("#") else fallback

# 变体识别：surface 明度（HLS 的 L）> 0.5 → 浅色板
r, g, b = (int(c("surface", "#21201c")[i:i+2], 16) / 255 for i in (1, 3, 5))
import colorsys
is_light = colorsys.rgb_to_hls(r, g, b)[1] > 0.5

MARK_BEGIN = "/* ===== BEGIN agentos-morandi（scripts/theme-gtk.sh 生成，勿手改） ===== */"
MARK_END = "/* ===== END agentos-morandi ===== */"

def merge_block(path, lines):
    p = pathlib.Path(path)
    text = p.read_text() if p.exists() else ""
    text = re.sub(re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END) + r"\n?", "", text, flags=re.S)
    text = text.rstrip("\n")
    block = "\n".join([MARK_BEGIN] + lines + [MARK_END]) + "\n"
    text = (text + "\n\n" if text else "") + block
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

def dc(name, key, fb):
    return f"@define-color {name} {c(key, fb)};"

# ---- GTK4 / libadwaita 命名色 → Material 键（fallback=lanrhyme 暗色实测值）----
gtk4 = [
    # 强调（开关/选中/链接/焦点环）
    dc("accent_color", "primary", "#dad8ce"),
    dc("accent_bg_color", "primary", "#dad8ce"),
    dc("accent_fg_color", "on_primary", "#22211c"),
    # 窗体/视图（Entry、TextView 列表底）
    dc("window_bg_color", "surface", "#21201c"),
    dc("window_fg_color", "on_surface", "#f3f3f2"),
    dc("view_bg_color", "surface_container_low", "#1c1b17"),
    dc("view_fg_color", "on_surface", "#f3f3f2"),
    # 标题栏/弹层/卡片/对话框/侧栏
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
    # 边框/投影（shade_color 带透明度，取 shadow 色）
    dc("borders", "outline_variant", "#6c6a61"),
    dc("unfocused_borders", "outline_variant", "#6c6a61"),
    "@define-color shade_color rgba(%s,0.36);" % ",".join(
        str(int(c("shadow", "#21201c")[i:i + 2], 16)) for i in (1, 3, 5)),
    # 语义色（莫兰迪化：success=鼠尾草、warning=暖褐、error/destructive=莫兰迪红）。
    # *_color 是图标/文字强调——必须取随变体自适应明度的主强调键（tertiary/primary，
    # 暗板浅调、浅板深调，两档都可见）；*_bg_color 才用 container tint。
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
]

# ---- GTK3 旧色名（Adwaita 系主题的 named colors）----
gtk3 = [
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
]

merge_block(out4, gtk4)
merge_block(out3, gtk3)

# ---- settings.ini 单行翻转（其余内容不动；文件缺失则给最小骨架）----
def flip_prefer_dark(path, want):
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    val = "true" if want else "false"
    if p.exists():
        text = p.read_text()
        if re.search(r"^\s*gtk-application-prefer-dark-theme\s*=", text, flags=re.M):
            text = re.sub(r"^(\s*gtk-application-prefer-dark-theme\s*=\s*).*$",
                          rf"\g<1>{val}", text, flags=re.M)
        else:
            text += f"\ngtk-application-prefer-dark-theme={val}\n"
        p.write_text(text)
    else:
        p.write_text(f"[Settings]\ngtk-application-prefer-dark-theme={val}\n")

flip_prefer_dark(ini4, not is_light)
flip_prefer_dark(ini3, not is_light)

variant = "浅" if is_light else "暗"
print(f"已写 {out4}（libadwaita 命名色 {len(gtk4)} 项）")
print(f"已写 {out3}（GTK3 旧色名 {len(gtk3)} 项）")
print(f"变体={variant} → settings.ini gtk-application-prefer-dark-theme={'false' if is_light else 'true'}（单行翻转，其余保留）")
PY
echo "（已开的 GTK 窗口不跟随，新开窗口即生效）"
