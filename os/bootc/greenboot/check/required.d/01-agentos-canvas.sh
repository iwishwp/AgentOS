#!/usr/bin/env bash
# AgentOS greenboot 必需健康检查 01：canvas 组件存活（可启动形态）
#
# greenboot 在系统启动层运行（multi-user 阶段、SDDM 登录之前），此时用户会话
# 尚不存在，canvas（systemd --user 服务，监听 127.0.0.1:7788）还没有进程可探。
# 因此本检查验证的是"canvas 能不能在下一次图形登录后活起来"的启动期充分条件：
#   1. 镜像交付的 canvas 产物在位且语法可解析（node --check）；
#   2. 会随图形会话拉起它的 user 单元在位且已全局启用。
# 真正的 HTTP 存活探针（curl 127.0.0.1:7788）属于登录后运维面，放在
# greenboot 里会在健康系统上误报（→ 触发回滚 boot loop），故不采用；
# 详见 docs/m5-atomic.md「greenboot 与回滚语义」。
#
# 退出码：0 = 健康；1 = 不健康（greenboot 计数，超限触发 bootc rollback）。
set -euo pipefail

fail() { echo "agentos-canvas-check: FAIL - $*" >&2; exit 1; }

CANVAS_JS=/usr/share/agentos/packages/canvas/dist/index.js
CANVAS_UNIT=/usr/lib/systemd/user/agentos-canvas.service
WANTS_DIR=/etc/systemd/user/graphical-session.target.wants

[[ -f "$CANVAS_JS" ]] || fail "canvas dist 缺失: $CANVAS_JS"
node --check "$CANVAS_JS" || fail "canvas dist 语法错误: $CANVAS_JS"

[[ -f "$CANVAS_UNIT" ]] || fail "canvas user 单元缺失: $CANVAS_UNIT"
# 全局启用 = /etc/systemd/user/graphical-session.target.wants/ 下有符号链接
# （systemctl --global enable 的落盘形态；bootc /etc 三路合并保住它）
[[ -d "$WANTS_DIR" ]] || fail "全局 user 单元启用目录缺失（镜像构建期 enable 失败?）"
[[ -e "$WANTS_DIR/$(basename "$CANVAS_UNIT")" ]] \
    || fail "canvas 单元未被全局启用（缺 wants 符号链接）"

echo "agentos-canvas-check: OK (dist 语法通过, user 单元在位且全局启用)"
exit 0
