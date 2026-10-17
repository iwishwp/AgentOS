#!/usr/bin/env bash
# T1 确认横幅的真实点击驱动（M4 验证专用，不在生产链路）。
#
# 背景与策略：mako 不渲染动作按钮（Fedora mako 1.11 的 actions 选项只控制整条
# 通知的默认动作），Confirm1 的等价载体是"一条选择一条横幅、点击即选"。
# ydotool 虚拟设备没有 ABS 轴、libinput 指针自适应加速使相对移动不可线性预测，
# 故：大位移用溢出钳位（钳到 (0,0) 与右缘，溢出量不怕加速放大），
#     小位移用 1px 步进（低速下加速系数≈1，落点可预测）。
# 扫描：Y 从 55 到 330（四条横幅区，顶部状态栏以下），每 15px 点一次；
# 点中任一横幅即产生 ActionInvoked → Confirm1 resolve(choice)。
# 用法: t1-click-drive.sh <sudo密码> [结果文件：非空即停止扫描]
set -euo pipefail
PW="${1:?用法: t1-click-drive.sh <sudo密码> [结果文件]}"
OUTFILE="${2:-}"

INNER=$(mktemp /tmp/agentos-sweep.XXXXXX.sh)
trap 'rm -f "$INNER"' EXIT
cat > "$INNER" <<'EOS'
set -eu
YD="ydotool"
move() { $YD mousemove "$@" >/dev/null 2>&1 || true; }

# ① 复位 (0,0)（负溢出钳位）② 右缘（正溢出钳位）③ 收回 100px（1px 步进）
move -x -100000; move -y -100000
sleep 0.15
move -x 100000
sleep 0.15
for i in $(seq 50); do move -x -2; sleep 0.008; done

# ④ 沿 Y 扫描：每 1px 步进下移，每 15px 点一次（55→330）
CLICKED=0
for i in $(seq 275); do
  move -y 1
  sleep 0.008
  CLICKED=$((CLICKED + 1))
  if [ $((CLICKED % 15)) -eq 0 ]; then
    $YD click 0xC0 >/dev/null 2>&1 || true
    sleep 0.05
    if [ -n "${OUTFILE:-}" ] && [ -s "${OUTFILE:-/nonexistent}" ]; then
      echo "resolved at sweep-y≈$i"
      exit 0
    fi
  fi
done
EOS

# 密码走 stdin（-S），内层脚本走文件——两者不抢流
echo "$PW" | sudo -S env OUTFILE="$OUTFILE" bash "$INNER" >/dev/null
echo "sweep 完成（如结果文件已非空即点中了横幅）"
