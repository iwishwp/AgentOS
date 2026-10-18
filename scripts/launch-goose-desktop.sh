#!/usr/bin/env bash
# goose desktop 启动器（AgentOS 用户交互首要入口，开机自启）
#
# 职责（与 scripts/env/with-*-env.sh 同族：环境补齐后 exec 真身）：
# 1. source ~/.config/agentos/goose.env —— GLM key（ANTHROPIC_API_KEY/HOST）。
#    desktop 内置的 goose 1.55 CLI 经 ACP 继承本进程环境；没有这一步，
#    desktop 里发消息会报 "Configuration value not found: ANTHROPIC_API_KEY"
#    （SSH 无 shell rc 注入，实测 2026-10-18）。
# 2. --ozone-platform=x11 —— 走 Xwayland（satellite），不走 Electron 原生 Wayland。
#    实测（2026-10-18，Electron 150 / Chrome 150 + niri 26.04）：原生 Wayland 后端
#    在 wl_registry 绑定 xdg_wm_base 之后不再发 get_xdg_surface，窗口永不映射
#    （WAYLAND_DEBUG 抓包定论，且与启动方式无关——niri spawn / ssh / systemd 均
#    复现）；--ozone-platform=x11 经 xwayland-satellite 100% 出窗。上游修复前固定
#    X11 后端，niri 对 X11 窗口一样平铺/缩放/管理。
#    注意：ELECTRON_OZONE_PLATFORM_HINT=auto 不能用——XDG_SESSION_TYPE=wayland 时
#    它会选中 wayland 后端，正好踩中上面的坑。
# 3. --force-renderer-accessibility —— Chromium 系应用必须先于启动开启无障碍树，
#    事后开无效（DEVLOG 2026-10-18 Chromium 结论）；让 atspi 桥能读 goose desktop。
# 4. --password-store=basic —— Electron safeStorage 不走 libsecret。GDM autologin
#    会话下 login keyring 永远锁着，safeStorage 默认路径会弹 gcr 解锁框并卡住
#    主窗口（实测 2026-10-18）；basic 存本地文件，密钥本就走 goose.env 注入，
#    safeStorage 里没有需要钥匙串保护的凭据。
#
# desktop 本体：/usr/lib/Goose/Goose（RPM Goose-1.55.0-1.arm64，Electron+React，
# 内置 goose CLI 1.55 于 resources/bin/，读同一份 ~/.config/goose/config.yaml，
# MCP 扩展与 CLI 会话共用）。安装与全部踩坑记录见 docs/goose-desktop.md。
set -euo pipefail

GOOSE_ENV_FILE="${HOME}/.config/agentos/goose.env"
[[ -r "$GOOSE_ENV_FILE" ]] && set -a && . "$GOOSE_ENV_FILE" && set +a

# X11 后端兜底：Xwayland-satellite 固定监听 :0（niri 会话 env 自带 DISPLAY，
# systemd/ssh 路径启动时未必有）
export DISPLAY="${DISPLAY:-:0}"

DESKTOP_BIN=/usr/lib/Goose/Goose
if [[ ! -x "$DESKTOP_BIN" ]]; then
  echo "launch-goose-desktop: $DESKTOP_BIN 不存在（RPM Goose-1.55.0-1.arm64 未安装？）" >&2
  exit 1
fi

exec "$DESKTOP_BIN" \
  --ozone-platform=x11 \
  --force-renderer-accessibility \
  --password-store=basic \
  "$@"
