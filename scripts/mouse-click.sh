#!/usr/bin/env bash
# 通用鼠标指针注入：uinput tablet 协议（绝对坐标，根治方案）。
#
# 用法:
#   mouse-click.sh <x> <y> [left|right]     # 在逻辑坐标 (x,y) 点击（默认左键）
#   mouse-click.sh --move <x> <y>           # 只移动光标不点击
#   mouse-click.sh --hold-ms <N> <x> <y>    # 长按（拖拽前按住等场景，默认 60ms）
#
# 方案（2026-10-19 实测定论，背景见 docs/capabilities.md L3）:
#   - ydotool mousemove -a 受 libinput 指针加速度拖累（≈0.5 系数漂移），弃用；
#   - 自建 uinput pointer 协议 / 单点触摸屏协议，niri(smithay) 不消费（M2/M4）；
#   - **tablet/pen 协议成立**：数字化仪是原生绝对坐标设备，libinput 完整支持
#     （Capabilities: tablet），niri 把 pen 位置映射为光标、笔尖触底（BTN_TOUCH）
#     映射为按下。实测 gnome-calculator 连点 "7""7" → 显示区读回 "77"；
#     Noctalia 顶栏 ControlCenter 图标命中弹出控制中心。无加速度语义，
#     落点=给定逻辑坐标。
#   - 两个必须的内核细节（libinput 否则整设备拒收，报
#     "missing tablet capabilities: btn-stylus resolution"）：
#     ① BTN_STYLUS=0x14b（0x141 是 eraser）；② ABS_X/Y 必须带非零 resolution，
#     老式 uinput_user_dev 写入没有该字段，必须走 UI_ABS_SETUP ioctl。
#
# 权限（用户级优先）:
#   /dev/uinput 默认 root:600。用户级两条路：
#   ① 持久方案（推荐，已入镜像 os/configs/udev/60-agentos-uinput.rules）：
#      udev 规则 KERNEL=="uinput", MODE="0660", GROUP="input" +
#      桌面用户入 input 组（usermod -aG input <user>，重新登录生效）；
#   ② 本脚本自动回落：SUDO_PW 环境变量 + sudo -S（kb-inject.sh 同款）。
#
# 环境: 与 kb-inject.sh 同族——坐标是 niri 逻辑坐标；屏幕逻辑范围自动从
#   `niri msg -j outputs` 取所有输出包围盒（NIRI_SOCKET 需指向目标会话），
#   也可 --screen WxH 手动指定。注入全局生效（不依赖调用方在哪个会话）。
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TABLET="$TOOL_DIR/uinput-tablet.py"
[[ -x "$TABLET" ]] || TABLET="$TOOL_DIR/../scripts/uinput-tablet.py"

die() { echo "mouse-click: $*" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || die "需要 python3（零第三方依赖）"
[[ -r "$TABLET" ]] || die "找不到 uinput-tablet.py（应在 scripts/ 同目录）"

MODE="tap" BUTTON="left" HOLD_MS="60" SCREEN=""
declare -a POS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --move)    MODE="move"; shift ;;
    --hold-ms) HOLD_MS="$2"; shift 2 ;;
    --screen)  SCREEN="$2"; shift 2 ;;
    left|right) BUTTON="$1"; shift ;;
    *) POS+=("$1"); shift ;;
  esac
done
[[ ${#POS[@]} -eq 2 ]] || die "用法: mouse-click.sh [--move] <x> <y> [left|right]"
[[ "$BUTTON" == right || "$BUTTON" == left ]] || die "按钮只支持 left|right"

# 屏幕逻辑范围：所有输出逻辑位置的包围盒（单输出即该输出尺寸）
if [[ -z "$SCREEN" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  NIRI_SOCKET="${NIRI_SOCKET:-$(ls "$XDG_RUNTIME_DIR"/niri.wayland-*.sock 2>/dev/null | head -1 || true)}"
  [[ -n "$NIRI_SOCKET" ]] && export NIRI_SOCKET
  SCREEN="$(niri msg -j outputs 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
outs = list(data.values()) if isinstance(data, dict) else data  # niri -j outputs 按名键
if not outs or not all("logical" in o for o in outs):
    raise SystemExit(1)
xs1 = [o["logical"]["x"] for o in outs];             ys1 = [o["logical"]["y"] for o in outs]
xs2 = [o["logical"]["x"] + o["logical"]["width"] for o in outs]
ys2 = [o["logical"]["y"] + o["logical"]["height"] for o in outs]
w = max(xs2) - min(xs1); h = max(ys2) - min(ys1)
if w <= 0 or h <= 0:
    raise SystemExit(1)
print(f"{round(w)}x{round(h)}")
' || true)"
fi
SCREEN="${SCREEN:-1280x800}"  # niri 不可达时的保底（VM 主会话尺寸）

RUN() {
  if [[ -w /dev/uinput ]]; then
    python3 "$TABLET" "$@"
  elif [[ -n "${SUDO_PW:-}" ]]; then
    echo "$SUDO_PW" | sudo -S python3 "$TABLET" "$@" >/dev/null 2>&1
  else
    die "/dev/uinput 不可写且未提供 SUDO_PW（用户级方案见文件头注释：input 组 + udev 规则）"
  fi
}

if [[ "$MODE" == "move" ]]; then
  RUN move "${POS[0]}" "${POS[1]}" --screen "$SCREEN"
else
  RUN tap "${POS[0]}" "${POS[1]}" --button "$BUTTON" --hold-ms "$HOLD_MS" --screen "$SCREEN"
fi
