# 真机安装与 M0 验证手册

> 目标：在一台真实的 Linux（Arch/CachyOS 系）机器上装好 niri 会话，逐层验证 `niri-mcp` 的行为与代码假设一致。
> 全程约 40–60 分钟（不含系统安装）。按 L1→L4 逐层放行，任何一层不符先修再进下一层。

## 0. 机器选择

| 路径 | 适用 | 说明 |
|---|---|---|
| **A. 虚拟机冒烟**（推荐先走） | 快速验证 | QEMU/virt-manager 或 VMware：UEFI 启用、virtio-gpu **开启 3D 加速**、内存 ≥ 4G。装一个最小 Arch/CachyOS 即可 |
| A-ARM. Apple Silicon 虚拟机 | mac 上的功能冒烟 | **只能跑 aarch64**，CachyOS 无 ARM 镜像，走 Fedora aarch64，见下节 |
| B. 物理机/已有系统 | 正式环境 | 已在用 Arch/CachyOS 的机器直接加装 niri 会话，不动现有 DE |

全新 CachyOS 安装：官网下载 ISO → 写盘（`dd` 或 Ventoy）→ 走安装器（桌面选择任意，后面我们用自己的 niri 会话；不装 DE 也行）。

### 0.1 Apple Silicon（ARM64）虚拟机路径

macOS（Apple Silicon）上的虚拟机**只能运行 aarch64 客户机**（跑 amd64 要走 CPU 全模拟，慢到不可用）。架构现状：

| 组件 | aarch64 现状 |
|---|---|
| CachyOS | ❌ 无官方 ARM 镜像（官方计划中，等 Arch Linux ARM 上游成熟） |
| niri | ✅ Rust 原生，Fedora **官方仓库**直接 `dnf install niri` |
| xwayland-satellite | ⚠️ 不在 Fedora 官方仓库，走 COPR（见下） |
| goose | ✅ 官方发布 arm64 Linux 二进制（安装脚本声明支持 x86_64/arm64） |
| Node.js / 我们的 TS 代码 | ✅ 天然跨架构 |

**推荐流程（UTM / VMware 装 Fedora Workstation aarch64）**：

```bash
# 系统包：niri 官方仓库 + 通知/剪贴板/终端/启动器
sudo dnf install niri xdg-desktop-portal-gnome xdg-desktop-portal-gtk \
  alacritty fuzzel wl-clipboard libnotify mako nodejs npm git

# X11 兼容层（COPR，可选——不测 X11 应用可以跳过）
sudo dnf copr enable avengemedia/dms && sudo dnf install xwayland-satellite

# 之后与 x86_64 路径完全相同：注销 → 登录界面选 Niri 会话 → L1–L4 验证
```

**边界要认清**：ARM VM 只做**功能冒烟**（验证代码逻辑、MCP 链路、goose 集成）；
发行与长期支持以 **x86_64 为唯一主线**（见 architecture.md《架构支持策略》）。
原生组件（ydotool、gpu-screen-recorder、WPS 等闭源软件）在 aarch64 上的可用性
不承诺，遇到差异记录即可，不为 ARM 特判代码。

### 0.2 在 Apple Silicon 的 UTM 里安装 Fedora Workstation（分步）

前置：从 [mac.getutm.app](https://mac.getutm.app) 装 UTM（免费）；Mac 磁盘留 ~40G。

1. **下载镜像**：[fedoraproject.org/workstation/download](https://fedoraproject.org/workstation/download)
   选 **aarch64（Apple Silicon）** 的 Live ISO。当前稳定版 F44（F45 正式版 10/20 发布，发布后直接换新版）。
   ⚠️ 必须是 aarch64——下成 x86_64 会无法启动或慢到不可用。
2. **建虚拟机**：UTM → 新建 → **Virtualize**（不要选 Emulate，那是跨架构模拟）→ Linux：
   - ISO 选刚下载的 aarch64 Live ISO；
   - 内存 ≥ 4G（建议 8G）、CPU ≥ 4、磁盘 ≥ 32G；
   - 显示保持默认 VirtIO GPU。
3. **装系统**：启动进 Live 桌面 → "Install to Hard Drive"（Anaconda）：
   语言/键盘 → Installation Destination 选整块虚拟盘 → 设用户密码 → 开始安装。
   装完在 UTM 设置里**清空 CD/DVD 的 ISO** 再重启，否则又进 Live。
4. **首次进入 GNOME 后**：
   ```bash
   sudo dnf upgrade -y && sudo systemctl reboot   # 先把内核更到最新再干活
   sudo dnf install -y spice-vdagent             # UTM 剪贴板共享，装完注销重登生效
   ```
5. **把仓库弄进 VM**（三选一）：
   - 有 GitHub 远端：VM 里直接 `git clone`；
   - rsync：VM 里 `sudo systemctl enable --now sshd`；UTM 虚拟机设置 → Network →
     加一条 Port Forward（Host 2222 → Guest 22），然后 Mac 上：
     ```bash
     rsync -av -e "ssh -p 2222" --exclude node_modules --exclude dist \
       ~/codespace/AgentOS/ <vm用户>@localhost:~/AgentOS/
     ```
     （把网络模式改成 Bridged 的话，用 `ip addr` 查 VM IP 直接连 22 端口也行）
   - 临时 HTTP：Mac 上 `cd ~/codespace/AgentOS && python3 -m http.server 8000`，
     VM 里 `wget` 拉一份（或浏览器下载后解压）。
6. **跑安装器**（走 install.sh 的 dnf 分支）：
   ```bash
   cd ~/AgentOS && ./os/install.sh --with-goose
   ```
7. **进 niri 会话**：niri 包自带 wayland-session 文件。先加通知守护进程自启，然后注销，
   GDM 登录界面右下角齿轮选 **Niri**，登录：
   ```bash
   mkdir -p ~/.config/niri
   echo 'spawn-at-startup "mako"' >> ~/.config/niri/config.kdl
   ```
   （niri 没有配置文件也能跑，这行只为拉起 mako）
8. 之后从 §3 的 L1 开始逐层验证。



## 1. 安装 niri 会话与依赖

```bash
# 基础会话（Arch/CachyOS 官方仓库；来自 niri 官方文档的快速开始）
# wl-clipboard=wl-copy/wl-paste  libnotify=notify-send  mako=通知守护进程
sudo pacman -Syu niri xwayland-satellite \
  xdg-desktop-portal-gnome xdg-desktop-portal-gtk \
  alacritty fuzzel wl-clipboard libnotify mako

# 开发依赖
sudo pacman -S nodejs npm git
node --version   # 确认 ≥ 20（Arch 源里的 nodejs 远超此版本）

# 可选：Noctalia 桌面 shell（视觉体验，验证不是必需）
# 安装方式见 github.com/noctalia-dev/noctalia
```

> mako（通知守护进程）需要在 niri 启动时拉起：`~/.config/niri/config.kdl` 里加
> `spawn-at-startup "mako"`。desktop-mcp 的通知工具依赖它。

启动会话：注销 → TTY 登录 → 运行 `niri-session`（systemd 系统；其他 init 用 `niri --session`）。
若用登录管理器（greetd/SDDM/GDM），选择 Niri 会话即可。

会话内基础键位（官方默认）：`Mod+T` 打开终端（alacritty）、`Mod+D` 启动器（fuzzel）、`Mod+Shift+E` 退出 niri。

> 安全提示（官方文档警告）：从 TTY 直接启动时，niri 退出/崩溃会落在**未锁定的 shell**，正式使用建议配登录管理器。

## 2. 获取本仓库

```bash
# 方式一：GitHub（先把本仓库 push 上去）
git clone <你的仓库地址> ~/AgentOS

# 方式二：从开发机直接同步（无需远端）
# 在 macOS 开发机上执行：
rsync -av --exclude node_modules --exclude dist \
  /Users/demon/codespace/AgentOS/ <user>@<linux机>:~/AgentOS/
```

```bash
cd ~/AgentOS
npm install
npm run build
npm test    # 预期 14 例全绿（不依赖 niri，回归确认）
```

## 3. L1 — 手测 `niri msg`，核对命令签名

在 **niri 会话内**的终端执行（SSH 进来的会话没有 `NIRI_SOCKET`，见排错表）：

```bash
echo $NIRI_SOCKET                      # 应输出一个 socket 路径
niri msg --json windows | head -c 500  # JSON 数组：id/title/app_id/is_focused...
niri msg --json workspaces             # idx/is_active/output_id...
niri msg --json outputs                # 名称/分辨率/逻辑位置...

# 动作类（对照 niri-mcp 的封装）：
niri msg action spawn -- alacritty     # 开一个新终端窗口
niri msg --json windows                # 找到新窗口的 id，下面用 <ID> 代替
niri msg action move-window-to-workspace --id <ID> 2   # 移到工作区 2（不应抢走你的焦点）
niri msg action focus-window --id <ID>                # 前台聚焦
niri msg action focus-workspace 1                     # 回工作区 1
niri msg action close-window --id <ID>                # 关闭
```

核对点：

- `--json` 位于子命令**之前**（我们已按此封装并修过一版）；
- 工作区引用语法：数字索引已确认可用；**名称引用**的写法以
  `niri msg action focus-workspace --help` 的输出为准，与
  `src/niri.ts` 中 `workspaceRef` 的描述不符就改描述；
- `move-window-to-workspace` 默认"焦点跟随移动的窗口"——若要不抢焦点，
  查 `--help` 是否有不带 focus 的选项，需要则升级封装。

任何一条签名与 `packages/niri-mcp/src/niri.ts` 不符 → 修代码 + 测试，`npm test` 保持全绿。

## 4. L2 — MCP server 直连验证（不经 goose）

仍在 niri 会话内的终端：

```bash
cd ~/AgentOS
npx @modelcontextprotocol/inspector node packages/niri-mcp/dist/index.js
```

浏览器打开 inspector，逐个调用 8 个工具：

| 工具 | 预期 |
|---|---|
| `list_windows` / `list_workspaces` / `list_outputs` | 返回 JSON，字段与 L1 手测一致 |
| `open_app` `["alacritty"]` | 屏幕上真的开出终端 |
| `move_window_to_workspace` | 窗口移动、**你当前的输入焦点不被抢** |
| `focus_window` / `focus_workspace` | 视角切换到目标 |
| `close_window` | 目标窗口关闭 |
| 缺参调用（如 `focus_window` 不传 id） | 返回 `isError` 结果，错误信息可读 |

## 5. L3 — goose 端到端

```bash
# 安装 goose（仓库已迁至 aaif-goose/goose）
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash

goose configure   # 先配模型 provider（API key 或现有订阅）
# 挂载 niri-mcp：见 docs/goose-integration.md
goose session
```

对话验收清单（对应 M0 退出标准）：

```
> 列出当前所有窗口                 → 应调用 list_windows 并总结
> 打开 firefox                     → open_app，窗口出现
> 把 firefox 移到第 2 个工作区      → 移动发生，你的焦点仍在原窗口（并发架构的日常可感知验证）
> 切到第 2 个工作区                → 视角切换，看到 firefox
> 关掉 firefox                     → 窗口关闭
```

## 6. L4 — 回填记录

- 与预期不符的行为 → 记录到本文档末尾"实测记录"或开 issue，修复后重跑对应层；
- 通过后：更新 `docs/milestones.md` 中 M0 的完成状态，把 niri 会话安装命令沉淀进
  M5 的安装脚本素材。

## 排错表

| 现象 | 原因与处理 |
|---|---|
| `echo $NIRI_SOCKET` 为空 | 不在 niri 会话内（SSH/TTY 另一会话）。在 niri 内的终端跑；或手动 `export NIRI_SOCKET=$(ls /run/user/$(id -u)/niri.*.socket | head -1)` |
| `无法启动 niri`（isError） | PATH 里没有 niri，用 `NIRI_MSG_BIN=/usr/bin/niri` 指定绝对路径 |
| VM 里 niri 黑屏/崩溃 | 虚拟显卡未开 3D 加速：virtio-gpu + `virtio=gl`（virt-manager 勾选 3D），VMware 开 3D 加速 |
| UTM 里 niri 动画略钝 | aarch64 VM 走 llvmpipe 软渲染，窗口操作可用即可，验证不依赖 GPU 性能；要真 3D 加速换 Parallels/Fusion 或 x86_64 真机 |
| 装错 x86_64 ISO | 重下 aarch64 镜像（文件名含 `aarch64`）；Apple Silicon 上 x86_64 只能全模拟，不可用 |
| UTM 剪贴板不通 | VM 里 `sudo dnf install spice-vdagent` 后注销重登 |
| GDM 会话列表没有 Niri | 确认 niri 已装：`ls /usr/share/wayland-sessions/` 应有 niri.desktop |
| `niri msg action ...` 参数错 | niri 版本差异，以 `niri msg action <名字> --help` 为准，回修 `src/niri.ts` |
| npm install 慢/失败 | 换镜像：`npm config set registry https://registry.npmmirror.com`（国内环境） |

## 实测记录

- 2026-10-13 文档定稿；官方文档核对：`--json` 在子命令前、`niri-session` 启动方式、`NIRI_SOCKET` 语义均已确认，待真机回填。
- 2026-10-13 新增 Apple Silicon（aarch64）路径：CachyOS 无 ARM 镜像（官方确认），冒烟走 Fedora aarch64 + niri 官方包 + COPR 的 xwayland-satellite；goose 官方支持 arm64。
- 2026-10-13 新增 §0.2 UTM 安装 Fedora Workstation 分步指南（Workstation aarch64 Live ISO 自 F35 起官方提供）；待今晚实测回填。
