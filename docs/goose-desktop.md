# goose desktop：AgentOS 首要用户入口

> 结论先行：**上游有 Linux aarch64 官方包**（RPM/deb/Flatpak，1.55 起全架构同发），
> 无需自建或走 TUI 替代。已落地：RPM 安装 + niri 开机自启 + Super+G 唤起 +
> GLM key 注入 + MCP 工具链实测跑通（真实对话调 niri 扩展列窗口成功）。
> 全部踩坑与证据见下文，2026-10-18 真机（Fedora 44 aarch64 VM）逐条实测。

## 1. 发布形态调研（2026-10-17/18）

- 仓库已从 `block/goose` 迁移到 **`aaif-goose/goose`**（API 301 重定向可证），
  desktop 在 `ui/desktop/`：**Electron Forge + Vite + React**，非 Tauri；
  运行时内置 goose CLI（`resources/bin/goose`）并通过 **ACP**（`goose serve --tls
  --platform desktop --port <随机>`）驱动它——desktop 是壳，agent 本体还是 CLI，
  配置 `~/.config/goose/config.yaml` 与 TUI 完全共用（MCP 扩展、provider 一份配置两处生效）。
- release 资产（v1.55.0，2026-10-16 发布）Linux 全家桶，**aarch64 与 x86_64 对等**：
  - RPM：`Goose-1.55.0-1.arm64.rpm`（155 MiB 下载 / 598 MiB 落盘）——**我们用的这个**
  - deb：`goose_1.55.0_arm64.deb`；Flatpak：`io.github.block.Goose_stable_aarch64.flatpak`
  - vulkan 变体（`-vulkan` 后缀）给有真 GPU 的机器，VMware 虚拟显卡用普通版
  - 查证：`https://github.com/aaif-goose/goose/releases/tag/v1.55.0`（releases API 资产清单）
- 安装布局：`/usr/lib/Goose/Goose`（Electron 本体）+ `/usr/lib/Goose/resources/bin/goose`
  （内置 CLI 1.55.0，与 `~/.local/bin` 的 1.54 并存互不干扰）+
  `/usr/share/applications/Goose.desktop`（`Exec=/usr/lib/Goose/Goose %U`，
  `MimeType=x-scheme-handler/goose`）。

## 2. 安装（VM 直连 GitHub 被重置，Mac 中转）

```bash
# Mac 下载（VM 上 curl 会超时，实测惯例，见 docs/goose-integration.md）
curl -L -o /tmp/Goose-1.55.0-1.arm64.rpm \
  https://github.com/aaif-goose/goose/releases/download/v1.55.0/Goose-1.55.0-1.arm64.rpm
scp /tmp/Goose-1.55.0-1.arm64.rpm demon@VM:/tmp/

# VM 安装（无额外依赖拉取，自包含 Electron）
sudo dnf install -y /tmp/Goose-1.55.0-1.arm64.rpm && rm /tmp/Goose-1.55.0-1.arm64.rpm
```

bootc 镜像线（os/bootc/）想内置的话同样受 GitHub 直连限制——CI 可达时在
Containerfile 层用 `dnf install <URL>` 即可；首启动兜底安装脚本目前只装 CLI，
desktop 包暂留手工路径（遗留项）。

## 3. 启动器 `scripts/launch-goose-desktop.sh`

所有启动（自启/键位/手动）统一走这个 wrapper，职责四件：

1. **source `~/.config/agentos/goose.env`**：GLM key（`ANTHROPIC_API_KEY`/`ANTHROPIC_HOST`）。
   desktop 内置 CLI 继承 wrapper 环境；不注入则发消息报
   `Configuration value not found: ANTHROPIC_API_KEY`（keyring 里没有，SSH/自启路径
   也没有 shell rc 注入——实测）。
2. **`--ozone-platform=x11`**：走 Xwayland（satellite，`:0`）。见 §5.2——原生
   Wayland 后端在 niri 上窗口永不映射，X11 路径 100% 稳。
3. **`--force-renderer-accessibility`**：Chromium 系必须启动前开无障碍树（DEVLOG
   2026-10-18 Chromium 结论），atspi 桥因此能读 goose 窗口。
4. **`--password-store=basic`**：Electron safeStorage 不走 libsecret——GDM autologin
   会话下 login keyring 永远锁着，safeStorage 默认路径会弹 gcr 解锁框并把 desktop
   启动卡死 30 秒（serve healthcheck 超时，实测）。我们没有任何凭据依赖 safeStorage。

## 4. 开机自启 + 键位

niri 配置（VM `~/.config/niri/config.kdl` 已部署，模板同步在
`os/configs/niri/config.kdl`，`niri validate` 通过）：

```kdl
// goose desktop（Electron 图形版，用户交互首要入口）
spawn-at-startup "/home/demon/AgentOS/scripts/launch-goose-desktop.sh"

// Super+G 唤起：Electron 单实例锁 → 二次启动走 second-instance → 聚焦已有窗口
Super+G hotkey-overlay-title="Goose" { spawn "/home/demon/AgentOS/scripts/launch-goose-desktop.sh"; }
```

- 选 `spawn-at-startup` 而非 systemd user 单元：GUI 应用跟着 compositor 生命周期走
  最自然；且实测 systemd-run --user 路径曾因 env 缺 `DISPLAY` 等多踩一脚（见 §5.2
  排查记录），无收益。
- **重启实测**（2026-10-18）：GDM autologin → niri 起 → goose 窗口自动出现并获得
  焦点，`niri msg -j windows` 见 `goose | Goose`；状态栏任务栏正常显示 Goose 图标
  + 文字（app_id 为小写 `goose`，X11 路径来自 WM_CLASS）。
- 二次启动实测：进程数不变（单实例锁生效），窗口被聚焦——Super+G 行为等价已验。

## 5. 踩坑实录（按发现顺序，均已定论）

### 5.1 login keyring 锁死 → gcr 弹窗卡死启动

GDM autologin 不经过密码认证，`login.keyring` 永远锁着。desktop 一启动，栈里
某处（Electron safeStorage / 内置 CLI 的 keyring 读取）触发 `gcr-prompter`
"Unlock Login Keyring" 弹窗，serve 就绪探测 30 秒超时 → 窗口显示
"Goose Failed to Start"。

处理（两层）：

- `--password-store=basic` 摘掉 safeStorage 这条线；
- 把锁死的 `~/.local/share/keyrings/login.keyring` 移走（VM 上备份为
  `login.keyring.bak-20261018`，内含条目为空——`secret-tool search` 两种姿势都查无，
  密钥实际全走 `~/.config/agentos/`）。移走后无任何弹窗，CLI 环境变量路径不受影响。
  该 keyring 密码非登录密码（实测 123456 不对），本机无人能解锁，留着只会再卡。

> 遗留注意：`user.keystore`（goose 自己的 collection）仍在；目前无人碰它。
> 若未来 goose 桌面端加"保存密钥"功能并写入 default collection，无钥匙环环境下
> 会再弹新建密码框——届时优先考虑给会话配空密码 default keyring（kiosk 常规做法）。

### 5.2 Electron 原生 Wayland 后端：窗口永不映射（本次最深的一个坑）

**现象**：最初两次启动（19:49/19:53）窗口正常；之后无论 niri spawn / ssh /
systemd-run、重启 VM、重置 `~/.config/Goose`，窗口都不再出现——但进程树完整
（main/zygote/gpu/renderer/serve 全在），serve healthcheck 249ms 成功，
CDP 里 `document.visibilityState=visible readyState=complete`，renderer 一切正常，
唯独 niri 窗口列表为空，niri 事件流无 Window opened。

**排查**（排除法全程实测）：stdio 重定向、env 内容（`env -i` 最小集 + 逐组注入
对照）、fd 上限（prlimit 对拍）、setsid、cgroup、seccomp/dumpable 状态、
`--disable-gpu`、`XDG_ACTIVATION_TOKEN`/`DESKTOP_STARTUP_ID`、journal 流、
memory-pressure 变量——全部无关。期间还发现一个假线索：/tmp 的 kill 脚本重启后
消失导致"杀干净"是假的，Electron 单实例锁把后续测试全变 second-instance，
一度污染半数实验结论（pkill 自匹配自杀也贡献了两次 exit 255）。

**定论证据链**：

- `WAYLAND_DEBUG=1` 抓包：客户端 `wl_registry.bind(xdg_wm_base)` 之后**再无
  `get_xdg_surface`**——Chromium Wayland 后端在建 surface 前停摆；
- 对照实验：同机同时刻，`XDG_SESSION_TYPE=tty` 的 ssh 会话启动 → `ozone-platform=x11`
  → 窗口立现；原生 wayland（`XDG_SESSION_TYPE=wayland` 或显式
  `--ozone-platform=wayland`）→ 无窗。**单变量复现**；
- 可行实例 ps 佐证：`--type=gpu-process --ozone-platform=x11`，经 Xwayland
  satellite（`:0`，rootless）出窗。

**处理**：wrapper 固定 `--ozone-platform=x11`。注意
`ELECTRON_OZONE_PLATFORM_HINT=auto` 在我们环境是**坑**：niri 会话
`XDG_SESSION_TYPE=wayland` 会让 auto 选中 wayland 后端，正中靶心。
上游修复（Electron/Chromium ozone-wayland 与 niri 的交互）后可回归原生 Wayland，
届时把 wrapper 里那行换回 hint=auto 即可。

### 5.3 其他小坑

- gcr 弹窗本身可被 a11y 桥驱动（读树/输密码/点按钮全通）——但密码不对就是不对；
- Electron 打日志要 `ELECTRON_ENABLE_LOGGING=1`；CDP 要 `ENABLE_PLAYWRIGHT=1`
  （端口 `PLAYWRIGHT_DEBUG_PORT`，默认 9222）且加 `--remote-allow-origins=*`
  （Chromium 111+ 拒绝无 origin 的 ws 连接）；
- 下载 155MiB 大件建议 `curl -C - --retry`——GitHub release 中断一次很正常。

## 6. 验证记录（2026-10-18）

1. **MCP 工具链端到端**：desktop 输入框（CDP `Input.insertText` + Enter）发
   "请用 niri 扩展的工具列出当前所有窗口的 app_id 和标题"→ 工具徽章
   **List Windows** 执行（niri MCP 扩展在 desktop 内置 CLI 侧生效）→ 回复
   "当前只有 1 个窗口：goose | Goose"（模型 glm-5.3-flash，$0.00）。截图
   `goose-desktop-02`。**同一份 config.yaml，TUI/desktop 两端共用扩展，零改动。**
2. **自启**：重启后窗口自动出现并聚焦（截图 `goose-desktop-04`）。
3. **状态栏**：Noctalia 任务栏正常显示 goose 图标 + 文字（X11 app_id=`goose`，
   截图 03/04 可见）。
4. **首启引导**：无 onboarding 卡点——provider/model 从 config.yaml 继承
   （界面直接显示 glm-5.3-flash），key 从 env 进，装完即用。

## 7. a11y 可达性（agent 能否操作 goose desktop）

- **读：通**。`--force-renderer-accessibility` + atspi 桥（`scripts/atspi_bridge.py`）
  可读完整树：菜单（文件/编辑/视图/窗口）、document web、会话区结构，X11/Wayland
  模式无差别。
- **驱动：同 DEVLOG 既有结论**——AT-SPI `clickAncestor` 派发返回 true 但页面不执行
  （Chromium 系限制）；输入聚焦拿不到可编辑节点（富文本编辑器懒暴露）。
  **可靠驱动路径是 CDP**：`ENABLE_PLAYWRIGHT=1` + `--remote-allow-origins=*`，
  `Input.insertText`/`dispatchKeyEvent` 实测可发消息（本次对话验证即走此路）。
  若未来要把"操作 goose desktop"做成 MCP 扩展，直接复用 browser-mcp 的 CDP 经验。

## 8. 与既有组件的关系

- `agentos-goose.service`（os/systemd/，草稿）：`goose serve` 常驻 + desktop 走
  `GOOSE_EXTERNAL_BACKEND` 指过去的架构**可行且被上游支持**（本次实测外部后端
  模式能连通），但当前落地选了"desktop 自管 serve"（零额外服务、窗口关闭即会话
  留存于本地）。M0 服务化转正时二选一即可，config 不用动。
- 悬浮球（agentos-orb）与 desktop 并存：orb 是状态展示/确认提醒，desktop 是对话
  主入口，职责不重叠。
- TUI（`goose session`）继续可用，同一配置同一会话目录。

## 9. 磁盘账本

RPM 落盘 598 MiB（VM 18G 盘，装后余 6.8G）。安装包用完即删，不留缓存
（`dnf clean` 亦无 metadata 残留，本地 rpm 安装不产生 repo 缓存）。
