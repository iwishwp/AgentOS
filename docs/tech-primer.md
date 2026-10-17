# AgentOS 技术补课手册（tech-primer）

> 面向项目主理人的白板讲解：本仓库用到的每项技术是什么、为什么选它、它们如何咬合，
> 以及系统补课 Linux 桌面（重点是平铺式桌面）的运作原理。
> 写作约定：先直觉与比喻，再机制，最后落到"在我们仓库里是哪个文件"；术语首次出现给
> 一句人话解释。仓库事实以本文写作时点（2026-10-17，M4 已关账、M5 进行中）为准；
> 随代码演进请以源码与各专项文档为最终事实源，本文给出路径。

**怎么读**：第一部分是纯补课（不涉及 AgentOS 也能读），重点在 §1.4 平铺式桌面；第二
部分是本仓库的选型清单，可当索引用；第三部分用四个端到端场景把一切串起来，建议对照
着源码走一遍。全文 10 张 ASCII 图可单独翻阅当速览。

---

# 第一部分：Linux 桌面是如何运转的（补课）

Linux 桌面是很多个独立项目的拼装，没有一个"官方全家桶"。理解它的办法是分层：
每层只对上一层负责，层与层之间靠协议（内核接口、Wayland、D-Bus）而不是靠源码耦合。
AgentOS 的"极简组合"思路，就是在每一层挑一个最小的、协议标准的组件，拼出一个桌面。

## 1.1 从内核到像素：DRM/KMS、GPU 渲染、为什么需要显示服务器

**比喻**：显卡是一块只有一个门口的仓库（显示内存），屏幕是一排必须按固定节拍刷新的
展架。内核是仓库管理员（DRM），它决定谁能进门搬货；而"每 16 毫秒把整面墙的货架
重新摆一遍"的活，需要一个专职的搬运工。

- **DRM（Direct Rendering Manager）**：Linux 内核的显卡子系统，`/dev/dri/card0` 那个
  设备节点就是它。它管两件事：① GPU 显存与命令队列的仲裁（多个进程共用一张卡不打架）；
  ② **KMS（Kernel Mode Setting）**——分辨率、刷新率、多屏排布这些"显示模式"由内核设置，
  谁是 **DRM master**（独占持有者）谁说了算。
- **渲染**：应用通过 Mesa（OpenGL/Vulkan 的开源实现，`mesa-dri-drivers` 包）把绘图指令
  交给 GPU，画进一块 **buffer**（显存里的像素图）。注意：画完只是画在一块"画布"上，
  屏幕还不知道它存在。
- **谁把 buffer 送上屏幕**：必须有一个进程持有 DRM master，把各个应用的 buffer 按
  正确的层次、位置**合成（composite）**到一块最终的 framebuffer 上，再经 KMS 输出。
  这个进程就是**显示服务器 / 合成器（compositor）**。没有它，每个应用都要自己抢显卡、
  自己上屏，会互相覆盖——所以"需要显示服务器"不是历史包袱，是并发显示的必然。

```
【图 1：显示栈分层——谁能碰什么】

  应用（Firefox / Ghostty / goose）
    │  自己渲染：CPU 或 GPU 把 UI 画进一块 buffer（画布）
    │  "我画好了，这块画布给你" —— 交给显示服务器
    ▼
  显示服务器 = 合成器（niri）                 ← 全机唯一的 DRM master
    │  ① 收下所有应用的 buffer，决定谁在哪、谁在上面
    │  ② 合成：自己的 GPU 通道渲染最终画面（加边框/间距/模糊/动画）
    │  ③ 经 KMS 把最终 framebuffer 送上屏幕
    ▼
  内核 DRM/KMS（/dev/dri/card*）
    │  扫描输出（encoder/connector），按刷新率点亮屏幕
    ▼
  屏幕：像素
```

一个实战佐证：仓库实测记录里 niri 黑屏卡登录的根因就是这层——"niri 是 GLES 合成器
**无软件渲染回退**，VMware 必须勾选 Accelerate 3D graphics"（`docs/real-machine.md`
排错表）。合成器自己就是全机最大的 GPU 客户端，它拿不到 GPU 就整个会话起不来；
GNOME 能进不代表 3D 开了（它有软渲染兜底）。

## 1.2 X11 → Wayland：角色变化，客户端怎么画窗口，输入怎么流动

**X11（1987–）**：一个中央 X Server 进程同时管显示与输入。所有应用连到它，它把键盘
鼠标事件分发给应用、把应用的绘图请求画出来。窗口管理器（WM）只是一个特殊客户端，
靠 EWMH 之类的约定"建议"窗口布局——所以 X11 下合成器（如 Picom）与 WM（如 i3）
可以是两个互不相干的进程，靠 X 协议打配合，缝很多：撕裂、安全问题、每帧全局重绘。

**Wayland（2008–，近十年成为主线）**：把上面那套推翻重来。核心变化一句话：
**合成器本身就是显示服务器**。应用（客户端）通过 Unix socket 上的 Wayland 协议直接
和 niri 对话：

- **怎么画窗口**：客户端把内容渲染进一块 **`wl_buffer`**，挂到一个 **`wl_surface`**
  （"一个可显示的矩形表面"）上，然后 `commit`（提交）——意思是"这一帧画好了，请合成"。
  合成器收下 buffer，按自己的布局规则摆位合成。**应用不知道也不决定自己的窗口在哪**——
  这就是安全与流畅的来源（没有"应用把自己的窗口弹到最前面抢焦点"这种事，合成器说了算）。
  普通应用窗口用 `xdg_shell` 协议声明"我是一个带标题的顶层窗口"，状态栏/启动器这类
  覆盖层则用 layer-shell（见 §1.4）。
- **输入怎么流动**：合成器从 libinput（内核 evdev 事件的规范化库）读入键盘鼠标，经
  **seat**（"一组键鼠+屏的逻辑座位"，Wayland 里叫 `wl_seat`）路由：键盘事件发给"获得
  焦点的 surface"，指针事件按命中测试发给指针下的 surface。**焦点模型完全由合成器
  掌握**——这正是 AgentOS 人机并发设计（§2.9、场景 B）依赖的机制基础。
- **旧 X11 应用怎么办**：跑一个 XWayland（X11 到 Wayland 的桥，把遗留应用装进一个
  Wayland 窗口）。我们仓库用的独立实现叫 `xwayland-satellite`（`docs/real-machine.md`
  §0.1，可选组件，不测 X11 应用可跳过）。

```
【图 2：X11 与 Wayland 的角色对比】

  X11 世界（WM 与合成器是两个客户端，隔着 X Server 打配合）:
    应用 ─┐                        ┌─ 窗口管理器(另一客户端): 决定摆位
          ├─→ X Server(显示+输入) ─┤
    应用 ─┘   （中央大管家）        └─ 合成器(又一客户端): 决定叠影/效果

  Wayland 世界（合成器即显示服务器，一个进程说了算）:
    应用(Ghostty) ──┐                        niri = 显示服务器
    应用(Firefox) ──┼─ wl_surface + buffer →  + 窗口管理器 + 合成器
    XWayland 桥  ──┘   （"画好了，请合成"）     + 唯一 DRM master
                              ▲
                              └─ libinput/seat：输入也由它分发
```

## 1.3 会话与权限底座：systemd / logind / D-Bus / polkit / portal / keyring / PipeWire / 通知

这一节是"桌面背后的服务网格"。每个一段：是什么 / 为什么存在 / 谁在用（我们的落点）。

**systemd（init 与服务管理器）**。内核启动的第一个进程（PID 1），管所有系统服务；它
还管一套**用户级实例（systemd --user）**——每个登录用户一份，跑用户的守护进程。
关键概念是 **target（目标组）**：一组服务的集合点。`graphical-session.target` 的语义是
"图形会话已就绪"——桌面会话启动时（niri 的 systemd 集成会绑定它），挂在这个 target
下的用户服务才启动；会话退出它们也跟着停。**我们怎么用**：canvas / confirm / goose
三个用户服务单元全部 `After=` + `PartOf=` + `WantedBy=graphical-session.target`
（`os/systemd/agentos-{canvas,confirm,goose}.service`、镜像版
`os/bootc/systemd/*.service`）——它们依赖桌面环境变量（`WAYLAND_DISPLAY` 等），必须
等图形会话起来才启动。另注意 bootc 构建守则：构建期只能 `systemctl enable`（纯文件
操作），不能 `start`（`os/bootc/Containerfile` 层 5 注释）。

**logind / seat**。systemd 的登录管理器。它定义 **seat（座位）**——"一套可用的
显卡+键鼠+屏"（物理机通常 seat0）；管理会话（session）生命周期、休眠唤醒授权；并给
每个会话分配 `XDG_RUNTIME_DIR`（`/run/user/<uid>/`——本用户所有运行期 socket 的家，
Wayland socket、D-Bus socket、niri IPC socket 都住这里）。**我们怎么用**：niri IPC
socket 路径 `/run/user/<uid>/niri.<wayland-N>.<pid>.sock` 的自动发现逻辑在
`scripts/env/with-niri-env.sh` 与 `packages/session-mcp/src/agent-session.ts`
（正则 `niri\.(wayland-\d+)\.(\d+)\.sock`）；M4 实测里"goose 是 systemd user 服务、
无 logind 会话，polkit 规则里 `subject.active` 为 false"的坑直接改变了我们的 polkit
规则写法（`docs/permissions.md` §4.2 修订）。

**D-Bus（桌面总线）**。进程间消息总线，桌面世界的"RPC + 事件订阅"标准。两条总线：
**系统总线**（system bus，`/run/dbus/system_bus_socket`，接 systemd、NetworkManager、
polkit 这些系统服务）与**会话总线**（session bus，`/run/user/<uid>/bus`，桌面应用与
用户级服务互聊）。请求方法调用、收信号（广播事件）都走它。**我们怎么用**：
`org.agentos.Confirm1` 确认服务（T1 确认流）是会话总线上的自定义 D-Bus 服务
（`os/dbus/agentos-confirm.py`）；通知走会话总线的 `org.freedesktop.Notifications`；
Secret Service 也是总线接口。SSH 进机器操作桌面时必须手动导出
`DBUS_SESSION_BUS_ADDRESS`（`docs/real-machine.md` 排错表）。

**polkit（授权工具包，PolicyKit）**。"这个动作允许谁做"的中央仲裁。服务在执行特权
动作前问 polkit；polkit 按 `/usr/share/polkit-1/actions/*.policy`（动作定义，标注需要
什么强度的认证）与 `/etc/polkit-1/rules.d/*.rules`（JS 规则，可按调用方细化）裁决。
裁决结果可能是"放行 / 拒绝 / 需要认证"，需要认证时由桌面里注册的**认证代理**
（如 `lxqt-policykit-agent`）弹密码框。**我们怎么用**：T2 强确认整条链——action
`org.agentos.pkg-install`（`os/polkit/org.agentos.pkg-install.policy`）+ rules
（`os/polkit/49-agentos.rules`：本 helper 走 `auth_admin` 每次都要密码、其余 pkexec
一律拒绝）+ 认证代理由 niri 自启（`os/configs/niri/config.kdl` 里
`spawn-at-startup ... lxqt-policykit-agent`）。

**xdg-desktop-portal（门户）**。沙箱化桌面（Flatpak 时代产物）的标准授权层：应用
不再直接拥有全部能力，而是经会话总线上的 portal 服务请求"打开文件选择器 / 截屏 /
打开链接"，由对应 backend（`xdg-desktop-portal-gnome/gtk`，我们的包清单里有）弹 UI
征求用户同意。接口风格是 Request/Response 异步对。**我们怎么用**：目前主要作为
存在的基础设施（`os/install.sh` 装了 gnome/gtk 两个 backend；浏览器等应用截屏/文件
选择依赖它）；自研的 Confirm1 刻意做成 portal 的同构前身，未来可平移成自定义 portal
backend（`docs/permissions.md` §4.1 迁移路径）。

**Secret Service / keyring（密钥环）**。freedesktop 的凭据存储标准：会话总线上的
`org.freedesktop.secrets` 接口 + 一个实现 daemon（GNOME 上是 gnome-keyring），客户端
库是 libsecret（命令行工具 `secret-tool`）。登录时 PAM 栈里的 `pam_gnome_keyring`
用登录密码解锁 keyring，之后应用免密读写。**我们怎么用**：它是 credential broker
的底座后端（`docs/security/credentials.md` §3"最大公约数"），注册工具
`scripts/cred-store.sh`（`secret-tool store --label=... agentos-ref <引用>`）；
自动解锁的实测结论在 credentials.md §5.1（PAM 层已验证通过）；自动化浏览器反其道
用 `--password-store=basic` 绕开 keyring（隔离层，`packages/browser-mcp` 固化）——
keyring 锁定曾把 Chromium 网络栈整个挂死（M3 悬案，`docs/real-machine.md` 2026-10-16）。

**PipeWire**。现代音频/视频路由守护进程（会话总线接口），取代 PulseAudio 并兼容其
协议（`pipewire-pulseaudio` 包），会话管理器是 WirePlumber。截屏串流也走它（portal
的 ScreenCast 接口底层）。**我们怎么用**：作为桌面基础设施工件安装
（`os/bootc/Containerfile` 层 1：`pipewire pipewire-pulseaudio wireplumber`）；应用层
暂未直接消费（架构文档 L0 提到 `wpctl/MPRIS` 属远期工具面，`docs/architecture.md` §4）。

**通知规范（org.freedesktop.Notifications）**。会话总线上一个极简的标准接口：任何
进程 `notify-send` 一条通知，**通知守护进程**（谁先在总线上注册 `org.freedesktop.Notifications`
这个名字谁负责）弹横幅并维护历史。**我们怎么用**：守护进程是 **mako**（niri
`spawn-at-startup "mako"`）；desktop-mcp 的 `notify` 工具、Confirm1 的四横幅确认载体
（每个选择一条横幅，`os/dbus/agentos-confirm.py` CHOICE_BANNERS 注释）、goose 行为
基线里的"完成/失败/需确认三类通知"（`os/configs/goose-system.md`）全压在它上面；
与 Noctalia 通知面板的抢注共存关系见 `docs/noctalia.md` §5。

## 1.4 平铺式桌面原理（重点）

### 1.4.1 什么是平铺，谱系如何分

传统桌面（Windows/macOS/GNOME 默认）是**浮动窗口**：窗口像桌上的纸，随意叠放，
靠鼠标拖拽、点标题栏聚焦。**平铺式（tiling）**则主张：窗口不重叠，自动把屏幕空间
切分给每个窗口；操作靠键盘，焦点跟着布局移动。代价是没有"随手一扔"的自由，收益是
零鼠标、零寻找、窗口永远可见——对终端重度用户（和一个 agent）是数量级的效率差。

按"谁来决定布局"，平铺世界有一条谱系：

- **动态平铺（dynamic tiling）**：WM 自动维护布局，开新窗口就自动重切屏幕。
  代表 **dwm**（C 写、不到 2000 行、改配置靠改源码重编译）、**awesome**（dwm 思想 +
  Lua 配置）、**Hyprland**（现代动态平铺，动画/特效丰富）。
- **手动平铺（manual tiling）**：新窗口出现在哪里、占多大，由用户显式决定（通常是
  "在当前容器里水平/垂直再切一刀"），WM 只负责执行。代表 **i3**（X11 旗帜）与其
  Wayland 移植 **Sway**。窗口组织成树（容器嵌容器）。
- **滚动平铺（scrollable tiling）**：**niri** 开创的第三条路。见下节。

```
【图 3：三种平铺模型对比（同屏 4 个窗口 W1–W4）】

  动态平铺 (dwm/Hyprland)          手动平铺 (i3/Sway)           滚动平铺 (niri)
  ┌──────┬─────────┐         ┌───────┬─────────┐        ──────┬─────────┬──────
  │ W1   │ W2      │         │ W1|W2 │ W3      │        (W0)   │ W1      │ W2
  │      ├────┬────┤         │      │────┬────┤               ├─────────┤
  │ W3   │ W4 │…  │         │  树   │ W4 │…  │               │ W3  W4  │
  └──────┴────┴────┘         └───────┴────┴────┘               （继续向右滚动）
  开窗即自动重切                 用户下刀，结构即树             一条无限横带，左右滚动
  布局是 WM 的决定               布局是用户的决定               布局是"排列"而非"切分"
```

### 1.4.2 工作区、焦点模型、键盘驱动

平铺桌面的三个肌肉记忆：

- **工作区（workspace）**：虚拟屏幕。屏幕只有一块，但工作区有 N 个（我们配了 1–9，
  `os/configs/niri/config.kdl`），`Super+数字` 切换、`Super+Shift+数字` 把当前列挪过去。
  工作区解决"任务分组"：1 终端、2 浏览器、3 水族馆……各归各位。
- **焦点模型**：键盘输入给谁由合成器决定。niri 是"焦点跟随布局"——`Mod+方向键` 在
  列与窗口间移动焦点（`focus-column-left/right`、`focus-window-up/down`），无需鼠标。
  焦点环（focus-ring，3px 灰绿描边，`os/configs/theming/niri/aesthetics.kdl`）是唯一
  的视觉指示。
- **键盘驱动**：一切高频操作有键位。我们 62 个 bind 全表在 `os/configs/niri/config.kdl`
  （方案借鉴 Omarchy，逐键取舍见 `docs/keyboard.md`），速查页 Super+K 指向 canvas
  `/keys`（实时解析配置文件、零副本，`packages/canvas/src/keys.ts`）。

### 1.4.3 平铺 WM 与合成器的关系：Wayland 时代没有"独立 WM"

X11 时代，WM 只是一个客户端（§1.2），所以"i3 是 WM、X Server 另算"。Wayland 时代
**合成器就是显示服务器**，而"摆放窗口"本来就是合成器的职责——于是**窗口管理逻辑
必须长在合成器里**，不存在"niri 配一个第三方 WM"这种组合。niri 既是显示服务器、
又是窗口管理器、又是合成器，三位一体（Rust 写就，基于 Smithay 框架）。这也解释了
为什么选型窗口管理方案＝选型整个合成器：niri 的滚动平铺、JSON IPC、嵌套运行能力，
是我们选它的全部理由（`README.md`、`docs/architecture.md` §6）。

### 1.4.4 layer-shell：覆盖层为什么需要专门协议

普通窗口走 `xdg_shell`，但状态栏/启动器/锁屏这类"桌面外壳件"不是窗口：它们要**锚定
屏幕边缘、常驻某个层级（背景层/顶层/覆盖层/锁屏层）、预留专属空间（exclusive zone，
让普通窗口自动避开）、不参与窗口切换**。为此 wlroots 生态定义了
**wlr-layer-shell** 协议（接口名 `zwlr_layer_shell_v1`）：客户端创建 **layer surface**
并声明锚点/层级/预留区，合成器按层叠放。**我们怎么用**：Noctalia 的状态栏、壁纸、
启动器全部是 layer surface（实测 `niri msg layers` 可见
`noctalia-{wallpaper,bar-content,...}` 共 6 层，`docs/noctalia.md` §7）；niri 自身也
用它的键位浮层。GNOME/KDE 曾长期不支持 layer-shell（Mutter 至今在讨论），这也是
"wlroots 系合成器 + QuickShell 系 shell"形成一个生态圈的原因之一。

### 1.4.5 niri 的滚动列模型、KDL 配置、JSON IPC、窗口规则与 background-effect

**滚动列模型**——niri 的数据结构是两条轴：

- **横轴：列（column）**。每个窗口至少属于一列，列可以有多个上下叠的窗口（列内平铺）。
  所有列排成一条**无限宽的横向卷轴**，`Mod+Left/Right`（或 `focus-column-left/right`）
  左右滚动，聚焦列始终被视口兜住。你可以把卷轴理解为"时间线"：每开一个新窗口，
  它出现在卷轴末端，往右滚就是"往后翻"。
- **纵轴：工作区**。工作区纵向堆叠（`focus-workspace-up/down`，即 Super+Tab 的
  "下一个工作区"），每个工作区是一条独立的卷轴。

这个模型对 agent 尤其友好：窗口永远不重叠、位置可预测（"新窗口在卷轴末端"）、
`list_windows` 的 JSON 里每个窗口的归属（列/工作区/id）都是一等公民数据。niri-mcp 的
8 个工具（§2.6）就是照着这个模型设计的。

**KDL 配置与热重载**。niri 的配置是 KDL（kdl-lang——一种带节点/属性的声明式文档
语言，官方口径里这个缩写不特指任何全称），即 `~/.config/niri/config.kdl`。niri 监视该文件，保存即
热重载（无闪断）；`niri validate` 离线校验语法。仓库模板 `os/configs/niri/config.kdl`
约 220 行：spawn 自启、62 个 bind、ghostty 毛玻璃 window-rule，美学部分拆到
`os/configs/theming/niri/aesthetics.kdl`（`include "./aesthetics.kdl"`——niri 的
include 是文档拼接语义）。bootc 镜像在构建期就跑 `niri validate` 把配置错误挡在
出厂前（`os/bootc/Containerfile` 层 5）。

**JSON IPC**。niri 在 `$XDG_RUNTIME_DIR` 下开一个 Unix socket（路径含 wayland display
与进程 PID，见 §1.3 logind 段），`niri msg` 是它的 CLI 封装：查询（`--json windows /
workspaces / outputs`，返回结构化 JSON）与动作（`niri msg action spawn / focus-window /
move-window-to-workspace ...`）以及事件流订阅（`docs/architecture.md` §4 L0 层）。
这是 agent 操控桌面的最短路径——不用截图不用鼠标，一条 IPC 就能"列出窗口、开应用、
移窗口"。封装在 `packages/niri-mcp/src/niri.ts`。

**窗口规则（window-rule）与 background-effect**。niri 可按 `app-id`（应用在 Wayland
上自报的标识，ghostty 是 `com.mitchellh.ghostty`）匹配窗口并施加规则：默认尺寸、
摆位、透明度、背景效果。**background-effect** 是 niri 26.04 落地的合成器侧特效规则
（对应 `ext-background-effect-v1` 协议的能力面，该协议让客户端可为半透明表面请求
背景模糊等效果）：不要求客户端配合，合成器直接对匹配窗口的下层内容做高斯模糊。
我们用它做 ghostty 毛玻璃（§2.3）。

## 1.5 传统桌面与我们的极简组合：架构对照

GNOME/KDE 是"一家全包"：自己的合成器（Mutter/KWin）+ 自己的 shell（gnome-shell/
plasma-shell，含状态栏、启动器、通知、设置）+ 一整套应用与代理进程。好处是开箱即用、
体验统一；代价是体量大、组件间非标准耦合、每个组件都难单独替换。AgentOS 走
"wlroots 生态的极简拼装"：每层一个单一职责的小组件，用标准协议咬合。

```
【图 4：两种桌面的架构对照】

  GNOME                                    AgentOS（niri 极简组合）
  ┌──────────────────────────────┐         ┌──────────────────────────────┐
  │ gnome-shell（面板/启动器/OV…）│         │ Noctalia @ QuickShell（bar/  │
  │  （自己一套 JS 扩展体系）      │         │  壁纸/启动器/控制中心，QML）   │
  ├──────────────────────────────┤         ├──────────────────────────────┤
  │ Mutter = 合成器+显示服务器    │         │ niri = 合成器+显示服务器      │
  │        + WM（滚动无、平铺无） │         │       + WM（滚动平铺）+ IPC   │
  ├──────────────────────────────┤         ├──────────────────────────────┤
  │ gnome-keyring / pipewire /   │         │ gnome-keyring / PipeWire /   │
  │ xdg-desktop-portal-gnome ... │         │ portal-gnome+gtk ...（同标准）│
  ├──────────────────────────────┤         ├──────────────────────────────┤
  │ GDM                          │         │ GDM（现役 VM）/ SDDM（镜像线）│
  └──────────────────────────────┘         └──────────────────────────────┘
  通知: gnome-shell 内置           通知: mako（独立守护进程）
  终端: gnome-terminal             终端: Ghostty   启动器: fuzzel
  锁屏: gnome-shell 内置           锁屏: swaylock  截图: grim + niri 内置
```

对照的要点不是"谁好"，而是职责切分：把 shell 从合成器边上拆出来（QuickShell +
Noctalia 替代 gnome-shell），把通知、锁屏、启动器全部换成单一职责的协议组件——
每个组件都因为**小而可审计**，这对一个"agent 常驻操作系统"的系统来说比绚烂更重要。

---

# 第二部分：AgentOS 的组件清单

每个组件按"作用 / 为什么选它 / 仓库落点"讲。

## 2.1 基座：Fedora + bootc（不可变/原子更新）+ btrfs/snapper

**作用**：整台机器的地基与"后悔药"机制。

**Fedora（ADR-0001 定案）**。选型依据（`docs/decisions/0001-base-distribution.md`）：
agent 无人值守代跑系统更新是常态，Arch 的"升级前读公告"安全前提对 agent 不成立；
Fedora 每版过 QA 门禁；niri/goose 在官方仓库或有一等公民的 aarch64 支持；且全部
M0–M4 真机实测都落在 Fedora 44 上。CachyOS/Arch 降级为社区变体（`os/install.sh`
保留 pacman 分支双支持）。

**bootc（M5 发行形态）**。bootc 把"整个用户空间"变成一个 OCI 容器镜像（就是 Docker
镜像那种格式）：`/usr` 只读、系统状态＝镜像 digest。更新＝拉新镜像→写入新启动条目→
重启原子切换；失败回滚＝重启进上一启动条目（`bootc rollback`）。对 agent OS 的意义
（`docs/m5-atomic.md` §1）："agent 装错包"从一个没有干净边界的撤销问题，变成
"整体接受或整体拒绝一个镜像版本"。镜像自底向上五层：基座 `fedora-bootc:44` →
桌面运行时（dnf）→ gpu-screen-recorder（COPR）→ AgentOS 组件（npm 多阶段构建）→
默认配置+systemd 单元（最常迭代的放最上层，层缓存最友好）。落点：
`os/bootc/Containerfile`、`scripts/build-image.sh`；参考实现 Bazzite。

**btrfs + snapper**。过渡路径（普通 Fedora Workstation 安装）上的回滚机制：btrfs 的
**快照（snapshot）**是子卷级的写时复制点，创建秒级、占空间增量；snapper 是快照的
管理器。我们的策略（`os/snapper/README.md`）：**agent 做任何系统级变更前必须先建
`agentos-pre-*` 只读快照**，不做自动定时快照（让"哪些变更打了快照"本身可审计）；
`/home` 独立子卷，回滚系统不动用户数据。落点：`scripts/snapshot.sh`
（create/list/delete/rollback）、`docs/real-machine.md` 2026-10-17 回滚演示全记录
（含本机 fstab 钉死 subvol 导致 set-default 回滚不生效的坑——正是永久化回滚指向
bootc 的原因）。

## 2.2 合成器：niri

**作用**：显示服务器 + 滚动平铺 WM + 合成器 + JSON IPC 提供方（§1.4 已详述）。

**为什么选它**：滚动平铺对 agent 的可预测性；JSON IPC 让桌面状态成为结构化数据；
官方支持嵌套运行（水族馆的地基）；Rust 单二进制、Fedora 官方仓库有包。

**仓库落点**：配置模板 `os/configs/niri/config.kdl` + `os/configs/theming/niri/aesthetics.kdl`；
MCP 封装 `packages/niri-mcp/`；会话管理 `packages/session-mcp/`；文档
`docs/real-machine.md`（安装与验证）、`docs/keyboard.md`（键位）。

## 2.3 桌面 shell：QuickShell + Noctalia（QML、莫兰迪、毛玻璃链路）

**作用**：状态栏、壁纸、启动器、控制中心、dock——"桌面的脸面"，全部以 layer-shell
表面挂在 niri 上。

**QuickShell**：一个用 QML（Qt 的声明式 UI 语言）写桌面 shell 的框架——把"Wayland
client + 系统托盘 + 通知 + PipeWire 监听"这些脏活包成 QML 模块，你只写界面与逻辑。
**Noctalia**：别人在 QuickShell 上写好的一整套漂亮 shell，我们拿来加补丁用。

**为什么这样选**：自己写 shell 太贵；GNOME shell 不可移植；Noctalia 是 niri 生态里
完成度最高的一套（选版论证见 `docs/noctalia.md`：bisect 定在 v4.7.1——最后一个不依赖
`Quickshell.Niri` 模块的 tag，配合 Fedora 44 仓库的 quickshell 版本能跑）。后来
quickshell 升到 0.3.2（COPR），补丁集随之变为 {0001, 0002, 0005}（撤 0003/0004），
见 `os/configs/noctalia/patches/README.md` 的双版本矩阵。安装入口
`scripts/install-noctalia.sh`（含 Mac 中转流程）。

**莫兰迪色板**：视觉基准是 LanRhyme/dotfiles。要点：Noctalia 的 Material You 引擎从
壁纸取色生成 `colors.json`，但默认启动会套预设主题覆写它——自定义色板必须配
`useWallpaperColors=true`（`docs/noctalia.md` §8 实测坑）。落地脚本
`scripts/apply-lanrhyme-theme.sh`，素材与机制 `os/configs/noctalia/lanrhyme/`。

**毛玻璃链路（一条链三个组件配合）**——这是"组件如何咬合"的最佳教学案例：

1. **ghostty 侧**：`background-opacity = 0.85`（终端自己把背景画成 85% 不透明，
   任何合成器下都有效）；`background-blur = true` 保留但**在 niri 下静默无效**——
   ghostty 1.3.x 的模糊只走 KDE 私有协议 `org_kde_kwin_blur_manager`，niri 不广播它
   （源码级证据：ghostty `src/apprt/gtk/winproto/wayland.zig` 的 `syncBlur()`，
   `docs/ghostty.md` §4.1）。
2. **niri 侧**：26.04 实现了开放协议 **`ext-background-effect-v1`**（跨桌面生态的
   背景特效协议，KWin/Mutter/COSMIC/niri 均在采纳），并额外提供**合成器侧窗口规则**
   `background-effect { blur true }`——不需要客户端请求，对任意半透明窗口生效。
   规则在 `os/configs/niri/config.kdl` 末尾的 window-rule（match
   `app-id="^com.mitchellh.ghostty$"`）。
3. **Noctalia 侧**：栏/面板的毛玻璃由 Quickshell 0.3.2 的 `BackgroundEffect`
   （layer-shell 表面上的 attached property）请求，niri 应答——quickshell 0.2.1 没有
   这个类型，这是升级它的动机（`docs/noctalia.md` §9，栏后真高斯模糊已截图实证）。

一句话：**半透明是客户端画的，模糊是合成器给的**——两个协议、两侧配合，缺一不可。

## 2.4 周边件：mako / Ghostty / fuzzel / swaylock / SDDM（GDM）

| 组件 | 作用 | 为什么选它 | 仓库落点 |
|---|---|---|---|
| **mako** | 通知守护进程（实现 `org.freedesktop.Notifications`） | 轻量、Wayland 原生；`makoctl` 可编程驱动（T1 确认应答实测用 `makoctl invoke`） | niri `spawn-at-startup "mako"`（config.kdl）；边界记录 `docs/permissions.md` §4.1（1.11 不渲染动作按钮→四横幅载体） |
| **Ghostty** | 默认终端（Zig 写，GTK 前端） | 内置 Catppuccin Frappé 主题、CJK 渲染好、`-e` 拉起行为可预期、与 LanRhyme 生态同源 | `os/configs/ghostty/config`（主题名带空格的坑写在注释里）；调研 `docs/ghostty.md`；bootc 镜像线暂仍用 alacritty（遗留决策） |
| **fuzzel** | 应用启动器（Wayland 原生） | 轻量、layer-shell、行为可预测 | `Super+Space`/`Mod+D`（config.kdl）；键位页分组见 canvas `/keys` |
| **swaylock** | 锁屏 | Wayland 标配、简单 | `Super+Ctrl+L`（config.kdl） |
| **SDDM / GDM** | 显示管理器（登录界面，系统服务） | VM 现役 GDM（实证组合）；bootc 镜像选 SDDM+sddm-wayland-generic——不拖 gnome-shell，Bazzite 同构；niri 包自带 wayland-sessions 条目直接可选。SDDM+niri 尚未真机点亮（遗留） | `os/bootc/Containerfile` 层 1 与 §显示管理器选型、`docs/m5-atomic.md` §9 |

## 2.5 agent 引擎：goose

**作用**：对话循环的宿主——接模型 provider、维护会话与上下文、把模型的工具调用分发给
MCP 扩展、收回结果。它**只集成不 fork**（上游升级零成本）。

**为什么选它**：Apache-2.0、原生 MCP 扩展体系、`goose serve` 提供常驻服务形态
（ACP over HTTP/WebSocket，默认 127.0.0.1:3284——聊天 UI/面板作为客户端接入，
`os/systemd/agentos-goose.service` 注释）、官方二进制覆盖 x86_64/arm64。

**仓库落点**：systemd user 单元 `os/systemd/agentos-goose.service`（常驻）与 bootc
首启动安装单元 `os/bootc/systemd/agentos-goose-firstboot.service`；扩展挂载配置样例
`docs/goose-integration.md`（`~/.config/goose/config.yaml` 的 extensions 段，stdio 型，
经 `scripts/env/with-*.sh` 启动器补会话环境）；**行为基线提示词**
`os/configs/goose-system.md`——工具优先级、产物落位、填表标准动作、"拒绝绕验证码"
分寸条款，实测显著影响 agent 行为。

## 2.6 MCP 协议专节与我们的九个包

**MCP（Model Context Protocol）是什么**：Anthropic 2024 年底开源、现已多厂商采用的
"模型↔工具"连接标准。一句话：**用 JSON-RPC 2.0 在模型宿主（client）与工具提供方
（server）之间约定三种原语——tools（可调用函数）、resources（可读数据）、prompts
（提示模板）**。传输最常见的是 **stdio**：client 把 server 作为子进程拉起，标准输入
输出上跑 JSON-RPC——没有端口、没有网络面，进程边界即安全边界。握手（initialize）→
列举工具（tools/list）→ 调用（tools/call，参数由 JSON Schema 声明、结果带 isError
标记）。我们的 server 全部用官方 TypeScript SDK（`@modelcontextprotocol/sdk`）+
zod 声明参数 schema。

线上实际长这样（goose 调 `niri.list_windows`，概念示意）：

```json
// goose → niri-mcp（stdin 写入一行 JSON-RPC 请求）
{"jsonrpc":"2.0","id":7,"method":"tools/call",
 "params":{"name":"list_windows","arguments":{}}}
// niri-mcp → goose（stdout 返回；错误不抛异常而是 isError 标记，让模型自行换路）
{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"[{\"id\":42,...}]"}]}}
```

```
【图 5：MCP 架构——goose 与九个包的位置】

                     ┌───────────────────────────────────────────┐
                     │ goose（agent 引擎，systemd user service）  │
                     │  会话/上下文/审批 · 行为基线(goose-system.md)│
                     └───┬─────┬─────┬─────┬─────┬─────┬─────┬───┘
        stdio JSON-RPC（每个扩展一个子进程，scripts/env/with-*.sh 补环境）
      ┌─────────┬─────────┼─────────┼──────┼──────┼──────┼──────┬─────────┐
      ▼         ▼         ▼         ▼      ▼      ▼      ▼      ▼         ▼
  niri-mcp  desktop-mcp system-mcp files- session- atspi- browser- cred-mcp  (goose 内建
  (窗口/WS) (桌面交互)  (系统只读+  mcp   mcp    mcp    mcp    (凭据代理)   扩展×4)
                        装包T2)    (水族馆)(a11y) (CDP)
      │         │         │        │      │      │        │        │
      └── 全部经 @agentos/policy 的 createGate 统一注册：decide→审计→(confirm)→执行 ──┘
                              （支撑包：policy · proc · canvas）
```

逐包讲（工具数合计 47，README 口径"40+"；每个 server 的工具清单以
`packages/<名>/src/server.ts` 为准）：

1. **niri-mcp**（8 工具）——把 niri JSON IPC 包成 MCP 工具：`list_windows /
   list_workspaces / list_outputs`（只读查询）、`focus_window / focus_workspace /
   move_window_to_workspace / close_window / open_app`（动作）。对应系统能力：L0 合成器
   IPC。注意动作工具的描述里写明"这会切换用户视角，呈现结果时才用"——工具描述本身
   就是行为基线的一部分。落点 `packages/niri-mcp/`（IPC 封装在 `src/niri.ts`，
   `niri msg --json` 的 `--json` 在子命令前等签名细节以它为准）。
2. **desktop-mcp**（5 工具）——用户桌面的交互面：`open`（xdg-open，带 app 白名单参数
   直调 soffice 等，绕开 MIME 探测不可靠的坑）、`notify`（通知=确认通道本身）、
   `clipboard_read/write`（wl-clipboard）、`confirm`（通用问句，内部同样走 Confirm1）。
   对应能力：L0 xdg-open/通知/剪贴板。落点 `packages/desktop-mcp/`。
3. **system-mcp**（8 工具）——系统状态的只读面 + 唯一的 T2 例外：
   `system_status / list_services / service_status / journal / list_packages /
   package_info / network_info` 全部只读（T0 放行）；`package_install` 是 T2 装包链
   入口（走 pkexec helper，§3 场景 C）。对应能力：L0 systemd/dbus/dnf。支持
   rpm/pacman 双包管理（社区变体保留）。落点 `packages/system-mcp/`
   （装包链在 `src/system.ts` 的 PackageInstaller）。
4. **files-mcp**（8 工具）——工作区沙箱文件面：`list_dir / read_file / write_file /
   create_dir / move / delete / find_by_name / download`。两条内建纪律：**越界防护**
   （`../` 逃逸、绝对路径、符号链接外指均有专项单测，`src/workspace.ts`）与**回收站
   语义**（delete 进 `.trash/` 可恢复，所以敢标 T0）。对应能力：文件系统（限定
   `~/Agent`）。
5. **session-mcp**（6 工具）——水族馆生命周期：`agent_session_start / stop / status`
   （启动/停止/查询嵌套 niri）、`agent_list_windows / agent_open_app`（会话内窗口操作，
   连的是**嵌套会话自己的** IPC socket）、`agent_screenshot`（grim 只截水族馆内部）。
   全部 T0——水族馆是 agent 自己的领地。落点 `packages/session-mcp/src/agent-session.ts`
   （socket 发现正则、轮询等待新 socket 出现的逻辑都在这）。
6. **atspi-mcp**（5 工具）——无障碍树桥：`a11y_list_apps / a11y_dump_tree /
   a11y_read_texts / a11y_click / a11y_set_text`。**按名称寻址、无需焦点**——这是
   M3 最重要的实测结论（树结构跨 AT 连接会重建，索引路径跨进程不可用；
   GTK4 需 AT 客户端注册后才暴露完整树，桥启动即注册哑监听器）。对应能力：L1
   AT-SPI2（§2.9）。落点 `packages/atspi-mcp/src/bridge.ts`。
7. **browser-mcp**（3 工具）——水族馆里的浏览器：`browser_open / browser_eval /
   browser_screenshot`。Chromium + **原生 CDP**（Chrome DevTools Protocol，
   WebSocket，零第三方依赖）：打开页面、页面内执行任意 JS（填表/点击/读内容全靠它）、
   截图。两条固化教训：`--password-store=basic`（keyring 锁定会挂死网络栈）、默认
   无头（agent 视觉靠 CDP 截图，有头在嵌套 Wayland 不稳）。落点
   `packages/browser-mcp/src/browser.ts`（CDP 客户端、chromium 可执行名探测）。
8. **cred-mcp**（4 工具）——凭据代理的 agent 面具：`cred_list`（只列引用与标签）、
   `cred_exec`（通道 B 代执行）、`cred_autofill`（通道 A 自动填充）、`cred_inject`
   （通道 C 短期注入）。安全模型在 §2.7 与场景 B 详述。落点 `packages/cred-mcp/
   src/broker.ts` + 注册工具 `scripts/cred-store.sh`。
9. **支撑包（非 MCP server，但同仓库 npm workspaces 一等公民）**：
   - **@agentos/policy**：策略引擎 + 审计 + 确认客户端 + createGate 统一注册层
     （`packages/policy/src/{policy,gate,confirm}.ts`）。没有它，每个 server 要各自
     实现权限与审计——现在是一个 `t()` 包装函数的事（各 server.ts 头部注释）。
   - **@agentos/proc**：命令执行抽象层（CommandRunner 接口 + ShellRunner 实现 +
     测试替身），让全部单测可以在 macOS 上跑而命令不真跑（`packages/proc/`，
     测试策略见 `docs/architecture.md` §10）。
   - **@agentos/canvas**：呈现层本地服务（§2.8），它不是 MCP server——它服务的是
     **用户**的眼睛，不是模型的工具面。
   - 备注：`packages/proc/niri-mcp/` 是早期位置的残留副本，根 `package.json` 的
     build 清单已不含它（以 `packages/niri-mcp/` 为准）。

## 2.7 安全层：policy 网关 / Confirm1 / cred broker / 审计 / polkit

一句话总纲（`docs/architecture.md` §8）：权限分级、凭据零明文、全量审计、可回滚。
设计文档是 `docs/permissions.md`（三档）与 `docs/security/credentials.md`（凭据）。

**三档权限（T0/T1/T2）**：判档三问（可逆吗/动的谁的领地/有兜底吗）之后落到：
T0 免批准只审计；T1 弹一次确认；T2 强认证（密码）+ 变更前强制快照。载体是
`~/.config/agentos/policy.yaml`（`rules[extension][tool] → rules[extension]["*"] →
defaults.decision` 的查找顺序，`packages/policy/src/policy.ts`）；决策三值
allow / confirm / deny。

**policy 网关（createGate）**：所有 server 的工具注册统一走
`packages/policy/src/gate.ts` 的包装——每次调用先 `policy.decide`，再写审计
（`~/.local/state/agentos/audit.jsonl`，JSONL，含 tier/confirm/snapshot 扩字段），
confirm 决策则先走确认流拿到用户选择再决定执行与否；T2 工具声明"确认由工具内部的
polkit 承担"（delegatedConfirm），网关记 `result=delegated` 后放行进 handler。
安全默认：确认服务不可用时**拒绝执行**（fail-closed），这是整个网关最重要的性质。

**org.agentos.Confirm1（T1 确认服务）**：会话总线上的自定义 D-Bus 服务
（`os/dbus/agentos-confirm.py` + `os/systemd/agentos-confirm.service`）。接口：
Request/Respond/Wait + Confirmed 信号。载体因 mako 1.11 实测限制改为**四横幅**
（每个选择一条 critical 通知：允许/会话允许/拒绝/永不，自上而下），30 秒超时=
deny_once；always_deny 会写回 policy.yaml 持久化。五条应答路径（四选择+超时）全部
VM 实测（`docs/real-machine.md` 2026-10-17）。

**cred broker 三通道**：核心原则一句话——**agent 拿能力不拿明文**。agent 工具面只认
`vault://组/名` 引用；明文从 Secret Service（底座）流出后只存在于 broker 栈帧/子进程
里，永远不作为工具返回值：

```
【图 6：安全链路——明文的最短路径与三通道】

  agent（goose 上下文）──只说"用 vault://bank/login"──→ cred-mcp（broker）
                                                          │ secret-tool 取明文
                                                          ▼
                                              Secret Service（gnome-keyring）
   通道 A 自动填充（网页登录）   通道 B 代执行（CLI 命令）   通道 C 短期注入
   broker 经 CDP 在页面内设值    broker 直接 spawn 子进程    broker 起 wrapper 进程
   → 页面内逐字节复核 matches    → 明文只进子进程 env        → 短 TTL token 注入 env
   → 回执只有长度+sha256        → agent 只拿 stdout/exit    → TTL 到点收割进程组
   （明文不出页面/broker 栈帧）   → 输出中明文出现处打码      （实测 3.2s 被杀 exit 124）
        ▲ ▲ ▲ 明文永不越过这条线（回到 agent 的只有：结果、哈希、退出码）▲ ▲ ▲
```

每条凭据一条策略（`~/.config/agentos/credentials.yaml`：`allow` 通道白名单 +
`exec_allow` 命令硬白名单——argv[0] 精确匹配、数组直 spawn 无 shell 注入面）。
注册入口 `scripts/cred-store.sh`。全量审计明文扫描零命中是 M4 退出标准的实测项。

**polkit 强认证（T2）**：见 §1.3 polkit 段与 §3 场景 C。三件套在 `os/polkit/`
（action 定义 / JS rules / root helper `pkg-install`）。helper 的安全模型：参数只接受
包名字符集、无 shell 无通配、装前强制只读快照（快照失败即中止——"不存在无快照的
安装窗口"）。

**审计与回放**：全部工具调用结构化落 `audit.jsonl`；canvas 的 `/api/audit` 暴露数据、
`/replay` 渲染时间轴（186 条真实事件实测）；水族馆录屏与审计时间戳对齐构成"回放信任"
（`docs/session-recording.md`）。

## 2.8 呈现层：canvas 与 LibreOffice 外发链路

agent 产出的东西给用户看，走两条通道（`docs/architecture.md` §5）：

- **canvas（生成式 UI）**：本地 HTTP 服务（`packages/canvas/`，systemd user 单元
  `agentos-canvas`，**仅绑 127.0.0.1:7788**），安全托管 `~/Agent/canvas/` 下的 agent
  生成 HTML + 自动索引页。三个内建页：仪表盘类 artifacts（`/` 索引回看）、键位速查
  `/keys`（实时解析 `~/.config/niri/config.kdl` 的 binds 段 + 实时读 Noctalia
  colors.json 配色——双零副本设计，改键位页面自动跟随）、审计回放 `/replay`。
  打开方式：`desktop__open http://127.0.0.1:7788/<名字>/`，或 Super+K 直接进 /keys。
- **LibreOffice 外发链路（office 格式）**：agent 生成 .fodt/.docx 等文件落工作区，
  `desktop__open` 带 `app=libreoffice` 直调（**不要依赖系统 MIME 关联**——实测 Fedora
  把 .fodt 探测成 text/xml 落到 Firefox，`docs/real-machine.md` 2026-10-15）。
  此链路写入行为基线（`os/configs/goose-system.md` §产物与呈现）。

## 2.9 观测层：AT-SPI2 / CDP / 水族馆

agent 的"眼睛和手"，分层兜底（L0 IPC → L1 无障碍树 → L2 浏览器 → L3 视觉，上层能
解决就不下沉，`docs/architecture.md` §4）：

- **AT-SPI2（无障碍树）**：Linux 的 accessibility 总线（一条专用 D-Bus）。GTK/Qt/
  Electron/Chromium/LibreOffice 应用都会把自己的 UI 结构（按钮/输入框/文本，带角色
  与名称）导出成一颗**无障碍树**——本意是给屏幕阅读器用，我们把它当**结构化 UI API**
  用：读树、按名称点击、读写文本，**零截图、零焦点、零 token 浪费**（对齐微软 UFO
  用 UIA 的思路）。实测四条硬结论在 `docs/milestones.md` M3 段（树跨连接重建、
  GTK4 注册才完整、深度 8+、角色名版本差异）。
- **CDP（浏览器）**：§2.6 browser-mcp 已述。
- **水族馆（嵌套会话）**：**为什么虚拟桌面做不到人机并发**（`docs/architecture.md`
  §3 的核心论证）：虚拟桌面属于同一会话、共享同一个 seat——任意时刻全会话只有一个
  获得焦点的 surface，agent 注入的输入会打进用户正在用的窗口，agent 要操作别的桌面
  就得抢前台。与平铺与否无关，Windows/macOS 同理。**解法：给 agent 一个自己的
  compositor 会话**——V1 是嵌套 niri（agent 的 niri 作为主会话里的一个窗口运行，
  有自己独立的 Wayland display 与 IPC socket），输入天然隔离在窗口内，用户可围观，
  截图永远只截自己的输出（隐私边界：用户屏幕物理上进不了 agent 的视野）。V2（headless
  虚拟输出+串流）/V3（真·多 seat）是后续路线。

---

# 第三部分：它们如何配合（端到端走线）

四个场景 + 一张总图。每个场景标注经过的组件与仓库落点。

## 场景 A：用户说"把这个文件夹整理成周报 docx"

一条 T0 为主的流水线，policy 全程放行、全程留痕：

```
用户（goose 会话）:"把 ~/Agent/downloads 里的文件整理成周报"
  │
  ▼ 1. goose 按行为基线选工具（不用 shell）
files-mcp: list_dir / read_file / find_by_name ──T0 allow──→ 审计 JSONL 追加
  │  （沙箱纪律：路径越界防护在 workspace 层兜底）
  ▼ 2. 生成文档
files-mcp: write_file reports/weekly.fodt      ──T0 allow──→ 审计
  │  （产物统一落工作区 ~/Agent/，goose-system.md §产物落位）
  ▼ 3. 调起 LibreOffice 展示
desktop-mcp: open(path, app=libreoffice)
  │  按权限表建议为 T1（动用户桌面）：部署的 policy.yaml 若配 confirm，
  │  此处先经 Confirm1 弹四横幅等用户点选；M1 首次实测时配 allow+审计
  ▼ 4. 告知结果
desktop-mcp: notify("周报已生成并打开")         ──T0（通知是确认通道本身）──→
  │  mako 横幅 → 用户看到
  ▼ 5.（可选）仪表盘版进 canvas
files-mcp: write_file canvas/weekly/index.html → desktop-mcp: open("http://127.0.0.1:7788/weekly/")
```

要点：M1 退出标准就是这条链的实证版（下载→整理→生成 .fodt→LibreOffice 展示→通知，
`docs/milestones.md` M1 完成记录）；agent 中途还自己探测镜像换源恢复了一次坏 URL。

## 场景 B：需要密码的网页登录（零明文机制细节）

```
【图 7：场景 B 时序——明文永远不进模型上下文】

  goose      session-mcp   browser-mcp   cred-mcp(broker)  Secret Service   mako/用户
    │ start水族馆 │             │              │                │              │
    ├────────────▶│ 嵌套 niri 起 │              │                │              │
    │             │ (独立 seat) │              │                │              │
    │ browser_open─────────────▶│ Chromium 无头启动在水族馆内     │              │
    │             │             │ (--password-store=basic：    │              │
    │             │             │  绝不碰用户 keyring)          │              │
    │ cred_autofill(vault://…, 页面)──────────▶│               │              │
    │             │             │              │ secret-tool ──▶│ 取出明文     │
    │             │             │◀─ CDP: 页面内 el.value=明文 +派发 input 事件 │
    │             │             │── 页面内复核: el.value===注入值 (matches)   │
    │             │             │   （明文不出页面/broker 栈帧） │              │
    │◀─ 回执: {matches:true, length:N, sha256:...} ──────────── │              │
    │  （模型上下文里只有哈希与长度——物理上没有明文可泄漏）      │              │
    │ browser_eval(读登录态) / browser_screenshot …             │              │
    │ desktop.notify("已用 vault://bank/login 登录") ──────────────────────────▶│
```

机制细节（`docs/security/credentials.md` §2 通道 A）：非安全上下文（如 data: URL 测试页）
没有 `crypto.subtle`，哈希由 broker 用同一明文补算——值仍不出 broker 栈帧；matches=false
（被前端框架改写）一律拒绝。通道 B/C 的等价纪律：B 子进程环境注入+输出打码+exec_allow
白名单；C 短 TTL+到点收割进程组。prompt injection"读出密码并复述"在这套模型下物理不可为
——agent 没有任何工具能返回明文。

## 场景 C：agent 要装包（T2 全链）

```
【图 8：场景 C——快照 → pkexec/polkit → 审计 → 回滚指引】

  用户:"帮我装 sl" → goose
    │ system-mcp: package_install("sl")
    ▼
  policy 网关 decide → "confirm" + tier=t2 + delegatedConfirm ──审计: confirm.result=delegated
    │ （确认由 handler 内的 polkit 强认证承担，不走 Confirm1 横幅）
    ▼
  PackageInstaller 执行 pkexec /usr/libexec/agentos/pkg-install sl
    │  polkit rules(49-agentos.rules): 本 helper → auth_admin（每次都要密码）
    │  认证框由图形会话里的 lxqt-policykit-agent 承接（niri spawn-at-startup）
    │  （实测：认证框弹出即聚焦，键盘驱动直输密码；ydotool 键盘路径已验证）
    ▼
  root helper（os/polkit/pkg-install）:
    ① 包名字符集校验（拒绝 --config/@group/URL 等一切注入面）
    ② systemctl stop packagekit（实测：packagekitd 会抢 rpm 锁）
    ③ snapper create --read-only agentos-pre-dnf-sl   ← 快照失败即中止！
    ④ dnf install -y sl → 退出码 + AGENTOS_SNAPSHOT=N 回传
    ▼
  审计记录: {tool:package_install, tier:t2, confirm:{result:delegated,by:polkit},
             snapshot:"8"}                ──失败时回复附 snapshot rollback 8 指引
    ▼
  （若事后判定误装）: /replay 时间轴定位事件 → snapper rollback 8 → 重启回滚态
    → dnf remove sl 落定撤销    ——M4 退出标准演示的完整走线
```

实测坑全部记录在 `docs/permissions.md` §4.2 修订与 `docs/real-machine.md`
2026-10-17（packagekitd 抢锁、F44 pkexec 子进程退出后挂死需包超时、本机 fstab 钉死
subvol 使 set-default 回滚不生效——永久化回滚因此指向 M5 bootc）。

## 场景 D：开机自举链（bootc 镜像形态）

```
【图 9：开机自举——从引导器到 agent 就绪】

  固件(UEFI) → bootloader(GRUB/bootc 启动条目，多版本并列=回滚的物理载体)
    ▼
  内核 + 只读 /usr（bootc 部署的 OCI 镜像用户空间）
    ▼
  systemd(PID1) ── systemctl enable sddm（镜像层5 固化）──▶ SDDM 显示管理器
    ▼ 用户登录，选择 Niri 会话（/usr/share/wayland-sessions/niri.desktop）
  niri-session（niri 的 systemd 集成）──▶ 绑定 graphical-session.target
    ├─ spawn-at-startup "mako"                       （通知守护）
    ├─ spawn-at-startup "env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1
    │                    /usr/libexec/lxqt-policykit-agent"（T2 认证代理+可被a11y驱动）
    └─ spawn-at-startup "qs" "-c" "noctalia"          （桌面 shell，layer-shell 表面）
    ▼ graphical-session.target 就绪，user 单元依次启动（镜像线装了这三个）：
  agentos-user-setup.service      ── 默认配置 only-if-absent 复制进 ~/.config/
                                      （源: /usr/share/agentos/defaults/，幂等不覆盖用户改动）
  agentos-goose-firstboot.service ── goose 缺失则装到 ~/.local/bin（成功盖 stamp，永不阻断登录）
  agentos-canvas.service          ── canvas 服务 127.0.0.1:7788
  （Confirm1 与 goose 常驻单元在 os/systemd/ 供手动部署，尚未进镜像层——
    待核实项：M5 后续是否补进 os/bootc/systemd/）
    ▼
  桌面就绪：niri(平铺) + Noctalia(bar) + mako(通知) + canvas + goose
  用户打开终端（Super+Return → ghostty）→ goose session 或聊天面板 → 开始对话
```

要点：bootc 形态下 SDDM+niri 尚未真机点亮（`docs/m5-atomic.md` §9 遗留）；VM 现役
组合是 GDM（自动登录为测试补配，`docs/real-machine.md`）；`firstboot-config.sh` 的
幂等 only-if-absent 语义与 /etc/skel 方案的取舍在 `docs/m5-atomic.md` §4。

## 全局架构总图

```
【图 10：AgentOS 全局架构——用户 ↔ 桌面 ↔ agent ↔ 系统能力 ↔ 安全层】

┌────────────────────────────── 用户 seat（主 niri 会话）──────────────────────────────┐
│  ┌────────┐ ┌────────┐ ┌──────────────────────┐   layer-shell: Noctalia bar/壁纸    │
│  │ghostty │ │ Firefox│ │ "水族馆"窗口          │   fuzzel 启动器 · swaylock 锁屏      │
│  └────────┘ └────────┘ │ (agent 嵌套会话的投屏) │   mako 通知（Confirm1 四横幅载体）  │
│                         └──────────┬───────────┘                                      │
│        niri（合成器/WM/显示服务器，JSON IPC）· GDM/SDDM（显示管理）                    │
└───────────┬────────────────────────┬──────────────────┬─────────────────────────────┘
            │ niri IPC               │ D-Bus 会话总线     │ Wayland(嵌套)
            │                        │                    ▼
┌───────────▼────────────────────────▼──────┐   ┌──────────────────────────────────┐
│ agent 层：goose（systemd user service）    │   │ agent 会话（水族馆，独立 seat）    │
│  MCP 扩展×8 ──全部经 createGate 策略网关──┤   │  嵌套 niri · Chromium(无头,CDP)   │
│  niri/desktop/system/files/session/       │   │  LibreOffice 等 GUI 长尾应用      │
│  atspi/browser/cred                       │   │  grim 截图(只截自己) · ydotool兜底 │
│  cred-mcp → Secret Service(gnome-keyring) │   └──────────────────────────────────┘
│  canvas(127.0.0.1:7788) · Confirm1        │
└───────────┬───────────────────────────────┘
            │ T2: pkexec/polkit(root helper+快照)   · systemd 系统总线 · portal
┌───────────▼─────────────────────────────────────────────────────────────────────────┐
│ 系统能力层：dnf/包管理 · systemd 服务/日志 · 文件系统(~/Agent 沙箱) · 网络 · DRM/KMS   │
│ 信任底座：bootc 原子更新/回滚（镜像态）· btrfs+snapper 快照（Workstation 态）· 审计   │
│           ~/.local/state/agentos/audit.jsonl ← 全部工具调用结构化落盘 → /replay 回放  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

# 附录

## A. 术语速查表

| 术语 | 一句话 |
|---|---|
| DRM/KMS | 内核显卡子系统/显示模式设置；谁能当 DRM master 谁控制输出 |
| 合成器 compositor | 把各窗口 buffer 合成最终画面的进程；Wayland 下它就是显示服务器 |
| wl_surface / wl_buffer / commit | Wayland 的"可显示表面/像素画布/这一帧画好了"三元组 |
| seat | 一组键盘鼠标+屏幕的逻辑座位；焦点在 seat 内唯一 |
| libinput | 内核输入事件的规范化库，合成器用它读键鼠 |
| XWayland / xwayland-satellite | 让 X11 遗留应用跑在 Wayland 会话里的兼容桥 |
| systemd user 单元 | 每用户一份的服务管理；我们的 canvas/confirm/goose 都是其服务 |
| graphical-session.target | "图形会话已就绪"的用户级 target，桌面服务挂靠它 |
| logind | 登录/会话/seat 管理，分配 /run/user/<uid> 运行时目录 |
| D-Bus（系统/会话总线） | 桌面 RPC+事件总线；系统服务 vs 用户会话进程各一条 |
| polkit / pkexec | "这个特权动作允许谁做"的仲裁 / 以受控方式提权执行白名单程序 |
| xdg-desktop-portal | 沙箱应用的授权层（文件选择/截屏等），Request/Response 风格 |
| Secret Service / keyring | freedesktop 凭据存储标准接口 / 其实现（gnome-keyring） |
| libsecret / secret-tool | Secret Service 的客户端库 / 命令行工具 |
| PipeWire / WirePlumber | 现代音频视频路由守护进程 / 其会话管理器 |
| org.freedesktop.Notifications | 会话总线上的通知标准接口；mako 是它的实现者 |
| 平铺式 tiling | 窗口不重叠自动分屏的窗口管理范式 |
| 动态/手动/滚动平铺 | 自动重切（dwm/Hyprland）/用户下刀（i3/Sway）/无限横带（niri） |
| 工作区 workspace | 虚拟屏幕，任务分组单位 |
| layer-shell | 状态栏/启动器等外壳件的 Wayland 专协议（锚定/层级/专属区） |
| KDL | niri 配置用的声明式文档语言，保存即热重载 |
| app-id | Wayland 应用自报的标识，niri 窗口规则按它匹配 |
| ext-background-effect-v1 | 跨桌面背景特效协议（模糊等）；niri 26.04 实现 |
| QuickShell / QML | 用 Qt 声明式语言写桌面 shell 的框架 / 该语言本体（Noctalia 基于它） |
| MCP | Model Context Protocol：模型宿主与工具服务间的 JSON-RPC 标准（stdio 最常见） |
| CDP | Chrome DevTools Protocol，浏览器自动化/调试协议（WebSocket） |
| AT-SPI2 | Linux 无障碍总线；应用的 UI 结构树（读+操作，无需焦点） |
| 水族馆 | agent 的嵌套 niri 会话：输入隔离、截图只截自己 |
| bootc / OCI 镜像 | 把整个用户空间做成容器镜像、原子更新/回滚的发行形态 |
| btrfs / snapper / 快照 | 写时复制文件系统 / 快照管理器 / 子卷级时间点副本 |
| goose | 我们的 agent 引擎：会话循环+MCP 扩展宿主，集成不 fork |
| T0/T1/T2 | 免批准只审计 / 弹确认 / 强认证+快照 三档权限 |
| Confirm1 | org.agentos.Confirm1：我们的 T1 确认 D-Bus 服务（四横幅载体） |
| cred broker 三通道 | 自动填充(A)/代执行(B)/短期注入(C)——明文不出 broker 栈帧 |
| policy 网关 / createGate | 全部 MCP 工具统一过 decide→审计→(确认)→执行 的注册层 |
| 审计 JSONL | ~/.local/state/agentos/audit.jsonl，全部工具调用的结构化流水 |
| canvas | 本地 127.0.0.1:7788 的生成式 UI 服务（/ /keys /replay） |
| ydotool / uinput | 写内核虚拟输入设备来注入输入的工具 / 虚拟输入设备接口 |
| grim / wlr-screencopy | 截图工具 / 其底层 Wayland 截屏协议 |
| SDDM / GDM | 显示管理器（登录界面）：镜像线选 SDDM / VM 现役 GDM |
| GDM/MIME/xdg-open | 打开文件的系统关联机制；实测不可靠，故 desktop.open 带 app 参数 |
| ADR | 架构决策记录（如 ADR-0001 基座选型） |
| GLM / Anthropic 兼容端点 | 我们的模型 provider 走 /api/anthropic 端点（goose-integration.md） |

## B. 想深入（少量精选）

**协议与机制（按本手册章节顺序）**：
- Wayland 书档与协议库：wayland.app（协议文本）；`wayland-info` 命令看合成器广播了哪些接口
- wlr-layer-shell：wayland.app/protocols/wlr-layer-shell-unstable-v1
- ext-background-effect-v1：wayland.app/protocols/ext-background-effect-v1；
  niri Window Effects 文档（niri-wm.github.io/niri/Window-Effects.html）
- systemd 用户服务与 target：Freedesktop 文档 "systemd for Developers"；
  graphical-session.target 的 man 页
- xdg-desktop-portal：github.com/flatpak/xdg-desktop-portal（接口与 backend 机制）
- Secret Service：freedesktop.org 的 specification 页；pam_gnome_keyring 手册
- polkit：www.freedesktop.org/wiki/Software/polkit（actions/rules/pkexec 三件套）
- MCP：modelcontextprotocol.io（规范）；SDK 即我们用的 @modelcontextprotocol/sdk
- CDP：chromedevtools.github.io/devtools-protocol
- AT-SPI2：GNOME Accessibility wiki（linuxfoundation 的 accessibility 汇总）

**上游项目（我们只集成不 fork 的三方）**：niri（niri-wm/niri，wiki 是配置圣经）、
goose（aaif-goose/goose）、Noctalia（noctalia-dev/noctalia）、QuickShell、ghostty、
mako、fuzzel、swaylock、grim、bootc（docs.bootc.io）、Bazzite（镜像参考实现）。

**仓库内的对应文档（本文的事实源）**：`docs/architecture.md`（总架构）、
`docs/permissions.md`（三档权限）、`docs/security/credentials.md`（凭据三通道）、
`docs/m5-atomic.md`（bootc）、`docs/noctalia.md`（shell 选版与毛玻璃）、
`docs/ghostty.md`（终端与毛玻璃实证）、`docs/real-machine.md`（全部实测与排错）、
`docs/session-recording.md`（录屏）、`docs/goose-integration.md`（接入）、
`DEVLOG.md`（落地日志）。

---

*本文为一次性补课手册，不替代上述专项文档；两者冲突时以专项文档与源码为准。*
