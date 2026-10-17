#!/usr/bin/env bash
# T1 确认横幅的真实点击驱动（M4 验证专用，不在生产链路）。
#
# 2026-10-17 VM 实测沉淀（ Fedora 44 / mako 1.11 / ydotool 1.0.4 / niri 26.04，
# 详见 docs/real-machine.md M4 小节——以下每条都踩过坑）：
#
#   1. ydotoold 的 socket 在 /tmp/.ydotool_socket（Fedora 打包默认，root 0600），
#      ydotool 客户端默认却找 $XDG_RUNTIME_DIR/.ydotool_socket——必须显式
#      YDOTOOL_SOCKET=/tmp/.ydotool_socket，且经 sudo 运行（root 才能写该 socket）。
#   2. ydotool 1.0.4 的参数解析器不认负数选项值：`mousemove -x -5` 直接打印 usage
#      失败（且极易被 `|| true` 吞掉造成"指针从未动过"的假象）。负位移必须用
#      `--` 分隔符：`mousemove -- -5 0`。
#   3. libinput 自适应加速在低速下系数≈0.5（实测 raw +40 → 逻辑 20.25，
#      1px 步进 ≈0.53）——按 raw≈2×logical 补偿；大位移钳位（±100000 溢出）不受
#      加速影响，用于复位到边缘。
#   4. click 0xC0 在 1.0.4（Rust 版）= BTN_LEFT（内核码 272），libinput 实测如此。
#   5. mako 1.11 不渲染动作按钮（actions 只控制整条通知的默认动作），Confirm1 的
#      载体是四条横幅（允许/会话允许/拒绝/永不，新者在顶）。anchor=top-right、
#      width=300、margin=10 时第一条横幅中心 ≈ (右缘-160, 顶缘+55)。
#   6. 【已知边界】mako 1.11 对"识别点击的是哪条通知"的命中测试在虚拟指针下不
#      生效：内建 dismiss-all 会触发，但 dismiss（单条）/invoke-default-action/
#      exec（都依赖定位到具体通知）全部无动作。经 org.freedesktop.Notifications
#      的 ActionInvoked 信号驱动选择，用 makoctl invoke -n <横幅id> default——
#      它发射与真实点击完全相同的信号（服务端 by=notify-action 无法区分），
#      真实鼠标点击是否可点选待用户在场复核。
#
# 用法:
#   t1-click-drive.sh <sudo密码> <横幅序号1-4>     # 真实点击第 N 条横幅（自顶向下）
#   t1-click-drive.sh <sudo密码> invoke <横幅id>   # 经 makoctl invoke 选择指定横幅
set -euo pipefail
PW="${1:?用法: t1-click-drive.sh <sudo密码> [横幅序号1-4 | invoke <id>]}"
MODE="${2:-1}"

YD() {  # 在 root 上下文经正确 socket 驱动虚拟输入设备
  echo "$PW" | sudo -S env YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool "$@" >/dev/null 2>&1
}

if [ "$MODE" = "invoke" ]; then
  # 编程选择：makoctl 发射与点击一致的 ActionInvoked（见注释 6）
  ID="${3:?用法: ... invoke <横幅id>}"
  gdbus call --session --dest org.freedesktop.Notifications \
    >/dev/null 2>&1 || true  # 无会话总线时由调用方环境兜底
  makoctl invoke -n "$ID" default
  exit 0
fi

N="$MODE"
case "$N" in 1|2|3|4) ;; *) echo "横幅序号 1-4" >&2; exit 2 ;; esac

INNER=$(mktemp /tmp/agentos-click.XXXXXX.sh)
trap 'rm -f "$INNER"' EXIT
cat > "$INNER" <<EOS
set -eu
Y="env YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool"
move() { \$Y mousemove -- "\$@" >/dev/null 2>&1 || true; }
# 复位（负溢出钳位到左上）→ 右缘（正溢出钳位，均不受加速影响）
move -100000 -100000; sleep 0.2
move 100000 0; sleep 0.2
# 回退到横幅中心列：logical≈160 → raw 302 步 1px（系数≈0.53 补偿）
for i in \$(seq 302); do move -1 0; sleep 0.006; done
# 下移到第 N 条横幅中心：N=1→55, 2→145, 3→235, 4→325（每条 ≈90px）
YS=(110 280 460 640)   # raw 步数 ≈ logical×1.9
for i in \$(seq \${YS[\$((N-1))]}); do move 0 1; sleep 0.006; done
sleep 0.3
\$Y click 0xC0   # BTN_LEFT
EOS
echo "$PW" | sudo -S env N="$N" bash "$INNER" >/dev/null
echo "clicked banner #$N（若 mako 1.11 命中测试不生效，用 invoke 模式兜底）" >&2
