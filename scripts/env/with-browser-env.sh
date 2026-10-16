#!/usr/bin/env bash
# browser-mcp 启动器：需要图形会话环境（在水族馆里拉 Chromium）。
set -euo pipefail

UID_="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_}}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/browser-mcp/dist/index.js" "$@"
