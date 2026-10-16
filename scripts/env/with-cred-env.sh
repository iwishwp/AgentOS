#!/usr/bin/env bash
# cred-mcp 启动器：secret-tool 走会话 dbus，补齐会话环境。
set -euo pipefail

UID_="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/cred-mcp/dist/index.js" "$@"
