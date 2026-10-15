#!/usr/bin/env bash
# files-mcp 启动器：工作区根默认 ~/Agent，依赖 HOME 定位用户目录。
set -euo pipefail

if [[ -z "${HOME:-}" ]]; then
  HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
  export HOME
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "${REPO_ROOT}/packages/files-mcp/dist/index.js" "$@"
