#!/usr/bin/env bash
# AgentOS 开发环境一键安装（M0/M1 真机验证用；M5 发行物的前身）
#
# 用法:
#   ./os/install.sh                 # 装系统包 + 构建 + 测试
#   ./os/install.sh --skip-packages # 跳过系统包（已手动装好或无 sudo）
#   ./os/install.sh --with-goose    # 顺带安装 goose CLI
#
# 支持的包管理器: pacman (Arch/CachyOS, x86_64 主线) / dnf (Fedora, aarch64 冒烟路径)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_PACKAGES=0
WITH_GOOSE=0
for arg in "$@"; do
  case "$arg" in
    --skip-packages) SKIP_PACKAGES=1 ;;
    --with-goose) WITH_GOOSE=1 ;;
      *)
      echo "未知参数: ${arg}（支持 --skip-packages / --with-goose）"
      exit 1
      ;;
  esac
done

ARCH="$(uname -m)"
echo "== AgentOS 安装器 =="
# 注意：bash 会把紧跟变量的多字节字符当作变量名一部分，必须用 ${ARCH} 花括号
case "$ARCH" in
  x86_64)  echo "架构: x86_64（Tier 1 主线支持）" ;;
  aarch64) echo "架构: aarch64（Tier 2 冒烟路径；主线目标为 x86_64）" ;;
  arm64)   echo "架构: arm64（当前系统=$(uname -s)；Linux 目标机上应为 aarch64 冒烟路径）" ;;
  *)       echo "警告: 未适配的架构 ${ARCH}，继续但可能失败" ;;
esac

# 1) 系统包
if [[ $SKIP_PACKAGES -eq 1 ]]; then
  echo "== 跳过系统包安装（--skip-packages）=="
elif command -v pacman >/dev/null 2>&1; then
  echo "== 安装系统包（pacman）=="
  # ghostty 在 Arch 官方 extra 仓库（与 alacritty 并存：后者保留为回退终端）
  sudo pacman -Sy --needed niri xwayland-satellite \
    xdg-desktop-portal-gnome xdg-desktop-portal-gtk \
    ghostty alacritty fuzzel wl-clipboard libnotify mako \
    libreoffice-fresh \
    nodejs npm git
elif command -v dnf >/dev/null 2>&1; then
  echo "== 安装系统包（dnf）=="
  # alacritty 保留为回退终端（bootc 镜像线仍用它，见 os/bootc/）
  sudo dnf install -y niri xdg-desktop-portal-gnome xdg-desktop-portal-gtk \
    alacritty fuzzel wl-clipboard libnotify mako libreoffice-writer nodejs npm git
  # ghostty 不在 Fedora 官方仓库（截至 2026-10 官方打包仍未落地），
  # 走 COPR（scottames/ghostty 提供 fc44 aarch64/x86_64，自带依赖 gtk4-layer-shell；
  # 论证与替代源对比见 docs/ghostty.md）。默认终端切换的实证版本为 1.3.1。
  if ! command -v ghostty >/dev/null 2>&1; then
    sudo dnf install -y dnf-plugins-core
    sudo dnf copr enable -y scottames/ghostty
    sudo dnf install -y ghostty
  fi
  echo "提示: xwayland-satellite 不在 Fedora 官方仓库，如需 X11 应用支持："
  echo "  sudo dnf copr enable avengemedia/dms && sudo dnf install xwayland-satellite"
else
  echo "错误: 未识别的包管理器（支持 pacman/dnf）。"
  echo "手动安装等价包后用 --skip-packages 重试，清单见 docs/real-machine.md。"
  exit 1
fi

# 2) Node 版本检查
NODE_MAJOR="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || true)"
if [[ "${NODE_MAJOR:-0}" -lt 20 ]]; then
  echo "错误: 需要 Node.js >= 20（当前: $(node --version 2>/dev/null || echo 未安装)）"
  exit 1
fi

# 3) 构建 + 测试
cd "$REPO_ROOT"
echo "== npm install / build / test =="
npm install
npm run build
npm test

# 4) goose CLI（可选）
if [[ $WITH_GOOSE -eq 1 ]]; then
  echo "== 安装 goose CLI =="
  curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
fi

cat <<'EOF'

== 安装完成 ==
下一步（详见 docs/real-machine.md）:
  1. 注销，在登录界面选 Niri 会话（或 TTY 直接运行 niri-session）
  2. ~/.config/niri/config.kdl 加一行: spawn-at-startup "mako"   # 通知守护进程
  3. 按 docs/goose-integration.md 把 niri-mcp / desktop-mcp 挂给 goose
  4. 逐层走 L1 → L4 验证
EOF
