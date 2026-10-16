#!/usr/bin/env bash
# AgentOS 会话录屏：对 agent 会话（水族馆）的 Wayland 输出录制，产出 ~/Agent/recordings/<时间戳>.mkv。
#
# 设计要点（详见 docs/session-recording.md）：
# - 默认引擎 = grim(wlr-screencopy) | ffmpeg 管道：只连接水族馆自己的 WAYLAND_DISPLAY，
#   物理上不可能录到用户桌面——隐私边界天然成立；且不挑 GPU（VM/llvmpipe 可用）。
# - gpu-screen-recorder 引擎（--engine gsr）：仅在支持的 GPU（AMD/Intel/NVIDIA）上可用，
#   录的是整块物理屏幕（KMS）或 portal 交互选择的显示器——适合"用户主动录自己屏幕"，
#   不能用于只录水族馆（其 KMS/portal 架构绑定物理输出与主会话）。
#
# 用法:
#   scripts/record-session.sh start [--display wayland-N] [--fps N] [--engine grim|gsr]
#   scripts/record-session.sh stop
#   scripts/record-session.sh status
# 环境变量: RECORDINGS_DIR（默认 ~/Agent/recordings）
set -euo pipefail

SUBCMD="${1:-help}"; shift 2>/dev/null || true
RECORDINGS_DIR="${RECORDINGS_DIR:-$HOME/Agent/recordings}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
PIDFILE="$RECORDINGS_DIR/.recorder.pid"
OUTFILE_FILE="$RECORDINGS_DIR/.recorder.out"
LOGFILE="$RECORDINGS_DIR/.recorder.log"
ENGINE="grim"
FPS="8"
DISPLAY_ARG=""

usage() {
  cat <<'EOF'
用法:
  record-session.sh start [--display wayland-N] [--fps N] [--engine grim|gsr]
      录制 agent 会话（水族馆）的 Wayland 输出 → ~/Agent/recordings/<时间戳>.mkv
      --engine grim  grim(wlr-screencopy)|ffmpeg 管道，只连水族馆 display（默认，隐私边界）
      --engine gsr   gpu-screen-recorder 录整块物理屏（需 AMD/Intel/NVIDIA；用户主动整屏录制场景）
  record-session.sh stop      停止并优雅收尾（打印文件/大小/时长）
  record-session.sh status    是否在录 + 最近录像列表
环境变量: RECORDINGS_DIR（默认 ~/Agent/recordings）
EOF
  exit "${1:-0}"
}

die() { echo "错误: $*" >&2; exit 1; }

# ---------- 参数解析 ----------
[[ "$SUBCMD" != "start" ]] || while [ $# -gt 0 ]; do
  case "$1" in
    --display) DISPLAY_ARG="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) die "未知参数 $1（start 子命令支持 --display/--fps/--engine）" ;;
  esac
done

# ---------- 水族馆 Wayland display 探测 ----------
# 水族馆 = 嵌套 niri，拥有自己的 niri IPC socket（niri.wayland-N.PID.sock）。
# 安全规则：只有当父会话 WAYLAND_DISPLAY 已知时才自动探测（用它排除用户自己的会话）；
# 没有该线索时拒绝猜测——宁可要求 --display，也不冒录到用户桌面的风险（信任功能的安全默认）。
find_aquarium_display() {
  local candidates
  candidates=$(cd "$RUNTIME_DIR" 2>/dev/null && ls -t niri.wayland-*.sock 2>/dev/null || true)
  [ -n "$candidates" ] || { echo ""; return 3; }
  if [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "当前环境没有 WAYLAND_DISPLAY，无法区分用户主会话与水族馆（候选: $(echo "$candidates" | tr '\n' ' ')）。" >&2
    echo "请用 --display wayland-N 明确指定（水族馆的 display 见 agent_session_start 的返回）。" >&2
    return 4
  fi
  local pick
  pick=$(echo "$candidates" | grep -v "^niri.${WAYLAND_DISPLAY}\." | head -1 || true)
  if [ -z "$pick" ]; then
    echo "只找到当前会话自己的 socket（${WAYLAND_DISPLAY}），水族馆似乎没在运行。" >&2
    echo "先用 session-mcp 的 agent_session_start 启动它，再开始录制。" >&2
    return 5
  fi
  echo "$pick" | sed -E 's/^niri\.(wayland-[0-9]+)\..*$/\1/'
}

display_socket_exists() {  # $1 = wayland-N
  [ -S "$RUNTIME_DIR/$1" ]
}

# ---------- ffmpeg 编码器探测 ----------
# Fedora 是 ffmpeg-free：无 libx264；libopenh264 在部分平台（实测 aarch64 F44）"在名单里但建不出
# 编码器"。因此逐个用 1 帧 lavfi 实测，取第一个真正可用的。VP8/VP9(libvpx) 装机即有且 mkv 兼容。
pick_encoder() {
  local c encs
  # 注意: 先捕获再 grep——pipefail 下 `ffmpeg -encoders | grep -q` 会因 grep 早退/SIGPIPE 误判失败
  encs=$(ffmpeg -hide_banner -loglevel error -encoders 2>/dev/null || true)
  for c in libx264 libopenh264 libvpx-vp9 libvpx; do
    if printf '%s\n' "$encs" | grep -q " $c "; then
      if ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=64x64:rate=1 \
           -frames:v 1 -c:v "$c" -pix_fmt yuv420p -f null - 2>/dev/null; then
        echo "$c"; return 0
      fi
    fi
  done
  echo ""
}

recorder_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

# ---------- 子命令 ----------
case "$SUBCMD" in
  start)
    recorder_running && die "已在录制（$(cat "$OUTFILE_FILE")）。先 stop 再 start。"
    mkdir -p "$RECORDINGS_DIR"

    local_target="$DISPLAY_ARG"
    if [ -z "$local_target" ]; then
      if ! local_target=$(find_aquarium_display); then
        die "无法自动确定水族馆 display（原因见上方提示）。可显式指定: $0 start --display wayland-N"
      fi
    fi
    display_socket_exists "$local_target" || die "Wayland display $local_target 不存在（水族馆可能已退出）。
先 agent_session_start 再录制，或用 --display 指定（当前 $RUNTIME_DIR 下: $(cd "$RUNTIME_DIR" && ls wayland-* 2>/dev/null | tr '\n' ' ')）"

    TS=$(date +%Y%m%d-%H%M%S)
    OUT="$RECORDINGS_DIR/$TS.mkv"
    ENCODER=$(pick_encoder)
    [ -n "$ENCODER" ] || die "ffmpeg 无可用视频编码器（libopenh264/libx264/libvpx-vp9 均缺失）"

    if [ "$ENGINE" = "gsr" ]; then
      # gpu-screen-recorder：录物理屏幕（用户主动录制场景）。KMS 捕获不区分 WAYLAND_DISPLAY，
      # 但 gsr 自身要连一个 Wayland 会话初始化窗口——用当前（用户主）会话的 display。
      command -v gpu-screen-recorder >/dev/null || die "gpu-screen-recorder 未安装（Fedora 需 COPR arabianq/gpu-screen-recorder）"
      [ -n "${WAYLAND_DISPLAY:-}" ] || die "gsr 引擎录的是物理屏幕，须在图形会话环境内运行（当前没有 WAYLAND_DISPLAY）"
      XDG_RUNTIME_DIR="$RUNTIME_DIR" WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
        setsid gpu-screen-recorder -w screen -c mkv -f "$FPS" -k h264 -o "$OUT" >"$LOGFILE" 2>&1 &
      CHILD=$!
    else
      # grim | ffmpeg：每帧向水族馆的 wlr-screencopy 请求整幅画面（与 session-mcp 截图同机制），
      # PPM 原始帧走命名管道进 ffmpeg 编码；grim 循环退出 → 管道 EOF → ffmpeg 写 trailer 收尾。
      SLEEP=$(awk "BEGIN{printf \"%.3f\", 1/$FPS}")
      FIFO="$RECORDINGS_DIR/.recorder.fifo"
      rm -f "$FIFO"; mkfifo "$FIFO"
      setsid bash -c '
        export XDG_RUNTIME_DIR="'"$RUNTIME_DIR"'" WAYLAND_DISPLAY="'"$local_target"'"
        while :; do grim -t ppm - 2>>"'"$LOGFILE"'" || exit 1; sleep '"$SLEEP"'; done
      ' >"$FIFO" 2>/dev/null &
      LOOP_PID=$!
      setsid ffmpeg -hide_banner -loglevel error -f image2pipe -framerate "$FPS" -i "$FIFO" \
        -c:v "$ENCODER" -pix_fmt yuv420p -y "$OUT" </dev/null >>"$LOGFILE" 2>&1 &
      FFMPEG_PID=$!
      # 进程组尾部：fifo 写端（grim 循环）退出后 ffmpeg 读到 EOF 自然收尾写 trailer
      CHILD=$LOOP_PID
      echo "$FFMPEG_PID" > "$RECORDINGS_DIR/.recorder.ffmpeg.pid"
    fi

    echo "$CHILD" > "$PIDFILE"
    echo "$OUT" > "$OUTFILE_FILE"
    sleep 2
    if ! kill -0 "$CHILD" 2>/dev/null; then
      tail -5 "$LOGFILE" >&2 || true
      rm -f "$PIDFILE" "$OUTFILE_FILE"
      die "录制进程 2 秒内退出（详见 ${LOGFILE}；gsr 引擎多为 GPU 不受支持，grim 引擎可用 WAYLAND_DISPLAY=$local_target grim 单帧自检）。"
    fi
    echo "录制中: $OUT"
    echo "  引擎=$ENGINE 编码器=$ENCODER 目标=$local_target fps=$FPS"
    [ "$ENGINE" = "grim" ] && echo "  停止: $0 stop（SIGTERM 优雅收尾，ffmpeg 写完 trailer）"
    ;;

  stop)
    recorder_running || { echo "当前没有进行中的录制"; rm -f "$PIDFILE" "$OUTFILE_FILE"; exit 0; }
    PID=$(cat "$PIDFILE"); OUT=$(cat "$OUTFILE_FILE")
    # gsr 文档信号是 SIGINT=停止并保存；grim 循环对 TERM/INT 均可退出
    kill -INT "$PID" 2>/dev/null || true
    sleep 1
    kill -TERM "$PID" 2>/dev/null || true
    FFMPEG_PID=""
    [ -f "$RECORDINGS_DIR/.recorder.ffmpeg.pid" ] && FFMPEG_PID=$(cat "$RECORDINGS_DIR/.recorder.ffmpeg.pid")
    # 等 ffmpeg 收尾（最长 10 秒）
    for _ in $(seq 1 20); do
      { [ -z "$FFMPEG_PID" ] || ! kill -0 "$FFMPEG_PID" 2>/dev/null; } && break
      sleep 0.5
    done
    kill -KILL "$FFMPEG_PID" 2>/dev/null || true
    rm -f "$PIDFILE" "$OUTFILE_FILE" "$RECORDINGS_DIR/.recorder.ffmpeg.pid" "$RECORDINGS_DIR/.recorder.fifo"
    if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT")" -gt 0 ]; then
      DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT" 2>/dev/null || echo "?")
      echo "已停止: ${OUT}（$(numfmt --to=iec "$(stat -c%s "$OUT")" 2>/dev/null || echo "$(stat -c%s "$OUT")B")，时长 ${DUR}s）"
    else
      echo "已停止，但输出文件异常（${OUT} 不存在或为空，详见 ${LOGFILE}）" >&2
      exit 1
    fi
    ;;

  status)
    if recorder_running; then
      OUT=$(cat "$OUTFILE_FILE"); PID=$(cat "$PIDFILE")
      SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
      echo "录制中: pid=$PID 输出=$OUT 已写入=$(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B")"
    else
      echo "未在录制"
    fi
    echo "最近录像（${RECORDINGS_DIR}）:"
    ls -t "$RECORDINGS_DIR"/*.mkv 2>/dev/null | head -5 | while read -r f; do
      DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null || echo "?")
      echo "  $(basename "$f")  ${DUR}s  $(numfmt --to=iec "$(stat -c%s "$f")" 2>/dev/null)"
    done || echo "  （空）"
    ;;

  help|-h|--help) usage ;;

  *) die "未知子命令 '$SUBCMD'（可用: start/stop/status）" ;;
esac
