#!/usr/bin/env bash
# AgentOS 首启动配置部署（由 agentos-user-setup.service 在每次图形会话启动时调用）
#
# 策略：镜像默认配置放 /usr/share/agentos/defaults/（只读、随镜像版本走），
# 本脚本把它们 only-if-absent 复制进 ~/.config —— 用户已有的文件一律不动。
# 因此：
#   * 幂等，每次登录都可安全重跑；
#   * 用户改动永远不会被镜像更新覆盖；
#   * 镜像新增的默认文件（如未来加 alacritty 主题）下次登录自动到达。
# 取舍理由（vs /etc/skel）见 docs/m5-atomic.md §配置分发。
set -euo pipefail

SRC="/usr/share/agentos/defaults"
CONF="${HOME}/.config"

# copy_if_absent <src> <dst>：目标不存在才复制（保留用户文件）
copy_if_absent() {
    local src="$1" dst="$2"
    if [[ ! -e "$dst" ]]; then
        mkdir -p "$(dirname "$dst")"
        cp -r "$src" "$dst"
        echo "deployed: $dst"
    fi
}

# --- niri：主配置 + 美学 include（config.kdl 顶部 include "./aesthetics.kdl"）---
copy_if_absent "$SRC/niri/config.kdl"     "$CONF/niri/config.kdl"
copy_if_absent "$SRC/niri/aesthetics.kdl" "$CONF/niri/aesthetics.kdl"

# --- CJK 字体回退（fontconfig 用户级覆盖）---
copy_if_absent "$SRC/fontconfig/conf.d/01-agentos-cjk.conf" \
               "$CONF/fontconfig/conf.d/01-agentos-cjk.conf"

# --- GTK 暗色/字体/主题（GTK3 + GTK4）---
copy_if_absent "$SRC/gtk-3.0/settings.ini" "$CONF/gtk-3.0/settings.ini"
copy_if_absent "$SRC/gtk-4.0/settings.ini" "$CONF/gtk-4.0/settings.ini"

echo "agentos-user-setup: done (existing user files preserved)"
