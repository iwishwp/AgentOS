#!/usr/bin/env bash
# =============================================================================
# scripts/theme-apply-all.sh —— 系统主题联动统一调度器
#
# 一条命令把莫兰迪色板分发到全部第一方界面 + GTK：
#   状态栏 Noctalia → mako 通知 → fuzzel 启动器 → ghostty 终端 → GTK3/4 全应用
# 变体选择：读 ~/.config/noctalia/settings.json 的 colorSchemes.darkMode——
#   true → 暗色规范板 lanrhyme-palette.json；false → 浅色板 lanrhyme-palette-light.json
#   （可用 --dark/--light 强制覆盖，验证/排查用）。选定后 export
#   AGENTOS_COLORS_JSON=<变体>，各桥同源取色。
#
# Noctalia 钩子语义（settings.json hooks，全部指向本脚本）：
#   darkModeChange / wallpaperChange / colorGeneration 触发时 Noctalia 已切完
#   darkMode（或重生成完色板），本脚本按最新 darkMode 重落**对应变体**——
#   Noctalia 覆写 colors.json 也会被 theme-noctalia.sh 合并重写顶回。
#
# 幂等：可重复执行；末尾打印各桥结果一览。单桥失败不中断其余桥。
# =============================================================================
set -uo pipefail   # 不用 -e：一个桥挂不该拦住其余界面换色

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOCTALIA_DIR="${HOME}/.config/noctalia"
PALETTE_DARK="${AGENTOS_PALETTE_DARK:-${NOCTALIA_DIR}/lanrhyme-palette.json}"
PALETTE_LIGHT="${AGENTOS_PALETTE_LIGHT:-${NOCTALIA_DIR}/lanrhyme-palette-light.json}"
SETTINGS="${NOCTALIA_DIR}/settings.json"

# ---- 变体决定：--dark/--light 强制，否则看 settings.json ----
MODE="${1:-}"
if [[ "$MODE" != "--dark" && "$MODE" != "--light" && -n "$MODE" ]]; then
  echo "用法: theme-apply-all.sh [--dark|--light]（默认读 settings.json darkMode）" >&2
  exit 2
fi
if [[ -z "$MODE" ]]; then
  MODE=$(python3 - "$SETTINGS" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    dark = d.get("colorSchemes", {}).get("darkMode", True)
except Exception:
    dark = True  # settings 读不到按暗色（色板兜底全是暗色实测值）
print("--dark" if dark else "--light")
PY
)
fi
VARIANT_FILE="$PALETTE_DARK"
[[ "$MODE" == "--light" ]] && VARIANT_FILE="$PALETTE_LIGHT"

if [[ ! -f "$VARIANT_FILE" ]]; then
  if [[ "$MODE" == "--light" && -f "$PALETTE_DARK" ]]; then
    echo "警告: 浅色板缺失（${PALETTE_LIGHT}），回落暗色板——先跑 gen-palette-variant.py 生成并部署" >&2
    MODE="--dark"; VARIANT_FILE="$PALETTE_DARK"
  else
    echo "错误: 找不到色板 ${VARIANT_FILE}（部署: apply-lanrhyme-theme.sh）" >&2
    exit 1
  fi
fi

VARIANT_LABEL="暗"; [[ "$MODE" == "--light" ]] && VARIANT_LABEL="浅"
echo "== 主题联动（${VARIANT_LABEL}档）: 色板 ${VARIANT_FILE} =="
export AGENTOS_COLORS_JSON="$VARIANT_FILE"

# ---- 依次跑桥：name=script；失败记录不中断 ----
RESULTS=()
run_bridge() {
  local name="$1" script="$2"
  local out
  if out=$(bash "$SCRIPT_DIR/$script" 2>&1); then
    RESULTS+=("✓ $name")
    echo "$out" | sed 's/^/    /'
  else
    RESULTS+=("✗ $name")
    echo "$out" | sed 's/^/    /' >&2
  fi
}

run_bridge "noctalia 状态栏" "theme-noctalia.sh"
run_bridge "mako 通知"      "theme-mako.sh"
run_bridge "fuzzel 启动器"  "theme-fuzzel.sh"
run_bridge "ghostty 终端"   "theme-ghostty.sh"
run_bridge "gtk 全应用"     "theme-gtk.sh"

# ---- 结果一览 ----
echo "== 桥结果一览 =="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "（状态栏/通知即时重载；GTK 与终端已开窗口不跟随，新开即生效；Noctalia 若在跑会热重载 colors.json）"
