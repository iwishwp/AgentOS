#!/usr/bin/env bash
# =============================================================================
# scripts/theme-fuzzel.sh —— 启动器 fuzzel 主题对齐系统莫兰迪
#
# 与 theme-mako.sh 同一模式：从 Noctalia 色板（colors.json，换壁纸重生成后自动
# 跟随）读色生成 ~/.config/fuzzel/fuzzel.ini。色板缺失/缺键时用内置莫兰迪同值
# 兜底（与 os/configs/noctalia/lanrhyme/colors.json 一致）。
#
# 视觉档位与系统卡片语言对齐（mako 已验收）：
#   圆角 12 / 描边 2px outline_variant / 底 surface_container（~94% 不透明）
#   选中行 surface_container_highest，匹配高亮 primary（暖米白）
# 形态：顶部锚定（anchor=top）、状态栏(37px)下方留 16px 间距，宽度克制。
# =============================================================================
set -euo pipefail

COLORS="${AGENTOS_COLORS_JSON:-$HOME/.config/noctalia/colors.json}"
OUT="${FUZZEL_CONFIG:-$HOME/.config/fuzzel/fuzzel.ini}"

get() {  # get <key> <兜底>
  python3 - "$COLORS" "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
v = d.get(sys.argv[2])
print(v if isinstance(v, str) and v.startswith("#") else sys.argv[3])
PY
}

# Material 色板键 → 启动器语义；兜底=lanrhyme 色板实测值
BG=$(get surface_container "#37362f")          # 面板底
BG_SEL=$(get surface_container_highest "#3d3b34")  # 选中行底
TXT=$(get on_surface "#f3f3f2")                # 主文字
ACCENT=$(get primary "#dad8ce")                # 匹配高亮（暖米白）
TXT_DIM=$(get on_surface_variant "#b5b4b0")    # 输入提示符
BORDER=$(get outline_variant "#6c6a61")        # 描边

# 底色 ~94% 不透明、其余全不透明：fuzzel 只认 8 位 #RRGGBBAA（6 位会被拒收）
BG_A="${BG/#\#/}ee"
TXT_8="#${TXT/#\#/}ff"; ACCENT_8="#${ACCENT/#\#/}ff"; BG_SEL_8="#${BG_SEL/#\#/}ff"
BORDER_8="#${BORDER/#\#/}ff"; TXT_DIM_8="#${TXT_DIM/#\#/}ff"

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
# 由 scripts/theme-fuzzel.sh 生成——莫兰迪系统主题（源：colors.json）
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
background=#${BG_A}
text=${TXT_8}
match=${ACCENT_8}
selection=${BG_SEL_8}
selection-text=${TXT_8}
selection-match=${ACCENT_8}
border=${BORDER_8}
prompt=${TXT_DIM_8}
EOF

echo "写入 $OUT"
echo "（fuzzel 下次启动即生效；如已打开按 Esc 关闭重开）"
