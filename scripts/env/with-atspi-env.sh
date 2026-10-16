#!/usr/bin/env bash
# atspi-mcp 启动器：a11y 总线在会话 dbus 上，补齐会话环境。
set -euo pipefail

UID_="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/atspi-mcp/dist/index.js" "$@"
