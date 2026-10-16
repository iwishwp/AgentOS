# Omarchy 默认键位调研与 AgentOS 子集设计

> 调研日期：2026-10-13～16。目的：为 AgentOS 的 niri 会话设计默认键位——
> **借鉴 Omarchy，用到哪些功能就抄哪些键位，不照单全收**。
> 用户侧速查文档见 [keyboard.md](keyboard.md)，配置模板见
> `os/configs/niri/config.kdl`。

## 0. 出处与版本

| 来源 | 内容 | 备注 |
|---|---|---|
| https://omarchy.org/manual/hotkeys/ | 官方手册《Hotkeys》 | 全量键位表（面向用户） |
| github.com/basecamp/omarchy | 仓库 | **已跳转至 github.com/omacom/omarchy**，当前默认分支 `quattro` |
| `default/hypr/bindings/{applications,tiling,utilities,clipboard}.lua` | 键位定义源码 | quattro 分支；Omarchy 新版把 Hyprland 键位收进了 Lua（`bindings.lua` 会加载该目录全部文件） |

两处来源互有出入时以**仓库源码**为准（手册个别条目滞后，如手册写
"Super+G 切换浮动"，源码里 Super+G 是"窗口分组"，浮动切换在 Super+T）。
原始配置曾经是单文件 `default/config/hypr/hyprland.conf` 的 `bind=` 行
（basecamp 时代的老版本），现拆分为 Lua；本表按 quattro 现状整理。

## 1. Omarchy 默认键位全表（按源码文件分组）

### 1.1 applications.lua —— 应用启动

| 键位 | 功能 | 说明 |
|---|---|---|
| `Super+Return` | 终端 | launch_terminal |
| `Super+Shift+Return` | 浏览器 | 同 `Super+Shift+B`，发行版默认浏览器 |
| `Super+Shift+Alt+B` | 浏览器（隐身窗口） | |
| `Super+Shift+F` | 文件管理器（nautilus） | `Super+Shift+Alt+F` 为当前目录版 |
| `Super+Shift+N` | 编辑器 | |
| `Super+Alt+Return` | Tmux | 以下为"预装应用"组 |
| `Super+Ctrl+Return` | Herdr | |
| `Super+Shift+M` / `Super+Shift+Alt+M` | 音乐（Spotify）/ 音乐 TUI | |
| `Super+Shift+D` | Docker TUI（lazydocker） | |
| `Super+Shift+G` | Signal | |
| `Super+Shift+O` | Obsidian | |
| `Super+Shift+W` | Omawrite | |
| `Super+Shift+/` | 密码（1Password） | |
| `Super+Shift+A` 等一批 | Web 应用（ChatGPT/HEY/YouTube/X…） | webapp 快捷方式 |

### 1.2 tiling.lua —— 窗口与工作区

| 键位 | 功能 | 说明 |
|---|---|---|
| `Super+W` / `Super+Q` | 关闭窗口 | 两个键同义 |
| `Ctrl+Alt+Delete` | 关闭所有窗口 | |
| `Super+T` | 窗口平铺/浮动切换 | **不是开终端** |
| `Super+F` | 全屏 | Hyprland `fullscreen` 模式 |
| `Super+Ctrl+F` | 平铺全屏（Tiled full screen） | 无边距撑满 |
| `Super+Alt+F` | 全宽（Full width） | 最大化方向 |
| `Super+J` | 切换窗口 split | |
| `Super+P` | pseudo 窗口 | |
| `Super+O` | 弹出窗口（浮动+置顶 pin） | |
| `Super+L` / `Super+Alt+L` | 循环工作区布局 / 反向 | |
| `Super+←/→/↑/↓` | 焦点移动 | |
| `Super+1…10` | 切换到工作区 1-10 | 源码按 keycode 10-19 绑定 |
| `Super+Shift+1…10` | 把窗口移到工作区 1-10 | |
| `Super+Shift+Alt+1…10` | 静默移窗口（焦点不跟随） | |
| `Super+Tab` / `Super+Shift+Tab` | 下一个 / 上一个工作区 | 相邻序号 |
| `Super+Ctrl+Tab` | 上一个使用过的工作区（Former） | 当前↔上一个来回切 |
| `Super+S` / `` Super+` `` | scratchpad 切换 | |
| `Super+Alt+S` / `Super+Shift+`` ` `` | 移窗口进 scratchpad | |
| `Super+M` | 最小化窗口到 dock | |
| `Super+Shift+←/→/↑/↓` | 交换窗口位置 | |
| `Alt+Tab` / `Alt+Shift+Tab` | 窗口间循环焦点 / 反向 | |
| `Ctrl+Alt+Tab` / `+Shift` | 显示器间切换焦点 | |
| `Super+G` 组 | 窗口分组（Hyprland group）系列 | |
| `Super+-` / `Super+=` 系列 | 窗口尺寸微调（大/中/小档） | |
| `Super+/` / `Super+Alt+/` | 显示器缩放 放大/缩小 | |
| `Super+滚轮` | 切换工作区 | |
| `Super+左键拖动 / 右键拖动` | 移动 / 调整窗口 | |

### 1.3 utilities.lua —— 系统功能

| 键位 | 功能 | 说明 |
|---|---|---|
| `Super+Space` | Omarchy 菜单 | 事实上的启动器入口 |
| `Super+Alt+Space` | 应用列表 | |
| `Super+Escape` | 系统菜单（挂起/重启/退出…） | |
| `Super+Ctrl+L` | 锁屏 | 拉起外部锁屏器 |
| `Super+Ctrl+I` | 切换空闲自动锁屏 | |
| `Super+Ctrl+N` | 夜间模式 | |
| `Super+K` / `Super+Alt+K` / `Super+Ctrl+K` | 键位速查（主/Tmux/Herdr） | |
| `Print` / `Super+Shift+S` | 截图 | 两个键同义 |
| `Alt+Print` | 录屏（开/停） | |
| `Super+Print` | 取色器 | |
| `Super+Ctrl+Print` | 截图 OCR | |
| `Super+Ctrl+C` | 捕获菜单（截图/录屏入口） | |
| `Super+Ctrl+Q` | 计算器 | |
| `Super+Ctrl+E` | 表情符号 | |
| `Super+Ctrl+D` / `Super+Ctrl+W` / `Super+Ctrl+P` 等 | 显示/网络/电源等面板 | 桌面 shell 面板 |
| `Super+,` 系列 | 通知操作（忽略/静音/历史） | |
| `Super+Backspace` 系列 | 窗口透明度/间隙/方形比例开关 | |
| `Super+Shift+Space` / `Super+Ctrl+Space` 等 | 顶栏/壁纸/主题菜单 | |

### 1.4 clipboard.lua —— 通用剪贴板（Mac 心智移植）

| 键位 | 功能 | 说明 |
|---|---|---|
| `Super+C` / `Super+V` / `Super+X` | 通用复制/粘贴/剪切 | 向应用注入 `Ctrl+C` 等；终端内自动换 `Ctrl+Shift+C` |
| `Super+A` | 全选 | 注入 `Ctrl+A` |
| `Super+Ctrl+V` | 剪贴板历史 | |

> Omarchy 键位哲学：Super 当"万能修饰键"（模仿 macOS 的 ⌘），把复制粘贴、
> 关窗口（Super+W，同 ⌘W）都收到 Super 体系里；它明确服务 Mac 转 Linux 用户。

## 2. AgentOS 子集：逐键决策

原则：**只绑定 AgentOS 实际用到的功能**——终端（alacritty）、启动器（fuzzel）、
浏览器（firefox）、关闭窗口、全屏、工作区 1-9 切换 + 上一个/下一个、
把窗口移到工作区、niri 总览、截图、锁屏（swaylock）、退出合成器。

| 功能 | AgentOS 键位 | niri 动作 | Omarchy 出处 | 是否调整 / 理由 |
|---|---|---|---|---|
| 终端 | `Super+Return` | `spawn "alacritty"` | `Super+Return` | **原样采纳** |
| 终端（别名） | `Mod+T` | `spawn "alacritty"` | 无（niri 默认） | 保留 niri 默认。**不用 Super+T 开终端**：Omarchy 里 Super+T 是平铺/浮动切换；且 Mac 的 ⌘T=新标签页肌肉记忆，误按会连开终端（在浏览器里开标签是 Ctrl+T，修饰键不同不真冲突，但肌肉记忆会打架） |
| 启动器 | `Super+Space` | `spawn "fuzzel"` | `Super+Space`（Omarchy menu） | 键位原样；菜单实现换成 fuzzel（AgentOS 不带 Omarchy shell） |
| 启动器（别名） | `Mod+D` | `spawn "fuzzel"` | 无（niri 默认） | 保留 |
| 浏览器 | `Super+Shift+Return` | `spawn "firefox"` | `Super+Shift+Return`（Browser） | 键位原样；Omarchy 按发行版默认浏览器启动，我们固定 firefox |
| 关闭窗口 | `Super+W` | `close-window` | `Super+W`（Close window） | **原样采纳**。代价：niri 默认把该键给"标签页显示"（toggle-column-tabbed-display），该功能不在子集内，让位 |
| 关闭窗口（别名） | `Mod+Q`（=Super+Q） | `close-window` | `Super+Q`（Close window） | niri 默认 Mod+Q 与 Omarchy Super+Q 在 TTY 会话上是同一物理键、同语义，两全 |
| 关闭窗口（别名） | `Alt+F4` | `close-window` | — | niri 默认保留，通用惯例 |
| 全屏 | `Super+F` | `fullscreen-window` | `Super+F`（Full screen） | 键位原样；动作换成 niri 的**真全屏** `fullscreen-window`（niri 默认该键是 `maximize-column`） |
| 平铺全屏 | `Super+Ctrl+F` | `maximize-column` | `Super+Ctrl+F`（Tiled full screen） | 键位原样；niri 的 maximize-column（留边距撑满）恰好对应"平铺全屏" |
| 工作区 1-9 | `Mod+1…9`（=Super+N） | `focus-workspace N` | `Super+N` | 两家本就一致，niri 默认拼写保留 |
| 下一/上一工作区 | `Super+Tab` / `Super+Shift+Tab` | `focus-workspace-down` / `focus-workspace-up` | `Super+Tab` / `Super+Shift+Tab` | 键位原样；niri 工作区是纵向栈，down/up 即序号前后 |
| 上一个使用的工作区 | `Super+Ctrl+Tab` | `focus-workspace-previous` | `Super+Ctrl+Tab`（Former workspace） | 键位原样；动作取 niri 官方示例（默认配置注释里建议绑 Mod+Tab；为避让 Super+Tab 我们挪到 Omarchy 的三键和弦上） |
| 纵向切工作区（别名） | `Mod+U` / `Mod+I` | `focus-workspace-down/up` | — | niri 默认保留 |
| 移窗口到工作区 | `Super+Shift+1…9` | `move-column-to-workspace N` | `Super+Shift+N`（Move window） | 键位原样；niri 单位是"列"，单窗口列即窗口本身，语义等价。Omarchy 的"静默移动"（Super+Shift+Alt+N）不在子集，未采纳 |
| 移窗口（别名） | `Mod+Ctrl+1…9` | `move-column-to-workspace N` | — | niri 默认保留 |
| niri 总览 | `Mod+O` | `toggle-overview` | 无对应 | niri 原生。**注意动作名是 `toggle-overview` 而非 `overview`**（wiki 核对） |
| 截图（交互） | `Print` | `screenshot` | `Print`（Screenshot） | 两家一致；niri 内置截图 UI（选区/窗口/整屏，入剪贴板+落盘） |
| 截图（Mac 路径） | `Super+Shift+S` | `screenshot` | `Super+Shift+S`（Screenshot） | **原样采纳**；Mac 键盘无 Print 键，此为 Mac+Fusion 主路径（Windows 截图工具心智） |
| 整屏 / 窗口截图 | `Ctrl+Print` / `Alt+Print` | `screenshot-screen` / `screenshot-window` | — | niri 默认保留 |
| 锁屏 | `Super+Ctrl+L` | `spawn "swaylock"` | `Super+Ctrl+L`（Lock system） | 原样采纳；Omarchy 同样是拉起外部锁屏器 |
| 锁屏（别名） | `Super+Alt+L` | `spawn "swaylock"` | — | niri 官方建议键位保留 |
| 退出合成器 | `Mod+Shift+E` / `Ctrl+Alt+Delete` | `quit`（自带确认对话框） | `Super+Escape`（System menu） | **Omarchy 的系统菜单未采纳**：niri 没有 power-off-menu 类动作（wiki 动作清单核对），退出语义由 quit 承担；Super+Escape 键位留给 niri 默认的"快捷键抑制逃生门" |
| 键位速查 | `Mod+Shift+/` + `Super+K` | `show-hotkey-overlay` | `Super+K`（Keybindings） | niri 默认保留 + 采纳 Omarchy 的 Super+K 心智 |
| 快捷键抑制逃生门 | `Mod+Escape` | `toggle-keyboard-shortcuts-inhibit` | — | niri 默认保留（安全网：防远程桌面类应用劫持键盘） |
| 焦点/移动窗口（方向键） | `Mod+方向键` / `Mod+Ctrl+方向键` | focus-*/move-* | — | niri 默认保留——子集之外的垫底可用性：没有它们多窗口时无法用键盘切焦点 |

**有意不采纳的 Omarchy 键位**（不在 AgentOS 当前功能集）：

- `Super+C/V/X/A` 通用剪贴板（我们的终端/浏览器各自处理剪贴板，
  wl-clipboard 已由 desktop-mcp 提供 MCP 路径）；
- scratchpad、窗口分组、pseudo/split、窗口尺寸微调、显示器切换与缩放
  （单显示器 VM + agent 优先场景用不到）；
- Omarchy 专属面板/菜单/主题/夜间模式等（依赖 Omarchy shell，我们没有移植）；
- Tmux/Herdr/Signal/Obsidian 等预装应用键（非 AgentOS 栈）。

## 3. niri 语法核对记录（写 config.kdl 的依据）

对照两份官方材料逐字核对：

1. **仓库自带默认配置** `resources/default-config.kdl`（niri-wm/niri，main 分支）：
   binds 段结构 `键位 [属性] { 动作 [参数]; }`；带参数动作
   `focus-workspace 1;` / `move-column-to-workspace 1;`；属性写法
   `repeat=false`、`allow-inhibiting=false`、`hotkey-overlay-title="…"`；
   顶层 `spawn-at-startup "…"`、`screenshot-path "…"`。
2. **wiki《Configuration: Key Bindings》**
   （https://niri-wm.github.io/niri/Configuration:-Key-Bindings）：
   修饰符合法值（Ctrl/Shift/Alt/Super/Win/Mod…）；**Mod 在 TTY 会话等于
   Super、嵌套 winit 窗口等于 Alt**；绑定键名用 XKB 名（Return/Tab/Print/
   Escape/Slash/Space/方向键首字母大写）。
3. 用到的每个动作名都在默认配置或 wiki 正文出现过：
   `spawn`、`close-window`、`fullscreen-window`、`maximize-column`、
   `focus-workspace N`、`focus-workspace-down/up`、`focus-workspace-previous`、
   `move-column-to-workspace N`、`toggle-overview`、`screenshot`、
   `screenshot-screen`、`screenshot-window`、`quit`、`show-hotkey-overlay`、
   `toggle-keyboard-shortcuts-inhibit`、`focus-column-left/right`、
   `focus-window-up/down`、`move-column-left/right`、`move-window-up/down`。
4. wiki 关键语义提醒：**binds 段不与默认值合并——写了就是全量替换**，
   所以模板自带完整键位表（含焦点移动垫底项）。

已知事实纠偏（相对任务书里的猜测）：

- 总览动作名是 `toggle-overview`，不是 `overview`；
- niri **没有** `power-off-menu` 动作（wiki Actions 一节与默认配置均无），
   退出用 `quit`（默认弹确认框）。

**待办**：macOS 上无法运行 niri，模板尚未过 `niri validate`；VM（Fedora 44
aarch64，niri 26.04）下次联机时验证：
`niri validate -c os/configs/niri/config.kdl`（或部署到 `~/.config/niri/config.kdl`
后重载 `niri msg action load-config-file`）。

## 4. 变更历史

- 2026-10-16 初版：Omarchy 手册 + quattro 分支源码调研，AgentOS 子集定稿。
