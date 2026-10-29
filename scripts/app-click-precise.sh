#!/usr/bin/env bash
# 精确点击组合工具：AT-SPI 树定位（元素几何中心）→ uinput tablet 绝对坐标指针点击。
#
# 用法:
#   app-click-precise.sh [选项] <app名称> <元素名称子串>
# 选项:
#   --window-id N     目标 niri 窗口 id（默认按应用名匹配 `niri msg -j windows`）
#   --no-fullscreen   跳过全屏化，直接按报告坐标点击（窗口已知在原点/调试用）
#   --keep-fullscreen 点击后不恢复窗口状态
#   --roles=角色1,... 元素角色白名单（透传桥 locate）
#
# 为什么默认先全屏化（2026-10-29 VM 实测的坐标语义）:
#   Wayland 客户端不知道自己窗口的全局位置，AT-SPI Component 的
#   DESKTOP_COORDS 在 niri 下实际返回**窗口相对坐标**——直接点击会落空
#   （实测 VS Code tiled 时点报告中心落在状态栏，零效果）。把目标窗口
#   聚焦并全屏化后窗口原点=(0,0)，报告坐标即全局坐标（实测 VS Code
#   标题栏按钮一击命中、窗口状态真实切换）。全屏化会引起 reflow，所以
#   **定位必须在全屏之后**做；点完再 toggle 全屏恢复原状。
#
# 流程:
#   ① niri 聚焦目标窗口 → fullscreen-window（原点确定）
#   ② atspi_bridge.py locate 元素 → 几何中心
#   ③ mouse-click.sh 绝对点击（uinput tablet，无加速度语义）
#   ④ 焦点仍在本窗口时再 fullscreen-window 恢复
#
# 适用边界:
#   - 树可读但 doAction 不激活 click 处理器的应用（实测 Chromium 浏览器
#     页面元素 doAction 派发成功但 onclick 不跑）；
#   - 树里可见但无 Action 接口的元素（自绘控件等）；
#   - doAction 已实测生效的应用（GTK/Qt/Firefox/VS Code renderer）优先用
#     `atspi_bridge.py click`（不抢焦点、不动窗口状态）。
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE="$TOOL_DIR/atspi_bridge.py"

die() { echo "app-click-precise: $*" >&2; exit 1; }

# 桥/niri/mouse-click 的运行环境：AT 注册、a11y bus、socket 都挂在用户会话上
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
export NIRI_SOCKET="${NIRI_SOCKET:-$(ls "$XDG_RUNTIME_DIR"/niri.wayland-*.sock 2>/dev/null | head -1 || true)}"

WINDOW_ID="" FULLSCREEN="1" KEEP_FS="0" ROLES=""
POS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --window-id) WINDOW_ID="$2"; shift 2 ;;
    --no-fullscreen) FULLSCREEN="0"; shift ;;
    --keep-fullscreen) KEEP_FS="1"; shift ;;
    --roles=*) ROLES="$1"; shift ;;
    -*) die "未知选项 $1" ;;
    *) POS+=("$1"); shift ;;
  esac
done
[[ ${#POS[@]} -eq 2 ]] || die "用法: app-click-precise.sh [--window-id N] [--no-fullscreen] [--keep-fullscreen] <app名称> <元素名称子串>"
[[ -r "$BRIDGE" ]] || die "找不到 atspi_bridge.py（应与本脚本同目录）"
APP="${POS[0]}" MATCH="${POS[1]}"

niri_id_of() {
  niri msg -j windows 2>/dev/null | python3 -c "
import json, sys
needle = sys.argv[1].lower()
for w in json.load(sys.stdin):
    if needle in (w.get('app_id') or '').lower() or needle in (w.get('title') or '').lower():
        print(w['id']); break
" "$1"
}

FS_TOGGLED=0
if [[ "$FULLSCREEN" == 1 ]]; then
  command -v niri >/dev/null 2>&1 && [[ -n "$NIRI_SOCKET" ]] || die "--no-fullscreen 之外的路径需要 niri CLI 与 NIRI_SOCKET"
  [[ -n "$WINDOW_ID" ]] || { WINDOW_ID="$(niri_id_of "$APP")"; [[ -n "$WINDOW_ID" ]] || die "niri 窗口里找不到匹配 $APP 的窗口（可 --window-id 指定）"; }
  niri msg action focus-window --id "$WINDOW_ID" || die "聚焦窗口 $WINDOW_ID 失败"
  niri msg action fullscreen-window || die "全屏化窗口 $WINDOW_ID 失败"
  FS_TOGGLED=1
  sleep 0.6   # 全屏动画 + renderer reflow，桥读到的才是全屏后的几何
fi

restore() {
  # 点击后焦点若已被别的窗口夺走（点了关闭按钮等），toggle 全屏会打错窗口
  (( FS_TOGGLED && KEEP_FS == 0 )) || return 0
  local cur
  cur="$(niri msg -j focused-window 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' || true)"
  [[ "$cur" == "$WINDOW_ID" ]] && niri msg action fullscreen-window || true
}
trap restore EXIT

LOC="$(python3 "$BRIDGE" locate "$APP" "$MATCH" $ROLES)" || die "桥调用失败"
COORDS="$(python3 -c '
import json, sys
d = json.loads(sys.argv[1])
if not d.get("found"):
    raise SystemExit("未找到名称含 %r 的可定位元素（角色/几何过滤后为空）" % d["match"])
x, y = d["center"]
print(x, y)
sys.stderr.write("定位: name=%r role=%r geom=(%s,%s,%s,%s) 中心=(%s,%s)\n"
                 % (d["name"], d["role"], d["x"], d["y"], d["w"], d["h"], x, y))
' "$LOC")" || die "$COORDS"
read -r CX CY <<< "$COORDS"

echo "app-click-precise: 点击 ($CX,$CY) [$APP / $MATCH]"
"$TOOL_DIR/mouse-click.sh" "$CX" "$CY"
