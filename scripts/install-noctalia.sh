#!/usr/bin/env bash
# 安装 Noctalia（legacy-v4）为 AgentOS 的 quickshell 状态栏/桌面 shell。
#
# 在目标机（niri 会话所在 Linux）上执行；默认装上游 tag v4.7.1 + 本仓库
# os/configs/noctalia/patches/ 下的兼容补丁（适配 Fedora quickshell
# 0.2.1^git20260209），详见 docs/noctalia.md。
#
# 用法:
#   scripts/install-noctalia.sh                     # 默认 v4.7.1，走 GitHub 直连，失败给中转指引
#   scripts/install-noctalia.sh --tag v4.7.1
#   scripts/install-noctalia.sh --tarball /tmp/noctalia-v4.7.1.tar   # 用 Mac 中转导出的 git archive 包
#   scripts/install-noctalia.sh --verify            # 装完跑 12s 加载自检
#   scripts/install-noctalia.sh --no-seed           # 不预置 shell-state（保留首跑设置向导）
#
# 选项:
#   --tag <tag>        上游 tag（默认 v4.7.1；其他 tag 未必配好补丁，见 docs）
#   --tarball <file>   本地 git archive tar 包（GitHub 不可达时由 Mac 中转产出，见下）
#   --patches <dir>    补丁目录（默认 <仓库>/os/configs/noctalia/patches）
#   --dest <dir>       安装目录（默认 ~/.config/quickshell/noctalia）
#   --verify           安装后 timeout 12 qs -c noctalia 自检（0 ERROR 为通过）
#   --no-seed          不写 ~/.cache/noctalia/shell-state.json（默认写入以跳过首跑向导）
#
# GitHub 不可达时的 Mac 中转流程（在 Mac 上执行，tar 保留文件名大小写，
# 切勿在 Mac 上解压再拷贝——大小写不敏感文件系统会折叠 Shell.qml/shell.qml）:
#   git clone --branch legacy-v4 https://github.com/noctalia-dev/noctalia /tmp/noctalia-src
#   git -C /tmp/noctalia-src archive v4.7.1 -o /tmp/noctalia-v4.7.1.tar
#   scp /tmp/noctalia-v4.7.1.tar <目标机>:/tmp/
#   ssh <目标机> 'AgentOS 仓库/scripts/install-noctalia.sh --tarball /tmp/noctalia-v4.7.1.tar --verify'
set -euo pipefail

TAG="v4.7.1"
TARBALL=""
DEST="$HOME/.config/quickshell/noctalia"
SEED=1
VERIFY=0

# 补丁目录：脚本在仓库内 scripts/ 下，向上找 os/configs/noctalia/patches
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/../os/configs/noctalia/patches"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?--tag 需要参数}"; shift 2 ;;
    --tarball) TARBALL="${2:?--tarball 需要参数}"; shift 2 ;;
    --patches) PATCH_DIR="${2:?--patches 需要参数}"; shift 2 ;;
    --dest) DEST="${2:?--dest 需要参数}"; shift 2 ;;
    --verify) VERIFY=1; shift ;;
    --no-seed) SEED=0; shift ;;
    -h|--help) grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,2\}//'; exit 0 ;;
    *) echo "未知参数: $1（--help 看用法）" >&2; exit 64 ;;
  esac
done

[[ "$TAG" == v4.7.1 ]] || echo "警告: 补丁集针对 v4.7.1 制作，--tag $TAG 可能无法干净应用" >&2
command -v qs >/dev/null || { echo "错误: 未安装 quickshell（qs）" >&2; exit 1; }
shopt -s nullglob
if [[ -d "$PATCH_DIR" ]] && compgen -G "$PATCH_DIR/[0-9]*.patch" >/dev/null; then :; else
  echo "错误: 补丁目录不存在或无编号补丁: $PATCH_DIR" >&2; exit 1
fi

WORK="$(mktemp -d /tmp/noctalia-install.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/src"; mkdir -p "$SRC"

# ---- 1) 取源码：本地 tar 包 > GitHub 直连 > 中转指引 ----
if [[ -n "$TARBALL" ]]; then
  [[ -f "$TARBALL" ]] || { echo "错误: tar 包不存在: $TARBALL" >&2; exit 1; }
  tar -xf "$TARBALL" -C "$SRC"
elif command -v git >/dev/null && timeout 8 git ls-remote --tags https://github.com/noctalia-dev/noctalia "$TAG" >/dev/null 2>&1 \
   && [[ -n "$(timeout 8 git ls-remote --tags https://github.com/noctalia-dev/noctalia "$TAG" 2>/dev/null)" ]]; then
  # GitHub 可达：浅克隆后用 git archive 导出（保持大小写、去掉 .git）
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/noctalia-dev/noctalia "$WORK/repo"
  git -C "$WORK/repo" archive HEAD | tar -x -C "$SRC"
else
  cat >&2 <<EOF
错误: 无法直连 GitHub（本机常见于测试虚拟机）。用 Mac 中转导出 tar 包后重试：

  # Mac 上:
  git clone --branch legacy-v4 https://github.com/noctalia-dev/noctalia /tmp/noctalia-src
  git -C /tmp/noctalia-src archive $TAG -o /tmp/noctalia-$TAG.tar
  scp /tmp/noctalia-$TAG.tar $(id -un)@$(hostname 2>/dev/null || echo 目标机):/tmp/

  # 本机:
  $0 --tarball /tmp/noctalia-$TAG.tar --verify
EOF
  exit 2
fi

# 清理 Mac 中转可能带入的 AppleDouble/垃圾文件（._foo 会被配色扫描器误读报 ERROR）
find "$SRC" \( -name '._*' -o -name '.DS_Store' \) -delete

# ---- 2) 应用补丁 ----
cd "$SRC"
shopt -s nullglob
PATCHES=( "$PATCH_DIR"/[0-9]*.patch )
[[ ${#PATCHES[@]} -gt 0 ]] || { echo "错误: 补丁目录为空: $PATCH_DIR" >&2; exit 1; }
for p in "${PATCHES[@]}"; do
  git apply --check "$p" 2>/dev/null || { echo "错误: 补丁无法应用: $(basename "$p")（tag 与补丁集不匹配?）" >&2; exit 1; }
  git apply "$p"
  echo "已应用: $(basename "$p")"
done

# ---- 3) 安装到目标目录 ----
mkdir -p "$DEST"
rm -rf "$DEST"
cp -a "$SRC/." "$DEST/"
echo "已安装到: $DEST"

# ---- 4) 预置 shell-state：跳过首跑设置/telemetry 向导（无头安装需要）----
if [[ $SEED -eq 1 ]]; then
  mkdir -p "$HOME/.cache/noctalia"
  ST="$HOME/.cache/noctalia/shell-state.json"
  if [[ ! -f "$ST" ]]; then
    printf '{"changelogState": {"lastSeenVersion": "%s"}}' "${TAG#v}" > "$ST"
    echo "已预置 $ST（跳过首跑向导；想重新走向导就删掉它）"
  fi
fi

# ---- 5) 自检：12 秒加载测试，0 ERROR 即通过（超时杀掉属正常）----
if [[ $VERIFY -eq 1 ]]; then
  : "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
  : "${WAYLAND_DISPLAY:=wayland-0}"
  export XDG_RUNTIME_DIR WAYLAND_DISPLAY
  OUT="$(cd "$DEST" && timeout 12 qs -c noctalia 2>&1 || true)"
  if grep -q ERROR <<<"$OUT"; then
    echo "自检失败（存在 ERROR）:"; grep -m5 ERROR <<<"$OUT" >&2; exit 1
  fi
  echo "自检通过：12 秒加载无 ERROR。"
  echo "常驻启动（niri 会话内）:   niri msg action spawn -- qs -c noctalia"
  echo "开机自启（niri 配置）:     spawn-at-startup \"qs\" \"-c\" \"noctalia\""
fi
