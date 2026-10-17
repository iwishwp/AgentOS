# 键盘与快捷键指南

AgentOS 会话（niri）的键位方案借鉴 Omarchy，**用到哪些功能就抄哪些键位**。
配置模板：`os/configs/niri/config.kdl`（部署到 `~/.config/niri/config.kdl`）。
设计调研与逐键取舍理由见 [omarchy-keybindings-research.md](omarchy-keybindings-research.md)。

## 1. Super 键：三个系统对照

niri 配置里的 `Super`（及 `Mod`，在 TTY 会话中 Mod 即 Super）物理上是哪个键：

| 系统 | Super 对应的物理键 | Alt 对应 | 备注 |
|---|---|---|---|
| **Linux（AgentOS 目标环境）** | 键盘上的 **Win 键**（ ⊞ ） | Alt | PC 键盘天然匹配，最终用户即此形态 |
| **Windows**（对照参考） | Win 键（ ⊞ ） | Alt | 与 Linux 一致 |
| **macOS + VMware Fusion**（开发测试机） | **⌘ Command**（经 Fusion 映射进虚拟机） | **⌥ Option = Alt** | Fusion 默认把 ⌘ 作为 Super/Win 发给 guest；⌥ 即 Alt；⌃ 即 Ctrl |

即：**在 Mac 上测试时，本文所有 Super+X 都读作 ⌘+X，Alt+X 读作 ⌥+X**。

## 2. AgentOS 快捷键总表

（出处列：✅ = Omarchy 键位原样采纳；🔧 = Omarchy 键位但换了实现；➖ = 保留 niri 默认）

### 启动应用

| 功能 | 键位 | niri 动作 | Omarchy 出处 |
|---|---|---|---|
| 终端（ghostty） | `Super+Return` | spawn ghostty | ✅ Super+Return（Terminal）；默认终端自 alacritty 切换为 ghostty（调研见 [ghostty.md](ghostty.md)），alacritty 保留为回退 |
| 终端（别名） | `Mod+T`（Mac：⌘T） | 同上 | ➖ niri 默认；Omarchy 中 Super+T 另有他用（见 §4） |
| 启动器（fuzzel） | `Super+Space` | spawn fuzzel | 🔧 Super+Space（Omarchy menu → fuzzel） |
| 启动器（别名） | `Mod+D` | 同上 | ➖ niri 默认 |
| 浏览器（firefox） | `Super+Shift+Return` | spawn firefox | ✅ Super+Shift+Return（Browser） |

### 窗口

| 功能 | 键位 | niri 动作 | Omarchy 出处 |
|---|---|---|---|
| 关闭窗口 | `Super+W` | close-window | ✅ Super+W（Close window） |
| 关闭窗口（别名） | `Mod+Q`（=Super+Q） | 同上 | ✅/➖ 两家同键同义 |
| 关闭窗口（别名） | `Alt+F4` | 同上 | ➖ 通用惯例 |
| 全屏 | `Super+F` | fullscreen-window | ✅ Super+F（动作取 niri 真全屏） |
| 平铺全屏（留边距撑满） | `Super+Ctrl+F` | maximize-column | ✅ Super+Ctrl+F（Tiled full screen） |

### 工作区

| 功能 | 键位 | niri 动作 | Omarchy 出处 |
|---|---|---|---|
| 切到工作区 1-9 | `Super+1` … `Super+9` | focus-workspace N | ✅/➖ 两家一致 |
| 下一个工作区 | `Super+Tab` | focus-workspace-down | ✅ Super+Tab（Next workspace） |
| 上一个工作区 | `Super+Shift+Tab` | focus-workspace-up | ✅ Super+Shift+Tab（Previous workspace） |
| 回上一个用过的工作区 | `Super+Ctrl+Tab` | focus-workspace-previous | ✅ Super+Ctrl+Tab（Former workspace） |
| 工作区纵向切换（别名） | `Mod+U` / `Mod+I` | focus-workspace-down/up | ➖ niri 默认 |
| 把窗口移到工作区 1-9 | `Super+Shift+1` … `Super+Shift+9` | move-column-to-workspace N | ✅ Super+Shift+N（Move window） |
| 移动窗口（别名） | `Mod+Ctrl+1` … `Mod+Ctrl+9` | 同上 | ➖ niri 默认 |

### 系统功能

| 功能 | 键位 | niri 动作 | Omarchy 出处 |
|---|---|---|---|
| 总览（鸟瞰所有工作区） | `Mod+O` | toggle-overview | ➖ niri 原生（Omarchy 无对应概念） |
| 截图（交互式选区 UI） | `Print`（Mac：无此键） | screenshot | ✅/➖ 两家一致 |
| 截图（Mac 主路径） | `Super+Shift+S` | screenshot | ✅ Super+Shift+S（Screenshot） |
| 整屏截图 / 窗口截图 | `Ctrl+Print` / `Alt+Print` | screenshot-screen / screenshot-window | ➖ niri 默认 |
| 锁屏（swaylock） | `Super+Ctrl+L` | spawn swaylock | ✅ Super+Ctrl+L（Lock system） |
| 锁屏（别名） | `Super+Alt+L` | 同上 | ➖ niri 官方建议键位 |
| 退出 niri（有确认对话框） | `Mod+Shift+E` / `Ctrl+Alt+Delete` | quit | ➖ niri 默认（Omarchy 的 Super+Escape 系统菜单未采纳，见 §4） |
| **键位速查页**（canvas /keys） | `Super+K` | spawn chromium-browser --app=…/keys | 🔧 Super+K（Keybindings）→ 换实现，见 §2.1 |
| 键位速查（内置浮层兜底） | `Mod+Shift+/`（即 Super+?） | show-hotkey-overlay | ➖ niri 默认 |

> 截图默认保存到 `~/Pictures/Screenshots/` 并同时进入剪贴板（`screenshot-path` 可改）。
> 锁屏需要安装 swaylock：`sudo dnf install swaylock`（Arch 系：`sudo pacman -S swaylock`）。

### 2.1 键位速查（Super+K：系统浮层 + agent 网页版）

`Super+K` 弹出 **layer-shell 浮层**（`qs -c agentos-hotkeys`，Omarchy/niri 原生心智：
居中面板、压暗背景、一行一条，Esc/点按即关，进程即起即退无常驻）：

- **不是应用窗口**——第一版用过 chromium `--app` 开 canvas 页，被否（重、像启动了
  个 app）；现改 layer-shell 覆盖层，`os/configs/hotkeys/shell.qml`（quickshell
  独立小配置，安装 `scripts/install-hotkeys.sh`）；
- **一行一条 + 超高滚动**（滚轮/PageUp/PageDown/方向键）；
- **数据零副本**：启动时解析 `~/.config/niri/config.kdl` 的 binds 段（62 条全量，
  含内联参数与滚轮键；`AGENTOS_NIRI_CONFIG` 可覆盖）；
- **配色零副本**：读 `~/.config/noctalia/colors.json`（莫兰迪），缺省降级内置同值
  （`AGENTOS_COLORS_JSON` 可覆盖）；
- 实测坑（quickshell 0.3.2）：`FileView.text` 是**同步读方法**且需 `blockLoading:
  true`；面板尺寸绑 `screen.width/height` 而非 `parent`（创建瞬间 contentItem 未
  定型，负宽度直接不渲染）。

**agent 可呈现的网页版仍在**：canvas `/keys`（`packages/canvas`，过滤框/分组吸顶，
供 desktop.open 给用户演示或在无桌面上下文查看）；`Mod+Shift+Slash` 保留 niri
内置 overlay 作兜底。三层分工：浮层（人）→ 网页（agent 演示）→ 内置（兜底）。


## 3. Mac + VMware Fusion 用户注意事项

Fusion 里 ⌘ 会被当作 Super 发进虚拟机，但 **macOS 自己先截获一部分 ⌘ 组合**，
被截获的到不了 VM。按症状对号入座：

1. **⌘ 组合被 macOS 抢走（如 ⌘Tab 切的是 Mac 应用、⌘Space 弹 Spotlight）**
   - 关闭"Mac 主机键盘快捷键"：**VMware Fusion → 设置（Settings）→
     Keyboard & Mouse → Mac Host Shortcuts → 取消勾选
     "Enable Mac OS Host Keyboard Shortcuts"**。取消后所有按键（含 ⌘ 系）
     全部进虚拟机。（[官方文档](https://techdocs.broadcom.com/us/en/vmware-cis/desktop-hypervisors/fusion-pro/13-0/using-vmware-fusion/configuring-vmware-fusion/setting-fusion-preferences/enable-or-disable-mac-os-shortcuts-on-the-keyboard-and-mouse-preference-pane.html)，旧版菜单位置略有差异）
   - 仍抢不到的，是 macOS 系统级快捷键，需在 Mac 侧改：
     **系统设置 → 键盘 → 键盘快捷键（Keyboard Shortcuts）→ 聚焦 Spotlight /
     输入法**，把 Spotlight 的 ⌘Space 改键或禁用——否则 `Super+Space`（启动器）
     在非全屏时会被 Spotlight 吃掉。
2. **"发送到虚拟机"最省心的形态：全屏独占**
   - Fusion **全屏视图**会抓取全部键盘输入，⌘Tab/⌘Space 都直接进 VM，
     直到按 `⌃⌘`（Ctrl+Command）把输入释放回 Mac。
   - 不想全屏时，就按第 1 条关掉 Mac Host Shortcuts。
3. **Mac 键盘没有 Print 键**：截图用 `Super+Shift+S`（⌘⇧S）——
   这也是我们从 Omarchy 抄这组键的原因。
4. **⌥=Alt**：`Alt+F4`（关窗口）在 Mac 键盘上是 `⌥F4`（若 F4 映射为系统功能键，
   还需按住 fn，即 `fn ⌥ F4`；或在 系统设置 → 键盘 里把 F1-F12 设为标准功能键）。
5. **VMware Tools 是前提**：⌘→Super 的映射与自适应分辨率、剪贴板共享都依赖
   `open-vm-tools-desktop`（见 real-machine.md §0.2 第 4 步）。

## 4. 已知冲突与取舍说明

| 冲突点 | 取舍 |
|---|---|
| **终端键：Super+T 还是 Super+Return？** | 两绑并存、主推 **Super+Return**（Omarchy 原样）。不开 Super+T 终端：① Omarchy 里 Super+T 是"平铺/浮动切换"，照抄会心智错位；② Mac 的 ⌘T=新标签页肌肉记忆，误按会连开终端；③ 客座机内浏览器开标签是 **Ctrl**+T，与 Super+T 是不同修饰键，无真冲突——冲突只在肌肉记忆层。Mod+T 保留是沿用 niri 默认与我们既有文档 |
| **Super+W vs macOS ⌘W（关标签页）** | 语义同向（都是"关"），采纳 Omarchy。代价：niri 默认在 Mod+W 上的"标签页显示"被顶掉（不在子集内） |
| **Super+Space vs macOS Spotlight/输入法** | 键位照抄 Omarchy，但 macOS 会在宿主层截获 ⌘Space——必须按 §3.1 改 Mac 设置，或退回 `Mod+D` 别名 |
| **Super+Tab vs macOS ⌘Tab（应用切换）** | 非全屏且未关 Mac Host Shortcuts 时 ⌘Tab 到不了 VM（被 Dock 切换器吃掉）。缓解：全屏使用 / 关 Mac Host Shortcuts / 用 `Mod+U`、`Mod+I` 别名切工作区 |
| **Omarchy Super+Escape（系统菜单）** | 未采纳。niri 没有 power-off-menu 类系统菜单动作（wiki 核对），退出走 `Mod+Shift+E`（quit 自带确认）；Super+Escape 键位留给 niri 默认的"快捷键抑制逃生门" |
| **Omarchy Super+T（平铺/浮动切换）、Super+C/V/X（通用剪贴板）、scratchpad/分组/尺寸微调等** | 均未采纳——不在 AgentOS 当前功能集（agent 优先，窗口操作走 niri-mcp） |
| **键位速查：页面还是内置浮层？** | `Super+K` → canvas 页面（可滚动/可过滤/系统配色，Omarchy 心智）；`Mod+Shift+/` → niri 内置 overlay 兜底（canvas 服务挂了也有速查可用）。两层分工见 §2.1 |
| **binds 段整体替换语义** | niri 的 binds 段写出来就**替换全部默认键位**（不合并）。模板因此自带完整键位表，并垫底保留了方向键焦点移动；要更多默认键位从 niri 官方 default-config.kdl 拷 |
| **锁屏依赖 swaylock** | 模板只绑键位；swaylock 未装时按键无效。安装命令见 §2 表尾注 |
| **语法验证状态** | 2026-10-17 已在真机 niri 26.04（FC44 aarch64 VM）原样 `niri validate` 通过（含 aesthetics.kdl include 与 ghostty 毛玻璃规则；终端键位实测 spawn ghostty 正常开窗） |

## 5. 变更历史

- 2026-10-16 初版：随 `os/configs/niri/config.kdl` 模板一起定稿。
- 2026-10-17 Super+K 切到 canvas 键位速查页（/keys，packages/canvas keys 模块）：
  整页滚动 + 吸顶分组 + 输入过滤 + 莫兰迪系统配色，数据实时解析 niri 配置；
  Mod+Shift+/ 保留内置 overlay 作兜底。VM 实测：真实按键弹窗、滚动、过滤全通过。
