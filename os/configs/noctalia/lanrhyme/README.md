# lanrhyme/ —— LanRhyme 观感移植素材

对齐 [LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles) 截图观感的配色文件，
由 `scripts/apply-lanrhyme-theme.sh` 应用。

| 文件 | 说明 |
|---|---|
| `colors.json` | 莫兰迪色板（72 键 Material 色板，源色 `#eee6ba`，LanRhyme 用其 `morandi-gen.py` 从壁纸 kita.png 生成后手工收敛） |

## 机制要点（v4.7.1 实测）

1. **colors.json 是输出缓存，不是自由输入**：启动时若
   `colorSchemes.useWallpaperColors=false` 且预设主题非空，ColorSchemeService
   会 `applyScheme()` 用预设调色板**覆写** colors.json。要让自定义色板生效，
   必须 `useWallpaperColors=true` 跳过该分支（LanRhyme 正是这么配的）。
2. **壁纸选择持久化在 `~/.cache/noctalia/wallpapers.json`**
   （`WallpaperService` 的 FileView 缓存），不在 settings.json；格式
   `{"wallpapers": {"<屏幕名>": "<绝对路径>"}}`。
3. 垂直栏要点：`bar.position=left` + 时钟组件的 `formatVertical`（默认已带
   `HH mm - dd MM`）；托盘必须 `drawerEnabled=true` 折叠，否则垂直栏溢出。

## 未移植部分（与上游差异）

- **毛玻璃/音频频谱**：Noctalia 依赖 quickshell 0.3 的 `BackgroundEffect`
  （走 `ext-background-effect-v1` 协议）。niri 26.04 已支持该协议，但 Fedora F44
  的 quickshell 0.2.1 无此类型——正是补丁 0001/0004 砍掉的两项。升级路径：
  `dnf copr enable errornointernet/quickshell`（有 fedora-44-aarch64 的 0.3.2
  构建）+ 撤补丁或直升 Noctalia v5。
- **morandi-gen.py 动态再生成**：LanRhyme 的 `wallpaper_changed` hook 换壁纸时
  重生成全套配色（niri/starship/alacritty/fcitx5 等 16 个目标）。依赖 noctalia
  CLI（v4.7.1 无）与 matugen，待升级 quickshell/noctalia 后一并评估。
- **壁纸本体**：个人收藏插画（版权属原作者），不入仓库；脚本从其仓库按需下载。
