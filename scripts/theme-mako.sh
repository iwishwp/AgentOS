#!/usr/bin/env bash
# =============================================================================
# scripts/theme-mako.sh —— 通知样式对齐系统主题（莫兰迪）
#
# mako 配置极简，不支持变量；本脚本从 Noctalia 色板（colors.json，换壁纸重生成后
# 自动跟随）读取颜色生成 ~/.config/mako/config 并 makoctl reload。
# 色板缺失/缺键时用内置莫兰迪同值兜底（与 os/configs/noctalia/lanrhyme/colors.json 一致）。
# 三档紧急度：low=淡（常规完成）、normal=标准、critical=醒目（确认横幅，M4 通道）。
# =============================================================================
set -euo pipefail

COLORS="${AGENTOS_COLORS_JSON:-$HOME/.config/noctalia/colors.json}"
OUT="${MAKO_CONFIG:-$HOME/.config/mako/config}"

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

# Material 色板键 → 通知语义；兜底=lanrhyme 色板实测值
BG=$(get surface_container "#37362f")        # 面板底
BG_HI=$(get surface_container_highest "#3d3b34")
TXT=$(get on_surface "#f3f3f2")              # 主文字
TXT_DIM=$(get on_surface_variant "#b5b4b0")  # 次文字
ACCENT=$(get primary "#dad8ce")              # 强调（描边/标题）
BORDER=$(get outline_variant "#6c6a61")

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
# 由 scripts/theme-mako.sh 生成——莫兰迪系统主题（源：colors.json）
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
EOF

makoctl reload 2>/dev/null && echo "已重载（$(date '+%H:%M:%S')）" || echo "makoctl 不可用（重启 mako 生效）"
echo "写入 $OUT"
