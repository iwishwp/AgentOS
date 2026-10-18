#!/usr/bin/env bash
# =============================================================================
# scripts/theme-apply-all.sh —— 薄壳：转发给 agentos-settings CLI
#
# 编排职责已收编到常驻进程 packages/settings-daemon（TS）：
#   watcher 监听 colors.json / settings.json darkMode / 色板文件 → 自动应用五桥，
#   本脚本只剩手动触发入口（兼容旧调用方与 muscle memory）。
#   等价命令：agentos-settings apply [--dark|--light|--auto]
# 幂等语义不变；daemon 在跑时本脚本照常可用（写入一致时桥会幂等跳过，无回环）。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="${AGENTOS_SETTINGS_CLI:-${SCRIPT_DIR}/../packages/settings-daemon/dist/index.js}"

MODE="${1:-}"
if [[ "$MODE" != "--dark" && "$MODE" != "--light" && "$MODE" != "--auto" && -n "$MODE" ]]; then
  echo "用法: theme-apply-all.sh [--dark|--light|--auto]（默认读 settings.json darkMode）" >&2
  exit 2
fi

if [[ ! -f "$CLI" ]]; then
  echo "错误: 找不到 CLI ${CLI}（先在仓库根 npm run build -w packages/settings-daemon）" >&2
  exit 1
fi

exec node "$CLI" apply "${MODE:---auto}"
