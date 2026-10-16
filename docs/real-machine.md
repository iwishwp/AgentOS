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

### 0.2 在 Apple Silicon 虚拟机里安装 Fedora Workstation（分步）

适用于 UTM 与 VMware Fusion。前置：Mac 磁盘留 ~40G。

**第 1 步：下载镜像（两种工具通用）**
[fedoraproject.org/workstation/download](https://fedoraproject.org/workstation/download)
选 **aarch64（Apple Silicon）** 的 Live ISO。当前稳定版 F44（F45 正式版 10/20 发布，发布后直接换新版）。
⚠️ 必须是 aarch64——下成 x86_64 会无法启动或慢到不可用。

**第 2 步：建虚拟机**

*VMware Fusion*（免费版需在 Broadcom Support Portal 注册账号下载）：
- File → New → Install from disc or image → 选 ISO；
- ⚠️ 客户机操作系统必须选 Linux → **Fedora 64-bit ARM**。若自动识别成了 x86 的
  "Fedora 64-bit"，务必手动改，否则 Fusion 会走全模拟（慢到不可用）；
- Finish 前 Customize Settings：内存 8G、CPU 4 核、磁盘 40G；
  Graphics 勾选 **Accelerate 3D graphics**（Fusion 对 ARM Linux 有 3D 支持，niri 比
  软渲染流畅得多）。

*UTM*（[mac.getutm.app](https://mac.getutm.app)）：
- 新建 → **Virtualize**（不要选 Emulate，那是跨架构模拟）→ Linux → 挂 ISO；
- 内存 ≥ 4G（建议 8G）、CPU ≥ 4、磁盘 ≥ 32G，显示保持默认 VirtIO GPU。

**第 3 步：装系统（通用）**
启动进 Live 桌面 → "Install to Hard Drive"（Anaconda）：语言/键盘 →
Installation Destination 选整块虚拟盘 → 设用户密码 → 开始安装。
装完重启前**断开/清空 CD/DVD 的 ISO**（Fusion 一般自动弹出；UTM 需手动清空），否则又进 Live。

**第 4 步：首次进入 GNOME 后**

*VMware Fusion*（装 VMware Tools，剪贴板共享与自适应分辨率靠它）：
```bash
sudo dnf upgrade -y && sudo systemctl reboot   # 先把内核更到最新再干活
sudo dnf install -y open-vm-tools open-vm-tools-desktop
sudo systemctl enable --now vmtoolsd            # 装完注销重登生效
```

*UTM*：
```bash
sudo dnf upgrade -y && sudo systemctl reboot
sudo dnf install -y spice-vdagent               # 剪贴板共享，装完注销重登生效
```

**第 5 步：把仓库弄进 VM**（三选一）：
- 有 GitHub 远端：VM 里直接 `git clone`；
- rsync：VM 里 `sudo systemctl enable --now sshd`。
  Fusion 的默认 NAT（Share with my Mac）**允许 Mac 直连 VM 的 IP**：VM 里
  `ip addr` 查地址后，Mac 上直接
  `rsync -av --exclude node_modules --exclude dist ~/codespace/AgentOS/ <vm用户>@<VM_IP>:~/AgentOS/`。
  （UTM 的 Shared 网络不行，需在 VM 设置加端口转发 Host 2222 → Guest 22，然后
  `rsync -av -e "ssh -p 2222" ... 用户@localhost:~/AgentOS/`）
  （Fusion 还有 Sharing → 共享文件夹可选，guest 里挂 `/mnt/hgfs`）
- 临时 HTTP：Mac 上 `cd ~/codespace/AgentOS && python3 -m http.server 8000`，
  VM 里 `wget` 拉一份。

**第 6 步：跑安装器**（走 install.sh 的 dnf 分支）：
```bash
cd ~/AgentOS && ./os/install.sh --with-goose
```

**第 7 步：进 niri 会话**：niri 包自带 wayland-session 文件。先加通知守护进程自启，然后注销，
GDM 登录界面右下角齿轮选 **Niri**，登录：
```bash
mkdir -p ~/.config/niri
echo 'spawn-at-startup "mako"' >> ~/.config/niri/config.kdl
```
（niri 没有配置文件也能跑，这行只为拉起 mako）

之后从 §3 的 L1 开始逐层验证。

### 0.3 配置 Mac → VM 的 SSH（顺带让开发 agent 远程操作）

Fedora Workstation 默认不启 sshd。VM 里两步：

```bash
sudo dnf install -y openssh-server      # 一般已预装
sudo systemctl enable --now sshd
# FedoraWorkstation 防火墙区默认放行 ssh；不通再执行：
# sudo firewall-cmd --add-service=ssh --permanent && sudo firewall-cmd --reload
hostname -I                             # 记下 VM 的 IP（Fusion NAT 网段 192.168.x.x）
```

Mac 侧配密钥免密登录（免密是远程自动化的前提）：

```bash
[[ -f ~/.ssh/id_ed25519 ]] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
ssh-copy-id <vm用户>@<VM_IP>             # 输一次 VM 密码，之后免密
```

建议加个别名（`~/.ssh/config`）：

```
Host agentos-vm
    HostName <VM_IP>
    User <vm用户>
    StrictHostKeyChecking accept-new
```

之后 `ssh agentos-vm` 直达。Fusion 的 NAT 下 VM IP 通常重启不变；若漂移，可在
`/Library/Preferences/VMware Fusion/vmnet8/dhcpd.conf` 加 DHCP 保留，或每次 `hostname -I` 重查。

注意：远程跑的命令遇到 `sudo` 仍要密码——需要 agent 代跑的 sudo 步骤（装包等）
要么用户在 VM 控制台自己执行，要么对个别命令配 NOPASSWD（不建议对 wheel 全开）。



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
| SSH 里跑 `niri msg`/`wl-copy`/`notify-send` 报环境错 | SSH 会话不带图形会话环境，需手动导出：`NIRI_SOCKET=$(ls /run/user/$(id -u)/niri.*.sock | head -1)`、`WAYLAND_DISPLAY=wayland-1`、`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus` |
| MCP 客户端拉起 niri-mcp 后报 NIRI_SOCKET is not set | MCP SDK 的 stdio 客户端默认只透传白名单环境变量（HOME/PATH/USER 等），必须显式传 env（见 `scripts/l2-smoke.mjs` 注释；goose 侧在扩展配置的 `envs` 里传） |
| `无法启动 niri`（isError） | PATH 里没有 niri，用 `NIRI_MSG_BIN=/usr/bin/niri` 指定绝对路径 |
| VM 里 niri 黑屏/卡登录 | 日志有 `VMware: No 3D enabled` / `failed to initialize renderer`：niri 是 GLES 合成器**无软件渲染回退**，Fusion 必须勾选 Accelerate 3D graphics（GNOME 能进不代表 3D 开了） |
| GDM 找不到会话齿轮 | 齿轮在**点选用户名之后**才出现（输密码框旁） |
| `niri msg action ...` 参数错 | niri 各 action 参数名不一致：`move-window-to-workspace` 用 `--window-id`，`focus-window`/`close-window` 用 `--id`（26.04 实测）；以 `niri msg action <名字> --help` 为准 |
| VM 里 curl GitHub release 被重置 | 网络环境问题：在 Mac 下载二进制后 `scp` 推入（goose 即此法安装） |
| UTM 里 niri 动画略钝 | aarch64 VM 走 llvmpipe 软渲染，窗口操作可用即可，验证不依赖 GPU 性能；要真 3D 加速换 Parallels/Fusion 或 x86_64 真机 |
| Fusion 里 VM 极慢/起不来 | 客户机类型选错：必须是 Linux → Fedora 64-bit **ARM**，选成 x86 的 "Fedora 64-bit" 会走全模拟，删掉重建 |
| Fusion 剪贴板/分辨率不自适应 | `open-vm-tools-desktop` 装了吗？`systemctl status vmtoolsd`；装完要注销重登 |
| 装错 x86_64 ISO | 重下 aarch64 镜像（文件名含 `aarch64`）；Apple Silicon 上 x86_64 只能全模拟，不可用 |
| UTM 剪贴板不通 | VM 里 `sudo dnf install spice-vdagent` 后注销重登 |
| GDM 会话列表没有 Niri | 确认 niri 已装：`ls /usr/share/wayland-sessions/` 应有 niri.desktop |
| firewalld 拦 SSH 表现为 "No route to host" | 不是路由问题！`sudo firewall-cmd --add-service=ssh --permanent && sudo firewall-cmd --reload`（ARP 能通而 TCP 被拒即此症） |
| npm install 慢/失败 | 换镜像：`npm config set registry https://registry.npmmirror.com`（国内环境） |

## 实测记录

- 2026-10-13 文档定稿；官方文档核对：`--json` 在子命令前、`niri-session` 启动方式、`NIRI_SOCKET` 语义均已确认，待真机回填。
- 2026-10-13 新增 Apple Silicon（aarch64）路径：CachyOS 无 ARM 镜像（官方确认），冒烟走 Fedora aarch64 + niri 官方包 + COPR 的 xwayland-satellite；goose 官方支持 arm64。
- 2026-10-13 新增 §0.2 UTM/VMware Fusion 安装指南（Workstation aarch64 Live ISO 自 F35 起官方提供）。
- **2026-10-14 真机实测通过（Fedora 44 aarch64 @ VMware Fusion，SSH 远程驱动）**：
  - **L1 ✅**：`--json windows/workspaces/outputs` 结构与封装一致；`focus-workspace` 引用语法 = 序号或名称；
  - **L2 ✅**：`scripts/l2-smoke.mjs` 全链路零失败——8 工具注册、查询真数据、开/移/关 Alacritty 全通过（修复 `--window-id` 后）；
  - **desktop 链路 ✅**：notify-send（mako）+ wl-copy/wl-paste 读写回环；
  - **实测发现并已修复 3 个问题**：① `move-window-to-workspace` 参数为 `--window-id`（非 `--id`）；② MCP SDK stdio 客户端 env 白名单丢弃 `NIRI_SOCKET`（smoke 脚本显式透传 env）；③ 窗口 `app_id` 大小写由应用自报（"Alacritty"），匹配需不区分大小写；
  - **环境教训**：Fusion 必须开 3D 加速（niri 无软件渲染回退，症状为黑屏卡登录）；firewalld 拒绝表现为 "No route to host"；VM 直连 GitHub release 被重置，goose 走 Mac 中转 scp 安装；
  - **基座评估数据**：F44 仓库 niri 26.04（落后上游约一个小版本）；F44 updates 内核 6.19 → 7.2.10 rebase（Fedora 版内内核跟进策略实证）。
- **2026-10-15 L3 ✅（M0 退出标准达成）**：goose + GLM（coding plan key 走 **Anthropic 兼容端点** `/api/anthropic`，套餐额度不覆盖 OpenAI 兼容端点）+ 两个自研扩展，一句对话完成列窗口→开→移→关→通知，全程走 `niri__*`/`desktop__*` 工具。两个根因修复：① 启动器 REPO_ROOT 少回退一层目录导致扩展进程秒崩、goose 静默丢弃；② 扩展配置缺 `name` 字段整条不生效（goose 不报错）。
- **2026-10-15 M1 扩展实测 ✅**：`system-mcp`（资源/用户级日志/包查询）与 `files-mcp`（工作区读写回环）经 goose 真机验证通过；四个扩展（niri/desktop/system/files）全部挂载。files-mcp 的越界防护有专项单测（../ 逃逸、绝对路径、符号链接外指）。
- **2026-10-15 M1 退出标准 ✅**：纯对话全链路"下载→整理→生成 .fodt→LibreOffice 展示→通知"达成（soffice 26.2 窗口实证）。三个实测教训：① 我给的 URL 无效（releases/44 无 README），agent 自行探测多镜像换用可用源并如实报告——故障恢复超预期；② Fedora 的 MIME 探测把 .fodt 识别成 text/xml（即使注册了正确关联），xdg-open 落到 Firefox——解法是 desktop__open 增加 app 参数（白名单别名直调 soffice），不与 shared-mime-info 纠缠；③ VM 上改了依赖必须重跑 npm install，否则 tsc 失败、dist 停留旧版且不易察觉（本次"工具不存在"的假象即由此而来）。- **2026-10-15 M2 核心 ✅**：canvas 生成式 UI 闭环真机打通——agent 用 system 扩展采集真实数据（内存/磁盘/服务/网络）→ 生成自包含深色仪表盘 HTML（7.4KB）→ files 写入 canvas/status/ → desktop__open 浏览器呈现（窗口标题实证）；systemd user 服务 agentos-canvas 上线（127.0.0.1:7788）。修复一个路径解析 bug：URL 路径前导 `/` 会让 path.resolve 丢弃 root，须先剥离（有专项测试）。
- **2026-10-16 M3 核心 ✅**：session-mcp 水族馆真机打通——agent 启动嵌套 niri（pid/wayland 独立）、内部开 Alacritty、grim 定向截图；**goose 自动加载截图 PNG 并视觉描述内容**（提示符/热键浮层都认出来了）——agent 对自身 GUI 的感知-操作闭环成立，全程不动用户桌面焦点。经验：goose 的 llm_request 日志文件编号跨会话复用，`ls -t` 取"最新"不可靠，验证工具注册要全量 grep。
- **2026-10-16 M3 a11y ✅**：atspi-mcp 无障碍桥真机打通——agent 全自主操作水族馆内的 gnome-calculator（找应用→按名称点击 6/×/7/=→读显示屏 42→通知），全程零焦点零鼠标。四个硬核发现：① GTK4 要等 AT 客户端在注册表登记后才构建完整无障碍树（匿名访问只见 16 节点骨架，注册后 105），桥启动即注册哑监听器；② libadwaita 嵌套深，按钮在 depth 8 以下，桥的深度上限放宽到 16；③ **无障碍树结构跨 AT 连接会重建，索引路径跨进程不稳定**（实测点击时路径失效）——操作全面改为按名称寻址（click/texts/settext），路径版仅留调试；④ GTK3 报 "push button"、GTK4 报 "button"，角色名白名单两者都要收。另：goose 在点击失败时自己倒树、读桥源码、定位并用探针验证了 ④ 的 bug 并当场修复——agent 自我修复工具链的首次实录（修复已收编回仓库）。
- 权限模型 v0 同步上线：@agentos/policy 全工具调用落审计日志（~/.local/state/agentos/audit.jsonl）。
