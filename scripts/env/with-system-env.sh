#!/usr/bin/env bash
# system-mcp 启动器：只读系统查询，无特殊会话环境依赖。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/system-mcp/dist/index.js" "$@"
