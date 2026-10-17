#!/usr/bin/env bash
# 安装 AgentOS 键位速查浮层（qs -c agentos-hotkeys）。
#
# 浮层 = layer-shell 覆盖层（不是应用窗口）：Super+K 居中弹出、一行一条、
# Esc/点按关闭，进程即起即退无常驻。数据实时解析 niri 配置，配色实时读
# Noctalia colors.json（均为兜底安全）。设计见 docs/keyboard.md §2.1。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../os/configs/hotkeys"
DEST="$HOME/.config/quickshell/agentos-hotkeys"

mkdir -p "$DEST"
cp "$SRC/shell.qml" "$DEST/"
echo "已安装到 $DEST"
echo "绑定（os/configs/niri/config.kdl 已带）：Super+K → spawn qs -c agentos-hotkeys"
