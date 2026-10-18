#!/usr/bin/env bash
# =============================================================================
# scripts/apply-lanrhyme-theme.sh —— LanRhyme 观感移植（Noctalia v4.7.1）
#
# 在已装 Noctalia（scripts/install-noctalia.sh）的 VM/真机上，把桌面观感对齐
# github.com/LanRhyme/dotfiles 的截图风格：莫兰迪配色 + 插画壁纸；栏位取顶部
# 横栏（用户偏好，LanRhyme 本人用的左侧垂直栏）。
#
# 做四件事（幂等，可重复执行）：
#   1. settings.json：bar.position=top（用户偏好顶部横栏）、scaleRatio=0.9、
#      托盘折叠、density/capsuleOpacity/Workspace 样式（与 LanRhyme 对齐；
#      时钟横排格式 formatHorizontal 默认已带）
#   2. colors.json：写入 LanRhyme 莫兰迪色板（源色 #eee6ba，由 kita.png 生成）
#      ——关键：必须同时把 colorSchemes.useWallpaperColors 置 true，
#      否则启动时 ColorSchemeService 会套预设主题并【覆写】colors.json
#      （v4.7.1 里 colors.json 是生成缓存/输出，不是自由输入）
#   3. 壁纸：下载 LanRhyme 的插画壁纸到 ~/Pictures/Wallpapers，并写入
#      ~/.cache/noctalia/wallpapers.json 指定当前壁纸（v4.7.1 的壁纸选择
#      持久化在这里，不在 settings.json）
#   4. 重启 noctalia（bracket 模式 pkill 防自匹配）
#
# 选项：--no-download  跳过壁纸下载（离线/已有时）
# 出处与对比记录见 docs/noctalia.md §LanRhyme 观感移植。
# =============================================================================
set -euo pipefail

NOCTALIA_DIR="${HOME}/.config/noctalia"
WALLPAPER_DIR="${HOME}/Pictures/Wallpapers"
LAN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/os/configs/noctalia/lanrhyme"
REPO_RAW="https://raw.githubusercontent.com/LanRhyme/dotfiles/master/dot_pictures/WallPapers"
DEFAULT_WALLPAPER="kita.png"
# 壁纸为个人收藏的二次元插画（版权属原作者），不入仓库、安装时按需下载
WALLPAPERS_ALL="kita.png green-blue-flowers.jpg frieren-butterflies.jpg mygo-train.jpg"

DOWNLOAD=1
[[ "${1:-}" == "--no-download" ]] && DOWNLOAD=0

# ---- 前置：niri 会话环境（屏幕名/截图依赖）----
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
NIRI_SOCKET="$(ls "${XDG_RUNTIME_DIR}"/niri.wayland-*.sock 2>/dev/null | head -1 || true)"
if [[ -z "$NIRI_SOCKET" ]]; then echo "错误: 找不到 niri socket（需在 niri 会话环境）"; exit 1; fi
export NIRI_SOCKET
SCREEN="$(niri msg --json outputs | python3 -c 'import json,sys; print(list(json.load(sys.stdin))[0])')"
echo "屏幕: ${SCREEN}"

# ---- 1+2) settings 与配色 ----
cp "${NOCTALIA_DIR}/settings.json" "${NOCTALIA_DIR}/settings.json.bak-lanrhyme"
python3 - "${LAN_DIR}" <<'PY'
import json, sys, os
lan_dir = sys.argv[1]
p = os.path.expanduser("~/.config/noctalia/settings.json")
d = json.load(open(p))
d["bar"]["position"] = "top"
d["bar"]["density"] = "comfortable"
d["bar"]["capsuleOpacity"] = 0.16
d["general"]["scaleRatio"] = 0.9
# 防止启动时套预设主题覆写 colors.json（colors.json 是输出缓存）
d["colorSchemes"]["useWallpaperColors"] = True
lan_tray = {"blacklist": [], "chevronColor": "none", "colorizeIcons": False,
            "drawerEnabled": True, "hidePassive": False, "id": "Tray", "pinned": []}
lan_ws = {"characterCount": 2, "colorizeIcons": False, "emptyColor": "secondary",
          "enableScrollWheel": True, "focusedColor": "primary", "followFocusedScreen": False,
          "fontWeight": "bold", "groupedBorderOpacity": 1, "hideUnoccupied": False,
          "iconScale": 0.8, "id": "Workspace", "labelMode": "index",
          "occupiedColor": "secondary", "pillSize": 0.6, "showApplications": False,
          "showApplicationsHover": False, "showBadge": True,
          "showLabelsOnlyWhenOccupied": True, "unfocusedIconsOpacity": 1}
w = d["bar"]["widgets"]
w["center"] = [lan_ws if x.get("id") == "Workspace" else x for x in w["center"]]
# 托盘折叠（图标多时不溢出）；VM 无电池，去掉 Battery
w["right"] = [lan_tray if x.get("id") == "Tray" else x
              for x in w["right"] if x.get("id") != "Battery"]
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
print("settings.json: position=top density=comfortable useWallpaperColors=true")
PY

cp "${LAN_DIR}/colors.json" "${NOCTALIA_DIR}/lanrhyme-palette.json"   # 规范源（蛇形 Material 键）
cp "${LAN_DIR}/colors.json" "${NOCTALIA_DIR}/colors.json"
# 状态栏真正吃上色板：Noctalia v4.7.1 只认 m 驼峰键，需转换（theme-noctalia.sh）；
# 终端同源莫兰迪（theme-ghostty.sh）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/theme-noctalia.sh" || true
bash "${SCRIPT_DIR}/theme-ghostty.sh" || true
echo "colors.json: $(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/noctalia/colors.json')))['source_color'])")"

# ---- 3) 壁纸 ----
mkdir -p "${WALLPAPER_DIR}"
if [[ "$DOWNLOAD" == 1 ]]; then
  for f in $WALLPAPERS_ALL; do
    [[ -f "${WALLPAPER_DIR}/${f}" ]] || curl -fsSL --retry 3 -o "${WALLPAPER_DIR}/${f}" "${REPO_RAW}/${f}"
  done
fi
[[ -f "${WALLPAPER_DIR}/${DEFAULT_WALLPAPER}" ]] || { echo "错误: 缺少 ${DEFAULT_WALLPAPER}"; exit 1; }
python3 - "${SCREEN}" "${WALLPAPER_DIR}/${DEFAULT_WALLPAPER}" <<'PY'
import json, sys, os
screen, wp = sys.argv[1], sys.argv[2]
p = os.path.expanduser("~/.cache/noctalia/wallpapers.json")
json.dump({"wallpapers": {screen: wp}, "defaultWallpaper": "", "usedRandomWallpapers": {}},
          open(p, "w"), indent=2)
print(f"wallpapers.json: {screen} -> {os.path.basename(wp)}")
PY

# ---- 4) 重启 ----
pkill -f '[q]s -c noctalia' || true
sleep 2
export XDG_CURRENT_DESKTOP=niri XDG_SESSION_TYPE=wayland
setsid nohup qs -c noctalia > /tmp/noctalia-lanrhyme.log 2>&1 &
sleep 8
pgrep -f '[q]s -c noctalia' >/dev/null && echo "noctalia 已重启 (pid $(pgrep -f '[q]s -c noctalia' | head -1))"
echo "完成。验证: WAYLAND_DISPLAY=${WAYLAND_DISPLAY} grim /tmp/verify.png"
