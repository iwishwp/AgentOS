#!/usr/bin/env bash
# 通用键盘注入：优先 wtype（Wayland 原生 zwp_virtual_keyboard 协议，用户级、无需
# root、niri 原生支持），回落 ydotool（需 ydotoold + sudo——socket 为 root 0600，
# Fedora 打包在 /tmp/.ydotool_socket，三个已知坑详见 t1-click-drive.sh 头注释）。
#
# 用法:
#   kb-inject.sh type "文本"          # 输入文本
#   kb-inject.sh type-slow "文本"     # 逐字符慢输（CJK 首字符丢失边界时用，见下）
#   kb-inject.sh key Return           # 单键（X keysym 名，大小写不敏感）
#   kb-inject.sh key ctrl+Return      # 组合键（+ 分隔修饰键）
#   kb-inject.sh key ctrl+shift+comma
#
# 环境: WAYLAND_DISPLAY 指向目标 compositor（主会话 wayland-1；水族馆从
# /run/user/$(id -u)/niri.wayland-*.sock 差集发现，或 session-mcp 的返回值）。
# 注入目标是**当前聚焦表面**——配合 a11y 的 Component.grabFocus 先把焦点放到目标
# 控件（实测 2026-10-18：grabFocus Chromium 页面 entry 后 wtype 输入成功读回）。
#
# wtype 已知边界（2026-10-18 实测，VM/F44/niri 26.04）:
#   - 文本与可打印键可靠（GTK3/Chromium entry 输入均读回实证，含 space）；
#   - 修饰组合键可靠（ctrl+shift+comma 注入 ghostty 热重载实证，见 theme-apply-all.sh）；
#   - **纯控制键（Return/Tab）在 GTK 下不触发行为**（entry 输入后注入 Return 不激活，
#     space 却能进字）——需要回车/导航键的场景走 ydotool（evdev keycode 路径，
#     M4 实证 Super+K、密码+回车全通），即本脚本 key 模式的回落参数（evdev 序列）；
#   - CJK 多字符可能丢首字符（"潜航员甲" → "航员甲"；拉丁稳定），type-slow 可缓解，
#     关键输入后建议从 a11y 树读回核对；
#   - 只做键盘，指针注入仍走 ydotool（指针加速度问题见 capabilities.md L3）。
# ydotool 回落路径需要 SUDO_PW 环境变量（或调用方已配 NOPASSWD）。
set -euo pipefail

MODE="${1:?用法: kb-inject.sh type|type-slow|key <参数>}"
ARG="${2:?缺少参数}"

die() { echo "kb-inject: $*" >&2; exit 1; }

wtype_key() {  # 解析 "ctrl+shift+x" → wtype -M ctrl -M shift -k x -m shift -m ctrl
  local IFS='+'
  local -a ks=($1) mods=() args=()
  local main="${ks[${#ks[@]}-1]}" m
  for m in "${ks[@]:0:${#ks[@]}-1}"; do mods+=("$m"); done
  for m in "${mods[@]}"; do args+=( -M "$m" ); done
  args+=( -k "$main" )
  for m in "${mods[@]}"; do args+=( -m "$m" ); done
  wtype "${args[@]}"
}

if command -v wtype >/dev/null 2>&1; then
  case "$MODE" in
    type)      wtype -d 150 "$ARG" ;;
    type-slow) for ((i=0; i<${#ARG}; i++)); do
                 wtype -d 60 "${ARG:i:1}"; sleep 0.12
               done ;;
    key)       wtype_key "$ARG" ;;
    *) die "未知模式 $MODE（type|type-slow|key）" ;;
  esac
  exit 0
fi

# 回落：ydotool（root socket；type 直接支持文本，key 需要 evdev keycode 序列）
command -v ydotool >/dev/null 2>&1 || die "无可用键盘注入工具（wtype 与 ydotool 都缺）"
[[ -n "${SUDO_PW:-}" ]] || die "ydotool 回落需要 SUDO_PW 环境变量（ydotoold socket 为 root 0600）"
YD() { echo "$SUDO_PW" | sudo -S env YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool "$@" >/dev/null 2>&1; }
case "$MODE" in
  type|type-slow) YD type "$ARG" ;;
  # keysym 名 → evdev keycode 的映射不做（符号空间太大）；调用方给 keycode 序列
  key) YD key $ARG ;;
  *) die "未知模式 $MODE" ;;
esac
