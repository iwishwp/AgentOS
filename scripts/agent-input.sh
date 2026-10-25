#!/usr/bin/env bash
# agent-input.sh —— agent 专用键鼠：直连水族馆（嵌套 niri）自己的 Wayland display，
# 与人的主 seat 输入真并行——互不抢焦点、互不打扰（人聚焦哪个主窗口都无所谓）。
# 2026-10-25 VM 实测定案（F44 / niri 26.04），依据见 docs/capabilities.md 附录 E。
#
# 原理：嵌套 niri 是完整 compositor，在水族馆 display 上同样暴露
#   zwp_virtual_keyboard_manager_v1（wtype 走它）
#   zwlr_virtual_pointer_manager_v1 v2（wlrctl 走它）
# 客户端连水族馆的 display，注入只进嵌套 seat——主 seat 焦点窗口零感知，
# 不再需要"聚焦水族馆→注入→还原焦点"三步走（kb-inject.sh / mouse-click.sh 的借道模式保留作主 seat 兜底）。
#
# 用法:
#   agent-input.sh display                  # 打印发现的水族馆 Wayland display
#   agent-input.sh type "文本"              # 键盘输入文本（CJK 自动逐字符慢输防丢字）
#   agent-input.sh key ctrl+Return          # 组合键（+ 分隔修饰键）
#   agent-input.sh move x y                 # 指针绝对移动
#   agent-input.sh click x y [left|right|middle]   # 绝对坐标点击（默认 left）
#
# 依赖: wtype（键盘）、wlrctl（指针，dnf install wlrctl——wlr-protocols 系，Fedora 官方仓有）
#
# display 发现（自动）: 水族馆 IPC socket 形如 /run/user/$UID/niri.wayland-N.<pid>.sock，
#   取进程 cmdline 含 niri 且不含 --session 的那个（主会话是 `niri --session`，水族馆无该参数）；
#   多个候选取最新。AGENTOS_AQ_DISPLAY 可显式覆盖（session-mcp 返回的 waylandDisplay 填这里）。
#
# 实测边界（2026-10-25）:
#   - wlrctl 只发相对位移（协议本身有 motion_absolute 但 wlrctl 未暴露），绝对坐标用
#     "钳到左上角再相对移动"合成：corner-clamp 后位移即绝对坐标，命中精度 100%
#     （300,300 / 200,500 / 400,200 / 380,220 …全部按命令落点）。两次 wlrctl 调用间隔
#     过短（<0.2s）偶发落点偏移一次，脚本间隔固定 0.4s 未再复现；
#   - wtype 老边界仍适用：纯控制键（Return/Tab）在 GTK 控件不触发行为（见 kb-inject.sh），
#     水族馆里需要"输入+回车"时优先 a11y 激活控件或改用本脚本 click 点按钮；
#   - 主 seat 的键鼠永远不会被抢——注入根本不经过主 seat，这是结构保证不是时序保证。
set -euo pipefail

MODE="${1:-}"; shift || true
die() { echo "agent-input: $*" >&2; exit 1; }
[[ -n "$MODE" ]] || die "用法: agent-input.sh display|type|key|move|click [参数]（见文件头注释）"

# ---- 水族馆 display 发现 ----------------------------------------------------
aq_display() {
  if [[ -n "${AGENTOS_AQ_DISPLAY:-}" ]]; then echo "$AGENTOS_AQ_DISPLAY"; return 0; fi
  local uid="$(id -u)" best="" best_t=""
  local f name pid display cmd
  for f in /run/user/$uid/niri.wayland-*.sock; do
    [[ -e "$f" ]] || continue
    name="$(basename "$f")"                       # niri.wayland-N.<pid>.sock
    pid="$(echo "$name" | sed -E 's/^niri\.wayland-[0-9]+\.([0-9]+)\.sock$/\1/')"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -d /proc/$pid ]] || continue               # 进程还活着
    cmd="$(tr '\0' ' ' </proc/$pid/cmdline 2>/dev/null || true)"
    [[ "$cmd" == *niri* ]] || continue
    [[ "$cmd" == *--session* ]] && continue       # 主会话带 --session，跳过
    display="$(echo "$name" | sed -E 's/^niri\.(wayland-[0-9]+)\..*$/\1/')"
    local t; t="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    if [[ -z "$best" || "$t" -gt "$best_t" ]]; then best="$display"; best_t="$t"; fi
  done
  [[ -n "$best" ]] || die "未发现水族馆 display（水族馆没开？可 export AGENTOS_AQ_DISPLAY 显式指定）"
  echo "$best"
}

AQ="$(aq_display)"
export WAYLAND_DISPLAY="$AQ"

wtype_key() {  # "ctrl+shift+x" → wtype -M ctrl -M shift -k x -m shift -m ctrl
  local IFS='+'
  local -a ks=($1) mods=() args=()
  local main="${ks[${#ks[@]}-1]}" m
  for m in "${ks[@]:0:${#ks[@]}-1}"; do mods+=("$m"); done
  for m in "${mods[@]}"; do args+=( -M "$m" ); done
  args+=( -k "$main" )
  for m in "${mods[@]}"; do args+=( -m "$m" ); done
  wtype "${args[@]}"
}

abs_click() {  # abs_click x y [button] —— 角落钳位 + 相对位移 = 绝对坐标
  local x="$1" y="$2" btn="${3:-left}"
  wlrctl pointer move -9999 -9999; sleep 0.4     # 钳位到 (0,0)（屏幕边缘 clamp）
  wlrctl pointer move "$x" "$y"; sleep 0.4       # 位移量即绝对坐标
  wlrctl pointer click "$btn"
}

case "$MODE" in
  display) echo "$AQ" ;;
  type)
    [[ $# -ge 1 ]] || die "type 需要文本参数"
    if [[ "$1" =~ [^[:print:][:space:]] ]]; then   # 含非 ASCII（CJK 等）→ 逐字符慢输
      for ((i=0; i<${#1}; i++)); do wtype -d 60 "${1:i:1}"; sleep 0.12; done
    else
      wtype -d 150 "$1"
    fi ;;
  key)
    [[ $# -ge 1 ]] || die "key 需要键名参数（如 ctrl+Return）"
    wtype_key "$1" ;;
  move)
    [[ $# -eq 2 ]] || die "move 需要 x y"
    wlrctl pointer move -9999 -9999; sleep 0.4
    wlrctl pointer move "$1" "$2" ;;
  click)
    [[ $# -ge 2 ]] || die "click 需要 x y [left|right|middle]"
    abs_click "$1" "$2" "${3:-left}" ;;
  *) die "未知模式 $MODE（display|type|key|move|click）" ;;
esac
