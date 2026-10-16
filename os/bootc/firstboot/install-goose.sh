#!/usr/bin/env bash
# goose CLI 安装（首启动兜底路径，由 agentos-goose-firstboot.service 调用）
#
# 为什么放首启动而不是构建期：goose 是 GitHub release 二进制，本项目构建
# 环境（aarch64 VM）到 github.com 直连被重置（download_cli.sh 实测 55s 超时，
# 见 docs/m5-atomic.md §网络实测）；装机后用户网络通常可达，开机自愈更稳。
# CI 环境若可达，可用 GOOSE_INSTALL_MODE=build 在镜像里直接带上（Containerfile
# 层 4）。
#
# 安装到 ~/.local/bin（无 root、按用户隔离）；systemd user 单元环境下
# ~/.local/bin 已默认在 PATH（systemd 249+ 的 default PATH 含它）。
set -euo pipefail

STAMP_DIR="${HOME}/.config/agentos"
STAMP="${STAMP_DIR}/goose-installed.stamp"

# 已装（或本轮装成功）则盖戳，ConditionPathExists 据此跳过后续登录的重试
if command -v goose >/dev/null 2>&1; then
    mkdir -p "$STAMP_DIR" && date -Is > "$STAMP"
    echo "install-goose: goose already present ($(goose --version 2>/dev/null || echo '?'))"
    exit 0
fi

if [[ -e "$STAMP" ]]; then
    echo "install-goose: previously attempted, still missing goose — retrying anyway"
fi

# 上游官方安装脚本（与 os/install.sh --with-goose 同源）；
# 网络抖动重试 3 次，每次 120s 上限，避免卡住登录会话
URL="https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh"
for i in 1 2 3; do
    echo "install-goose: attempt $i → $URL"
    if curl -fsSL --retry 2 --max-time 120 "$URL" -o /tmp/goose-install.sh \
       && bash /tmp/goose-install.sh; then
        rm -f /tmp/goose-install.sh
        mkdir -p "$STAMP_DIR" && date -Is > "$STAMP"
        echo "install-goose: installed $("${HOME}/.local/bin/goose" --version 2>/dev/null || echo goose)"
        exit 0
    fi
    rm -f /tmp/goose-install.sh
    sleep $((i * 10))
done

# 失败不阻断登录：单元标记成功退出，用户下次登录自动重试（stamp 未写即会重跑）
echo "install-goose: FAILED after 3 attempts (github.com unreachable?). Will retry next login."
exit 0
