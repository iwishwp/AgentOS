#!/usr/bin/env bash
# desktop-mcp 启动器：补齐 Wayland 会话环境（notify-send 走 dbus、wl-copy/wl-paste
# 走 Wayland socket），保证从 SSH/服务环境拉起时工具仍可用。
set -euo pipefail

UID_="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_}}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/desktop-mcp/dist/index.js" "$@"
