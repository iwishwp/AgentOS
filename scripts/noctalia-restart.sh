#!/usr/bin/env bash
# 重启 Noctalia shell（agentos-vm / niri 会话内用）
#
# 为什么需要这个脚本而不是一行 pkill+setsid：
#   1. pkill 自匹配坑：在交互 shell 里直接跑 `pkill -f "qs -c noctalia"` 会把
#      命令行里含同样字符串的当前 shell 一起杀掉（-f 匹配完整命令行）——脚本里
#      用 bracket 模式 `[q]s -c noctalia` 规避；
#   2. stderr 可观测性：Noctalia 的 Logger WARN/ERROR 只走 stderr（console.log
#      级才进 qslog）。经 ssh `>/dev/null 2>&1` 拉起的实例出问题时零线索
#      （2026-10-18 面板事故排查因此缺 app 日志）。本脚本把 stderr 追加到
#      ~/.cache/noctalia/shell-stderr.log，每行带时间戳前缀。
set -euo pipefail

LOG="$HOME/.cache/noctalia/shell-stderr.log"

pkill -f '[q]s -c noctalia' 2>/dev/null || true
sleep 2

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export XDG_CURRENT_DESKTOP=niri XDG_SESSION_TYPE=wayland
# NIRI_SOCKET 必须带（2026-10-18 实测坑）：Noctalia 启动器点应用走
# CompositorService.spawn → niri 后端 `niri msg action spawn --`，缺此变量则
# 每次点击都无声失败（报错进 detached 子进程 stderr 无人接收）——表现为
# "启动器里所有应用都打不开"。
NIRI_SOCK="$(ls "$XDG_RUNTIME_DIR"/niri.wayland-*.sock 2>/dev/null | head -1)"
if [[ -n "$NIRI_SOCK" ]]; then
  export NIRI_SOCKET="$NIRI_SOCK"
else
  echo "警告: 未发现 niri socket（不在 niri 会话？启动器应用启动将失效）" >&2
fi

mkdir -p "$(dirname "$LOG")"
setsid sh -c "stdbuf -oL -eL qs -c noctalia 2>&1 \
  | while IFS= read -r line; do printf '%s %s\n' \"\$(date +%FT%T)\" \"\$line\"; done \
  >>'$LOG'" >/dev/null 2>&1 < /dev/null &

sleep 5
if pgrep -f '[q]s -c noctalia' >/dev/null; then
  echo "noctalia restarted (stderr -> $LOG)"
else
  echo "FAILED to start noctalia; tail of $LOG:" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi
