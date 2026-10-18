#!/usr/bin/env bash
# 安装 AgentOS goose 悬浮球（qs -c agentos-orb）。
#
# 悬浮球 = 常驻 layer-shell 覆盖层（Overlay + 不占任务栏、不抢键盘焦点），
# 右缘垂直居中 48px：idle 圆点 / working 呼吸 / 待确认 描边弹跳；
# 点击展开最近活动面板（/replay、/artifacts 入口）。数据源与设计见 docs/orb.md。
#
# 用户配置 ~/.config/agentos/orb.json（可全缺省）：
#   { "enabled": true, "quiet_after_secs": 30, "edge_gap_px": 12 }
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../os/configs/orb"
DEST="$HOME/.config/quickshell/agentos-orb"
CONF_DIR="$HOME/.config/agentos"
CONF="$CONF_DIR/orb.json"

mkdir -p "$DEST" "$CONF_DIR"
cp "$SRC/shell.qml" "$DEST/"

# 首次安装写默认配置；已存在不覆盖（用户可能调过阈值）
if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<'EOF'
{
  "enabled": true,
  "quiet_after_secs": 30,
  "edge_gap_px": 12
}
EOF
  echo "已写入默认配置 $CONF"
fi

echo "已安装到 $DEST"
echo "自启（os/configs/niri/config.kdl 已带）：spawn-at-startup \"qs\" \"-c\" \"agentos-orb\""
echo "立即体验：qs -c agentos-orb &（或重新登录）"
