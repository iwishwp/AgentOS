# Noctalia 状态栏/桌面 shell（legacy-v4 接入记录）

> 结论先行：**选定上游 tag `v4.7.1` + 4 个兼容补丁**，已在测试虚拟机（Fedora 44 aarch64，
> niri 会话，quickshell `0.2.1^git20260209`）上常驻运行并替换 waybar，成为 AgentOS 的
> 正式状态栏/桌面 shell。安装入口：`scripts/install-noctalia.sh`；补丁在
> `os/configs/noctalia/patches/`。

- 上游仓库：<https://github.com/noctalia-dev/noctalia>（`legacy-v4` 分支，v4 已停止维护）
- 选定 tag：`v4.7.1`（legacy-v4 上**不含 `Quickshell.Niri` 模块依赖**的最后一个 tag）
- 运行验证：见文末「验证记录」

## 1. 为什么是 v4.7.1（bisect 结论）

Fedora 44 官方仓的 quickshell 停在 `0.2.1^git20260209`（2026-02 快照，无更新版本、无可用
COPR），而 noctalia legacy-v4 末期（HEAD ≈ v4.7.7）依赖 `Quickshell.Niri` 模块——该模块
在这个包里不存在，且它是 niri 集成核心，无法桩掉。因此主攻路线是往回找最后一个
**不依赖 Quickshell.Niri** 的版本。

### 1.1 依赖引入时间线（对上游 tag 逐一 `git grep` 的静态扫描）

| 依赖（quickshell 侧缺失） | 首次引入的 tag | 使用文件 |
|---|---|---|
| `PwAudioSpectrum` 类型（Pipewire 频谱） | v4.7.0 | `Services/Media/SpectrumService.qml` |
| `Quickshell.DWL` 模块（MangoWC 后端） | v4.7.0 | `Services/Compositor/MangoService.qml` |
| `Quickshell.WindowManager` 模块（LabWC 后端） | v4.7.0 | `Services/Compositor/LabwcService.qml` |
| **`Quickshell.Niri` 模块（niri 核心，不可桩）** | **v4.7.2** | `Services/Compositor/NiriService.qml` |
| `BackgroundEffect` + `Region` 圆角属性（Wayland blur） | v4.6.0（3 文件） | MainScreen / LauncherOverlayWindow / Dock |
| v4.6.7 时代 `Quickshell.Niri` 已现雏形? | 否（v4.7.1 及以前均为 Socket/`niri msg` 方案） | — |

v4.7.1 的 niri 集成走 **niri IPC Socket 直连 + `niri msg` CLI**（`NiriService.qml` 内
`Socket` 连接 `$NIRI_SOCKET`、`Quickshell.execDetached(["niri","msg",...])`），不依赖
quickshell 的 Niri 模块——这正是它在 0.2.1 上能跑的根本原因。v4.7.2 起改为
`import Quickshell.Niri` 的 `Niri.*` 单例 API，就此卡死在旧 quickshell 上。

### 1.2 各 tag 实测/推断结论表

| tag | 无补丁实测结果（12s 加载测试） | 结论 |
|---|---|---|
| v4.7.7（legacy-v4 HEAD） | `Quickshell.Niri` 模块不存在（前人实测；另有 PwAudioSpectrum 缺失） | ❌ 核心链，不可修 |
| v4.7.2~v4.7.6 | 实测 v4.7.2：`Non-existent attached object`（BackgroundEffect）等；静态确认 NiriService 已用 `Quickshell.Niri` | ❌ 同上 |
| **v4.7.1** | 无补丁失败链（按修复顺序逐个暴露）：`PwAudioSpectrum` → `Quickshell.DWL 未安装` → `Quickshell.WindowManager 未安装` → `BackgroundEffect` attached object → `Region` 的 `bottomRightCorner` 属性缺失。**全部可小补丁修复** | ✅ **选定** |
| v4.7.0 | 实测卡在 BackgroundEffect（与 v4.7.1 同类失败，功能比 v4.7.1 旧） | 可修但无优势 |
| v4.6.7 | 实测卡在 BackgroundEffect（v4.6.0 引入） | 可修但无优势 |
| v4.6.0~v4.6.6 | 未实测；静态：仅 BackgroundEffect 一族（1 文件） | 可修但无优势 |
| ≤ v4.5.x | 未实测；静态：上述缺失依赖均未引入 | 理论最干净但功能旧一年 |

> 择优逻辑：v4.7.1 是「不需要 Quickshell.Niri」的最新 tag；比它新的全死在 niri 模块上，
> 比它旧的只会在同样或更少的补丁下丢更多功能。故无需对更老 tag 逐一实测。

## 2. quickshell 0.2.1 兼容矩阵

Fedora 44 `quickshell-0.2.1^git20260209` 实际携带的 QML 模块（`rpm -ql quickshell`）：

| 模块 | 状态 | noctalia v4.7.1 需求 |
|---|---|---|
| `Quickshell`（core）、`Io`、`Wayland`、`Widgets`、`X11`、`Networking`、`Hyprland`、`I3`、`Bluetooth`、`DBusMenu`、`Services.{Greetd,Mpris,Notifications,Pam,Pipewire,Polkit,SystemTray,UPower}` | ✅ 有 | 全部用到，均可满足 |
| `Quickshell.Niri` | ❌ 无 | v4.7.2+ 才需要（v4.7.1 不需要） |
| `Quickshell.DWL` | ❌ 无（未随包编译） | v4.7.0+ 的 MangoService 用 → 补丁移除 |
| `Quickshell.WindowManager` | ❌ 无 | v4.7.0+ 的 LabwcService 用 → 补丁移除 |
| `PwAudioSpectrum` 类型（Services.Pipewire 内） | ❌ 无 | v4.7.0+ 用 → 补丁桩掉 |
| `BackgroundEffect` attached property、`Region.*Corner` 属性（Wayland 模块内） | ❌ 无 | v4.6.0+ 用 → 补丁移除 |

## 3. 补丁清单（os/configs/noctalia/patches/）

均为「移除 quickshell 0.2.1 不支持的特性」方向，不改变 niri 路径行为；文件内带
`AGENTOS-PATCH(noctalia-v4.7.1/NN)` 标记。

| # | 补丁 | 内容 | 功能损失 |
|---|---|---|---|
| 0001 | SpectrumService | `PwAudioSpectrum` → 惰性 `QtObject`（values 恒空、idle 恒真） | 音频频谱视觉化静止 |
| 0002 | CompositorService | 移除 MangoWC 后端（检测分支 + 惰性组件） | 无（AgentOS 只跑 niri） |
| 0003 | CompositorService | 移除 LabWC 后端（同上） | 无（同上） |
| 0004 | MainScreen / LauncherOverlayWindow / Dock | 移除 `BackgroundEffect.blurRegion` 与配套 blur `Region` 树 | bar/launcher/dock 无毛玻璃模糊 |

## 4. 安装与验证

### 4.1 脚本安装（推荐）

```bash
# GitHub 可达时一条命令（自动浅克隆 + git archive 导出 + 打补丁 + 安装）：
scripts/install-noctalia.sh --verify

# 测试机直连 GitHub 超时（常态）→ Mac 中转：
#   Mac:  git clone --branch legacy-v4 https://github.com/noctalia-dev/noctalia /tmp/noctalia-src
#         git -C /tmp/noctalia-src archive v4.7.1 -o /tmp/noctalia-v4.7.1.tar
#         scp /tmp/noctalia-v4.7.1.tar agentos-vm:/tmp/
#   目标机: scripts/install-noctalia.sh --tarball /tmp/noctalia-v4.7.1.tar --verify
```

注意：**必须走 `git archive` 的 tar 包**，不要在 macOS 上解压后拷贝目录——大小写不敏感
文件系统会折叠 `Shell.qml`/`shell.qml` 这类文件名。脚本会顺手清理 Mac tar 带入的
`._*` AppleDouble 文件（它们会被配色扫描器误读报 ERROR）。

脚本默认写入 `~/.cache/noctalia/shell-state.json`（`lastSeenVersion: v4.7.1`）以跳过
首跑设置向导/telemetry 向导（向导面板会独占键盘，无头环境不便）；想重新体验向导删掉该
文件即可，或安装时加 `--no-seed`。

### 4.2 手动验证方法

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-1 \
       DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
cd ~/.config/quickshell/noctalia && timeout 12 qs -c noctalia 2>&1
# 进程撑过 12 秒（timeout 退出码 124）且无 ERROR = 加载成功
# 常驻拉起（niri 会话内）：
niri msg action spawn -- qs -c noctalia
# 表面检查（应有 noctalia-bar-content / -background / -wallpaper 等）：
niri msg layers
```

### 4.3 niri 开机自启

`os/configs/niri/config.kdl`（及部署机的 `~/.config/niri/config.kdl`）：

```kdl
// 状态栏/桌面 shell（Noctalia v4.7.1 + AgentOS 补丁；waybar 配置保留在 os/configs/waybar 作为回退）
spawn-at-startup "qs" "-c" "noctalia"
```

改完 `niri validate` 确认。回退方式：把这行换回 `spawn-at-startup "waybar"`（仓库 waybar
配置未删）。

## 5. 已知损失与影响面

| 损失 | 影响 | 恢复条件 |
|---|---|---|
| 频谱视觉化静止 | 锁屏/控制中心的音频可视化不動 | quickshell 带 `PwAudioSpectrum` |
| 无 blur 毛玻璃 | bar/面板/launcher 背景为纯半透明色，观感略「平」 | quickshell 带 `BackgroundEffect` |
| MangoWC/LabWC 后端移除 | 无（AgentOS 只支持 niri） | 无需恢复 |

其余功能实测正常：bar（时钟/工作区/系统监控/托盘/控制中心）、壁纸、dock peek。通知服务
一处并存要注意：**mako 先启动抢注了 `org.freedesktop.Notifications`，Noctalia 注册失败
后静默让位**（日志提示 "presumably because one is already registered"，mako 退出后会自动
重试接手）。即当前弹通知走 mako、Noctalia 的通知历史面板收不到新通知；desktop-mcp 的
通知工具依赖 mako，故 `spawn-at-startup "mako"` 暂保留。**待办（M5 前）**：二选一——去掉
mako 自启让 Noctalia 全权接管通知，或保留 mako 并接受 Noctalia 通知历史只显示历史。

## 6. 升级路径（quickshell 更新后）

当 Fedora 的 quickshell 升到含下列能力的版本时，可脱离补丁集回到上游新版：

```bash
# 能力自检（目标机执行）：
rpm -ql quickshell | grep -iE 'qml/Quickshell/(Niri|DWL|WindowManager)$'   # v4.7.2+ 必需
grep -q BackgroundEffect /usr/lib64/qt6/qml/Quickshell/Wayland/*.qmltypes  # blur 恢复
```

- 三模块齐备 → 直接装 **v4.7.7**（legacy-v4 HEAD，仍走 `Quickshell.Niri`）；
- 若届时 v5 已稳定且依赖面更宽，优先评估 v5；
- 安装仍是 `scripts/install-noctalia.sh --tag <新tag>`，但**不打本补丁集**
  （`--patches` 指向空目录，或届时更新补丁集）。注意 v4.7.7 的 `Region`/blur 等 API 与
  v4.7.1 相同，若 quickshell 仍缺 `BackgroundEffect` 则 0004 号补丁思路仍可复用。

## 7. 验证记录（2026-10-16，agentos-vm）

- `timeout 12 qs -c noctalia`：0 条 ERROR，`Configuration Loaded` + `Noctalia Hello!`；
- 常驻运行（`niri msg action spawn`）：进程稳定，`niri msg layers` 可见
  `noctalia-{wallpaper,background,bar-content,bar-exclusion-top,dock-peek,image-cache-renderer}-Virtual-1`
  共 6 个 layer 表面，无键盘独占（interactivity 全 none，首跑向导关闭后）；
- 截图确认 bar 渲染：启动器/时钟/工作区/系统监控（CPU/RAM）/托盘/控制中心齐全；
- `scripts/install-noctalia.sh --tarball ... --verify` 在目标机端到端通过（exit 0）；
- niri `spawn-at-startup` 已切 `qs -c noctalia`，`niri validate` 通过，waybar 已停用
  （配置保留于 `os/configs/waybar/`）。
