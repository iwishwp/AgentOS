#!/usr/bin/env bash
# niri-mcp 启动器：自动发现 niri IPC socket（路径含 compositor PID，每次会话不同），
# 再拉起 MCP server。goose 扩展与未来的 systemd 服务统一走这个入口。
set -euo pipefail

UID_="$(id -u)"
if [[ -z "${NIRI_SOCKET:-}" ]]; then
  NIRI_SOCKET="$(ls /run/user/${UID_}/niri.*.sock 2>/dev/null | head -1 || true)"
  [[ -n "$NIRI_SOCKET" ]] && export NIRI_SOCKET
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${REPO_ROOT}/packages/niri-mcp/dist/index.js" "$@"
