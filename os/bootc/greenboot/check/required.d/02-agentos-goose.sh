#!/usr/bin/env bash
# AgentOS greenboot 必需健康检查 02：goose 在位（或自愈路径完整）
#
# goose 的两种到位形态（os/bootc/Containerfile ARG GOOSE_INSTALL_MODE）：
#   build     —— 构建期装进 /usr/local/bin（CI / 网络可达环境）：
#               本检查直接验证二进制存在且可执行 `--version`。
#   firstboot —— 默认。构建环境到 github.com 不可达（本项目实测），goose 由
#               首启动 user 单元在登录联网后装到 ~/.local/bin。greenboot 运行
#               在登录之前，此刻 goose 天然不在——若此时检查二进制存在性，
#               健康系统会被误判不健康（→ 回滚 boot loop）。因此 firstboot
#               形态下检查"自愈链路完整"：安装脚本 + user 单元 + 全局启用
#               三者均在位，goose 到达只是时间问题（登录 + 网络）。
# 详见 docs/m5-atomic.md「greenboot 与回滚语义」。
#
# 退出码：0 = 健康；1 = 不健康（greenboot 计数，超限触发 bootc rollback）。
set -euo pipefail

fail() { echo "agentos-goose-check: FAIL - $*" >&2; exit 1; }

GLOBAL_BIN=/usr/local/bin/goose
INSTALL_SH=/usr/share/agentos/bin/install-goose.sh
FIRSTBOOT_UNIT=/usr/lib/systemd/user/agentos-goose-firstboot.service
WANTS_DIR=/etc/systemd/user/graphical-session.target.wants

if [[ -x "$GLOBAL_BIN" ]]; then
    # GOOSE_INSTALL_MODE=build：goose 已烘焙进镜像，做真实验证
    "$GLOBAL_BIN" --version >/dev/null 2>&1 \
        || fail "goose 二进制存在但无法执行 ($($GLOBAL_BIN --version 2>&1 | head -1))"
    echo "agentos-goose-check: OK (goose 烘焙在位: $("$GLOBAL_BIN" --version 2>/dev/null | head -1))"
    exit 0
fi

# GOOSE_INSTALL_MODE=firstboot（默认）：验证自愈链路完整
[[ -f "$INSTALL_SH" ]]      || fail "goose 安装脚本缺失: $INSTALL_SH"
[[ -f "$FIRSTBOOT_UNIT" ]]  || fail "goose 首启动 user 单元缺失: $FIRSTBOOT_UNIT"
[[ -d "$WANTS_DIR" ]]       || fail "全局 user 单元启用目录缺失（镜像构建期 enable 失败?）"
[[ -e "$WANTS_DIR/$(basename "$FIRSTBOOT_UNIT")" ]] \
    || fail "goose 首启动单元未被全局启用（缺 wants 符号链接）"

echo "agentos-goose-check: OK (firstboot 自愈链路完整; goose 将于首次图形登录联网后安装)"
exit 0
