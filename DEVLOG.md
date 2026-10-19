# 开发日志（DEVLOG）

> 按日期倒序记录每次落地的工作与决策；**待办清单在本文末尾**。
> 项目说明见 [README.md](README.md)；里程碑定义与逐项完成记录见
> [docs/milestones.md](docs/milestones.md)（本日志不重复其内容，只记"今天落了什么"）。

---

## 2026-10-19（settings-ui：AgentOS 自己的系统设置页 + 凭据管理 + 多机器迁移）

worktree `feat/settings-ui`。三个系统级功能一轮落地：①canvas `/settings` 设置页
（外观/凭据/系统/迁移四分区，与 /keys /replay /artifacts 并列，桌面条目
`agentos-app-settings.desktop` 独立窗口）；②凭据管理 UI（列表/一键吊销三步事务）；
③`agentos-state-export/import.sh` 状态迁移（only-if-absent + 差异报告，docs/migration.md）。

- **外观切换的真话**：实测只调 `agentos-settings apply --dark` 会被 daemon watcher
  按真相（noctalia settings.json 的 darkMode）立即回滚。页面按钮改为
  翻真相（只动 colorSchemes.darkMode 一个键）+ CLI apply auto 收敛；
  像素抽查状态栏 #efefde→#302f23 全系统联动。
- **凭据零明文（UI 侧对应物）**：keyring 只用 `secret-tool search --all` 探存在性
  （lookup 连存在性检查都不许）；吊销 = clear → yaml 缩进块手术（保注释、写前 YAML
  校验、tmp+rename 原子）→ 审计 credential_revoke；全程明文 grep 零命中（VM 实测）。
- **迁移脚本三枚坑**：①collect 相对路径少了 `.config` 的点（打了个只含 goose.env 的
  包还以为自己环境抖动）；②`$VAR` 后紧跟全角字符会被 bash 并进变量名（set -u 误报
  unbound）——一律 `${VAR}`；③`diff` 有差异时 exit 1 × pipefail × set -e 把导入杀在
  半路（VM 命中：出差异报告后剩余文件全漏装）——diff 管道 `|| true`，且报告里
  KEY=value 双侧打码。
- **chromium X11 后端**：本机 chromium 默认 X11，ssh/启动器起 `--app` 直接报
  Missing X server——桌面条目必须 `--ozone-platform=wayland`（browser-mcp 同款），
  另加 `--disable-gpu` + 隔离 user-data-dir 才稳定（GPU transient failure/zygote 断管道）。
- **sudoers 只读条目**（VM）：`/etc/sudoers.d/agentos-snapper-readonly`——仅
  `snapper --jsonout -c root list` 两条 NOPASSWD，让设置页快照分区可用；
  无此条目时页面如实报错（snapper 要 root 是事实，不藏）。
- 测试：全仓 298/298（基线 270 + canvas 新增 28：吊销事务 fixture、策略块手术、
  路由 405 白名单、search-never-lookup）。文档：settings-ui.md（新）、migration.md（新）、
  settings-daemon.md §7 UI、theming §7 消费方表改四页。
- 遗留：1Password/Bitwarden 后端接入、首次启动分步引导、暗色档页面实拍留档。

---

## 2026-10-18（深夜追加四：goose desktop 落地——首要用户入口 + 两枚深坑定论）

worktree `feat/goose-desktop`。目标：goose 图形版开机自启，成为与用户对话的首要入口。

- **调研**：上游 `block/goose` → `aaif-goose/goose`（API 301 实证）。desktop =
  Electron Forge + Vite + React（`ui/desktop/`），运行时内置 goose CLI 经 ACP
  （`goose serve --tls --platform desktop`）驱动，与 TUI 共用
  `~/.config/goose/config.yaml`。v1.55.0（10-16 发布）**有 Linux aarch64 官方
  RPM/deb/Flatpak**——不存在"要自建/要 TUI 替代"的问题。走 RPM（155MiB 中转 scp，
  落盘 598MiB，VM 余 6.8G）。
- **坑一（keyring）**：GDM autologin → login keyring 永锁 → desktop 启动即弹
  gcr 解锁框，serve 就绪探测 30s 超时（"Goose Failed to Start"）。双层解：
  `--password-store=basic`（safeStorage 不走 libsecret）+ 移走锁死的
  `login.keyring`（备份 `.bak-20261018`；内含为空、密码非登录密码——123456 实测
  不对，a11y 桥输密码点 Unlock 亲测报"密码错误"）。
- **坑二（Electron 原生 Wayland）**：窗口现象级消失——进程全活、serve 249ms 就绪、
  renderer `visibilityState=visible`，唯独 `get_xdg_surface` 永不发出
  （WAYLAND_DEBUG 定论）→ niri 永不映射。排除法烧了整个晚上（env 内容/stdio/
  fd 上限/setsid/cgroup/seccomp/disable-gpu/activation token 全部无关；期间
  /tmp kill 脚本重启蒸发导致单实例锁把测试变 second-instance，污染了半数结论）。
  单变量定论：**`XDG_SESSION_TYPE=wayland`+hint=auto 选中 wayland 后端即触发；
  X11 路径（Xwayland-satellite）100% 出窗**。wrapper 固定 `--ozone-platform=x11`。
  上游修复前不再碰原生 Wayland。
- **落地**：`scripts/launch-goose-desktop.sh`（goose.env 注入 + x11 + a11y +
  basic 密钥库四合一）；niri `spawn-at-startup` 自启 + `Super+G` 唤起（Electron
  单实例 → 二次启动聚焦，实测）；重启验证：窗口自动出现并聚焦、状态栏 goose
  图标正常（app_id 小写 `goose`，X11 来自 WM_CLASS）。
- **端到端**：CDP（`ENABLE_PLAYWRIGHT=1`+`--remote-allow-origins=*`）驱动 desktop
  发"用 niri 扩展列出所有窗口"→ **List Windows** 工具执行 → glm-5.3-flash 回复
  正确列表。MCP 扩展零改动两端共用。a11y：树可读（菜单/文档/会话结构），
  点击派发同 Chromium 限制不执行——驱动归 CDP，与昨日 a11y 结论一致。
- 文档：新建 `docs/goose-desktop.md`（调研/安装/双坑实录/验证记录全量）。

---

## 2026-10-18（深夜追加五：settings-daemon——主题编排收编常驻进程）

worktree `feat/settings-daemon`。缝合桌面的"钩子链编排"（Noctalia 三钩子 → theme-apply-all.sh
→ 五个 shell 桥，色板 heredoc 重复四份）收编为 TS 常驻进程 `packages/settings-daemon`
（bin `agentos-settings`，ADR-0002）。为什么 TS：复用 monorepo 栈与 @agentos/proc 基建一轮落地；
用户长期方向全项目 Rust，已记档，届时接口不变换语言。

- **架构**：watcher（colors.json=Noctalia 覆写事件源 / settings.json darkMode / 两色板）→
  applyTheme 编排器（theme-apply-all 语义照搬）→ 五桥共享 palette 模块（双键映射/blend 银行家
  舍入/变体检测/8 位色）；状态快照 ~/.config/agentos/settings-state.json（v1 真相仍来自 noctalia
  现有文件，不另立）；D-Bus org.agentos.Settings（dbus-next configureMembers 非装饰器注册；
  属性 darkMode/paletteVariant + Apply(s)/Reload() + 信号 Changed）+ unix socket JSON 降级通道。
- **环保护（最大坑）**：自己写 colors.json 会再触发 watch。三道闸：writeIfChanged 幂等写（内容
  一致不写）→ 250ms 防抖 + sha256 内容哈希（已见/自写哈希皆不上行）→ 目录级监听防 rename 丢事件。
  VM 全时段日志审计：事件上行仅 2 次（两次真实外部事件），自写回声全部"去重跳过"，零循环。
- **职责迁移**：Noctalia 三钩子清空（enabled 保留）；theme-apply-all.sh 改薄壳转发 CLI；旧五桥
  保留加"已收编"头注。systemd 用户单元 agentos-settings.service（graphical-session +
  Restart=on-failure）；ghostty 热重载在无会话 env 的 systemd 环境下从 niri socket 名推导
  WAYLAND_DISPLAY（niri.wayland-1.1437.sock → wayland-1，实测注入成功）。
- **测试 40 个**（全仓 `npm test` 绿）：五桥与旧 shell 桥**字节级对拍**（暗/浅双档，抓出并修正
  python round 银行家舍入 vs Math.round 的 1 色差）；环保护四态 + 端到端拓扑；编排/状态映射。
- **VM 像素验证（192.168.54.130，双档）**：同会话同壁纸 A/B——daemon vs 旧桥原版脚本：
  浅档 ghostty/bar/通知 **逐像素一致**（#f3f5ec/#d8d8d5/#f0efe8）；暗档 bar #22211d、通知
  #37362f（=键精确命中）、计算器暗橄榄+米白=键、ghostty 同一开窗热重载翻暗（#32332d）——
  与旧链基线一致。`qs -c noctalia ipc call darkMode toggle` → settings 事件→全桥应用 ~40ms；
  Noctalia 覆写 colors.json → 重落；启动收敛全"同"（幂等零写）。D-Bus busctl 全通（introspect
  与规格一致、Changed 信号 light/dark 实收）。附带发现：daemon 追加的 gsettings color-scheme
  同向翻转在 VM 实测生效（'default'/'prefer-dark'）。
- **遗留**：canvas 设置页接入（读 state 或 D-Bus）、更多状态源（壁纸/键位）、Rust 迁移时序。
  VM 桌面还原：暗档、仅 goose、daemon active。（注：VM 上有一个不属本次工作的暗色浮层
  ——AgentOS-m4 的 agentos-confirm 服务横幅，采样期间常驻屏幕中央，未动。）

---

## 2026-10-18（深夜追加三：a11y 覆盖长尾——Qt/Chromium/X11 定论 + 注入升级）

worktree `feat/a11y-coverage`。目标：把能力矩阵 L1 的 ⚠️/❌ 清干净——每格 VM 实测定论。

- **Qt ⚠️→✅**：`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` 落 `/etc/environment`（PAM 载体，
  SSH/GDM 会话通吃），重启持久全链验证（niri 进程 environ → spawn-sh 的 PyQt5 探针窗自动
  注册 → settext/click/texts 读回"你好，重启后"）。载体 `dnf install python3-qt5`（29 包，
  未拉 KDE）。意外发现：本机 at-spi2 新版下 **PyQt5 不带 env 也默认注册**（Qt5 检测路径变化），
  env 保留作显式保证。修复桥：**QLabel 不实现 AT-SPI Text 接口**（文本在 accessible name），
  `texts` 对 label/static/heading/paragraph 走 "Text 接口优先、name 回落"。
- **Chromium ⚠️→✅（读/输入）**：根因三层——① `--force-renderer-accessibility`（**browser-mcp
  已默认带**，`AGENTOS_BROWSER_NO_A11Y=1` 可关，单测覆盖）；② `toolkit-accessibility=true`
  必须**先于应用启动**（GNOME 默认 false 时 Chromium 永不注册、事后开无效须重启应用；已
  `gsettings set` 全局持久）；③ 树懒构建需 AT 调 `GetAttributes` 触发（Orca 同路）——桥内建
  `prime_tree()` 自动触发+轮询。实测页面树完整（document web→heading/button/entry/段落）、
  按名读文本 ✅、entry 走 grabFocus+wtype 输入读回 ✅；**按钮 doAction 派发 true 但 onclick
  不执行**（两会话复现，如实定论：页面点击归 L2 CDP）。Electron 文档化同 flag（VS Code 另
  需 editor.accessibilitySupport）。
- **X11 ❌→分层定论**：xwayland-satellite 0.8.2 在位在跑（:0）。xterm 能跑但无树（xorg-x11-apps
  已被 Fedora 41+ 移除，xterm 为替代载体）；**GTK3 强制 X11 后端全通**（atk-bridge 走 DBus
  与显示后端无关，settext/click/texts "你好，深潜"读回）；**GTK4 X11 后端不注册**（gtk4 a11y
  桥绑 Wayland）。
- **Java ❌（路径文档化）**：完整 JDK + `-Dswing.defaultlaf=...GTKLookAndFeel` + 内置 atk-bridge
  （JDK 11+ 随 JDK），详见 capabilities.md 附录 B。
- **注入升级**：新增 `scripts/kb-inject.sh`（type/type-slow/key）——wtype 优先（用户级无需
  sudo），ydotool 回落（sudo+正确 socket）。实测边界全入注释：文本/组合键（ctrl+shift+comma
  →ghostty 热重载）可靠；**纯控制键（Return/Tab）wtype 对 GTK 不触发**（space 却能进字）、
  CJK 丢首字符（"潜航员甲"→"航员甲"）——控制键走 ydotool，关键输入树读回核对。
- **矩阵收口**：capabilities.md 五行更新（Qt ✅、Chromium ✅读/输入、Electron ⚠️文档化、
  X11 分层、L3 拆 wtype/ydotool 两行）+ 附录 A 补全 + 新附录 B 四节；SKILL.md §0/§2/§4/§5
  同步。npm test **230 全绿**（229 基线 + browser-mcp flag 新测试）。
- 运维教训两条：`pkill -f` bracket 技巧只在模式串与命令行其他内容隔离时有效——同一 ssh
  命令里出现真名（spawn/nohup 行）即自杀（本轮两次踩中，拆调用解决）；VM 的 /tmp 在重启后
  清空，测试脚本要重建。

## 2026-10-18（深夜追加二：系统主题联动三件套——调度器/GTK 桥/双变体）

worktree `feat/theme-sync`。目标：换壁纸或切暗亮时，状态栏/通知/启动器/终端/全部
GTK 应用/自研 UI 一起跟随莫兰迪色板。

- **浅色变体生成器 `scripts/gen-palette-variant.py`**：规则驱动从暗色规范板推导
  （surface 系→暖白米灰 #f5f4f0 系、on_*→深暖文字、主色深一档保对比度 #76725c、
  container→浅 tint、饱和度全程压住），输出同构 72 键入仓 `colors-light.json`。
  非硬编码——换壁纸重生成暗色板后可重跑跟随。
- **GTK 桥 `scripts/theme-gtk.sh`**：覆盖面最大的桥。gtk-4.0/gtk.css 用
  `@define-color` 覆盖 libadwaita 命名色 35 项（accent/window/view/headerbar/
  popover/card/dialog/sidebar/borders/语义色），gtk-3.0/gtk.css 用旧色名 theme_*
  单独映射 22 项；BEGIN/END 标记块幂等。与 settings.ini 共存（光标/图标/字体行
  不动），仅按变体**单行翻转** gtk-application-prefer-dark-theme——浅色板配
  libadwaita 暗色样式会出斑，必须联动。变体由 surface 明度自动识别。
  坑：`pkill -x` 有 15 字符上限（gnome-calculator 关不掉），`pkill -f` bracket
  技巧在**同脚本里既有 spawn 字面量又有 pkill** 时会误杀自 shell（255）——
  spawn 与 pkill 分开调用。
- **统一调度器 `scripts/theme-apply-all.sh`**：读 settings.json
  colorSchemes.darkMode 选变体（--dark/--light 强制），export
  AGENTOS_COLORS_JSON 后依次跑五桥，末尾结果一览；单桥失败不中断；缺浅板回落
  暗档。apply-lanrhyme-theme.sh 部署双变体并改跑调度器；Noctalia 三钩子
  （darkModeChange/wallpaperChange/colorGeneration）全部改指调度器——切档时
  Noctalia 先覆写 colors.json，钩子按最新 darkMode 重落对应变体。
- **VM 实测全过（像素采样）**：
  - 暗档：状态栏 #dad8ce（胶囊主色精确）；计算器对照组无 css #3e3e41 冷调
    （R−B=−3）vs 套色 #414039 暖调（R−B=+8），且 surface_container #37362f
    （标题栏）×3576、surface #21201c ×1078、primary #dad8ce（=键）×386、
    on_surface #f3f3f2 ×35 精确命中；fuzzel 底 #35342e（#37362f@94%）+ 选中行
    #3d3b34 精确；ghostty 新窗 #33342e 暖族（0.85 透明+模糊下的 #21201c）；
    mako critical 底 #3d3b34 精确 + #dad8ce 描边 ×453。
  - 切浅（`qs -c noctalia ipc call darkMode toggle` +4s）：colors.json 已是浅变体
    （surface #f5f4f0、mPrimary #76725c、88 键蛇形+m 驼峰双保留）；计算器
    container #f0efe8 ×3171 + surface #f5f4f0 ×933 + primary #76725c ×386 +
    on_surface #282822 精确命中，两套 settings.ini prefer-dark 自动翻 false；
    状态栏 #76725c 精确；mako #f0efe8 精确；Super+K 浮层 #e9e8e1 暖浅族。
  - 切回暗：colors.json 回 #21201c；浮层重开后 #3d3c36 暖深族 ✓（浮层 spawn 时
    读 colors.json，运行中不热重载，重开即跟随——预期行为）。
- **遗留**：Qt/Kvantum 未做；编辑器类（VSCode 等）主题未接；浮层/ orb 热重载
  （需 FileWatcher，低优）。


---

## 2026-10-18（深夜追加：Noctalia"面板打不开"事故排查 + 0006 加固）

worktree `fix/noctalia-panel`。用户午报"设置/启动面板打不开，重启不复位"。

- **排查结论（证据链完整，见 docs/noctalia.md §11）**：故障窗口锁定在 10:01 起的
  长驻实例（by-id `nlt1pxy2nt`，11:47:34 被杀）。**11:47 重启后用户自己的四张排障
  截图（11:56/12:05/12:06/12:11）里设置面板全都开着**——"重启不能复位"不成立；
  唯一有实锤的失败是 11:58 launcher 一次走了 fuzzel 兜底（单次 IPC 非 rc0 抖动，
  后续 5 连测不复现）。故障实例 stderr 被 `/dev/null` 吞（Noctalia Logger WARN/ERROR
  只走 stderr），app 级证据全灭，单一根因不可考。排除项：desktop 文件、niri 改绑
  （无 layer-rule）、colors.json m 驼峰键、quickshell 0.3 API 遗留（全树 grep 干净）。
- **0006 补丁**（上游两个可精确复现该症状类别的脆弱点，双基线通用）：
  ① SmartPanel open 看门狗从 `onLoaded` 末尾提前到 `open()` + onLoaded 链 try/catch
  强制可见 + Loader Error 告警——修"面板卡已打开不可见（键盘独占+压暗）直到重启"；
  ② CurrentScreenDetector 800ms 超时恢复——修"多屏检测挂起后所有面板 open IPC 被
  静默丢弃"。已部署 agentos-vm。
- **可观测性**：新增 `scripts/noctalia-restart.sh`（bracket pkill + stderr 带时间戳
  追加到 `~/.cache/noctalia/shell-stderr.log`）——qslog 只有引擎级日志，下次面板
  问题有 stderr 可查。
- **全套验证过**（layers 独占随开合翻转 + 截图）：settings open/首次、settings
  toggle×5、agentos-launcher×5（零 fuzzel 兜底）、launcher clipboard 模式、bar 右键
  菜单、铃铛/ControlCenter widget 点击、ydotool 真键盘 Esc 关闭、收尾桌面干净。

## 2026-10-18（晚追加：视觉语言统一第一批——fuzzel + Super+K 浮层）

worktree `feat/visual-unify`。两交付，全部 VM 实拍像素级验证：

- **fuzzel 启动器主题化 ✅**（`scripts/theme-fuzzel.sh`，模式同 theme-mako.sh：colors.json
  取色、AGENTOS_COLORS_JSON 可覆盖、lanrhyme 同值兜底）：奶油白默认配色 → 莫兰迪卡片
  （底 #37362f 94%、选中 #3d3b34、匹配高亮 primary、描边 #6c6a61、圆角 12、anchor=top
  顶部居中悬浮）。**两个 fuzzel 1.14 的坑**：圆角/描边在独立 `[border]` 小节（[main]
  里写 border-radius 会报 not a valid option 且疑似中断后续解析）；颜色**只认 8 位
  #RRGGBBAA**，6 位静默回落默认色（第 1 轮描边一直渲染 #002b36 定位了半天才明）。
- **Super+K 浮层重做 ✅**（`os/configs/hotkeys/shell.qml`）：近全屏面板（用户否决态）
  → **顶部居中悬浮卡片**：宽 min(50%, 680)、高 min(68%, 余量)、topMargin 64（状态栏
  37px 下留 27px）、圆角 12 / 描边 2px / 底 93% surface_container——与 mako/fuzzel 同
  档位。行式保留"键列 + 固定起点箭头说明列"，配色结构对齐 Omarchy（键列中性白 DemiBold
  mono，箭头+说明 primary）。**交互坑**：翻页键原先挂在 ListView 的 Keys 上，但它没有
  焦点（焦点在全屏 Item）→ PageDown 失效；合并到焦点 Item 统一操作 contentY 即好。
  另：ydotool 发 Super+K 的 K 是 **37**（45 是 X），发错键会误判"浮层秒退"。
- **视觉语言规范雏形**写入 docs/theming.md §7（圆角/描边/底色/强调四档位），为后续
  mako（已达标）/orb/canvas 收口做底。
- 测试：229 基线不动全绿（只动 QML/shell 脚本/docs）。

## 2026-10-18（下午追加：goose 端到端 + 能力矩阵 + 通用 skill）

worktree `feat/goose-e2e-skill`（测试 229 基线不动，全绿）。三件事：

- **真 goose 无头会话端到端 ✅**（`goose run -t` + GLM glm-5.3-flash，全程审计留证，
  VM 证据目录 `~/e2e/`）：
  - **任务 1 系统操作链两跑**：首跑无代答——读操作全通，open_app/move/close 弹 T1 横幅
    30s 无人应答→超时 deny，桌面零变动（安全语义的天然实证）；重跑用
    `org.agentos.Confirm1.Respond` 编程应答（permissions.md §4.1 明示的测试通道）作
    用户代答：7 步全通——开 ghostty→移工作区 2（轮询时间线 ws_id 5→6 独立核验，
    模型还自行用 list_workspaces 核对 idx↔id 映射）→关闭→notify 汇报；
  - **任务 2 GUI 计算链**：水族馆开 gnome-calculator→dump 树→按名点 C/4/2/×/1/0/=→
    读文本得 **420**。四个诚实发现：①同名实例寻址歧义（桌面+水族馆两个 calculator，
    桥解析到先注册者，模型靠读状态自行判别后关旧实例）；②水族馆初始热键浮层遮挡截图，
    模型自主定位其不在 a11y 总线、借 `open_app` 在真实桌面 env 注入 Esc 关闭（agent
    沙箱连不上 root 600 的 ydotoold socket）；③T2 装包无头必 300s 超时（polkit 须人在），
    且残留认证框会抢水族馆键盘；④goose 内建 shell/developer 扩展不经 AgentOS 策略网关
    （策略面只覆盖 MCP 扩展——后续可考虑收紧 goose 配置）；
  - **任务 3 文档链**：files 读 inbox 三文件→写 `reports/weekly-report.fodt`（合计 118
    算对）→`open` 带 `app:"libreoffice"`→list_windows 实证 soffice 窗口→notify low+
    open_path 动作。视觉复核 Writer 渲染正常；顺带实证 "Document Recovery" 窗口现象。
  - **代答纪律**（与主会话用户复核撞车后确立）：代答器必须白名单——只放行
    niri.open_app/desktop.open 这类操作型确认；`desktop.confirm` 是 agent→用户提问通道，
    绝不代答。审计天然区分证据：by=respond（编程）/by=notify-action（真人，用户复核
    10:35:31 已成功留证）/by=timeout（无人）。
- **docs/capabilities.md ✅**：按 L0-L3 四层回答"agent 能否操作任何打开的应用"——
  结论"分层可预期而非任何"：L0/L2 全 ✅；L1 GTK3/4 ✅、Qt ⚠️（env 开关注册可达已实证、
  有窗树未验证——附录 A）、Chromium/Electron ⚠️（需 flag）、Java/X11/合成器 UI ❌；
  L3 grim/键盘 ✅、指针 ⚠️。含"哪类打不开"清单与补齐优先级。
- **skills/agentos-desktop/SKILL.md ✅**：自包含可移植版（YAML frontmatter + 挂载
  （goose/mcpServers 双格式）+ 45 工具速查表 + 行为约定 + 11 条实测坑 + L0→L3 升级
  路径），任何能挂 stdio MCP 的框架可用；README 文档区已挂链接；goose-system.md 注明
  "skill=对外可移植版 / goose-system=goose 专属版"关系（未删改）。

## 2026-10-18

- **M2 呈现层 ✅ 关账**（worktree `feat/m2-finish`，测试 194 → **229 全绿**）：最后两项
  落地并 VM 实测（详录 real-machine.md 当日条目）——
  - **artifacts 全类型统一索引**（`ec896ea`）：canvas 新增 `/api/artifacts`（扫描整个
    工作区，与 files-mcp 同一 AGENTOS_WORKSPACE 约定）+ `/artifacts` 索引页（莫兰迪、
    按目录分组、类型徽章、过滤框，/keys 同款骨架）；呈现通道按类型分：网页/图片在线看、
    文档提示由 agent `desktop__open` 打开、数据/影音可下载（`/api/artifacts/file` 带
    realpath 沙箱与 .trash 排除）；首页加三页互通导航。VM 实测 24 个真实产物六类全命中，
    截图经视觉模型复核无渲染异常；
  - **动作型通知"查看产物"**（`a00a64f`/`4b5c779`）：`desktop__notify` 增加可选
    `action`（open_url/open_path），内联 python3 D-Bus shim 发带 default+open 动作的
    通知并监听 ActionInvoked（agentos-confirm.py 同模式）；点击后 chromium --app /
    soffice（office 白名单）打开产物并写审计 `notify_action`；通道不可用自动降级为
    正文带地址+「对我说打开」约定。通知三档契约（完成=low+动作/失败=critical/需确认
    走 confirm）入档 goose-system.md。VM 全链路两轮实证（open_path→soffice 窗口、
    open_url→chromium 拉起，审计行留证）；
  - **两个实测新知**：① mako 1.11 的 `makoctl invoke` 在本机是静默空转（任意 id/动作
    rc=0 无信号）——编程触发必须走 mako 私有接口 `fr.emersion.Mako.InvokeAction`
    （default 与具名动作均可触发 ActionInvoked，gdbus monitor 留证；M4 记录据此修正）；
    ② mako 真实点击无法以合成输入证实：ydotool 1.0.4 `-a` 绝对定位受指针加速度影响
    落点漂移（help 自警），uinput 真 ABS 指针/单点触摸屏 niri 不消费——输入层限制，
    非 mako 结论，与 M4 横幅点选同批留待用户在场复核；
  - **工程教训**：跨语言 shim 的参数键名要统一（Node camelCase → python snake_case
    不一致曾让 watchdog 注册即崩：通知显示正常但点击永远无人应答，最狡猾的失败形态）；
    soffice 单实例锁会在无显示环境首启时被占死，后续调用全部转发不开窗，ssh 驱动
    GUI 验证必须带 WAYLAND_DISPLAY。

## 2026-10-17

单日四线并行（主线 + 3 个后台子代理 worktree），测试 129 → **194 全绿**。

- **M4 信任与安全 ✅ 关账**（`3d29d6f`）：权限分级 v1（`org.agentos.Confirm1`
  D-Bus + mako 四横幅载体 + policy `confirm` 决策 + 六 server 策略网关）、
  凭据三通道齐装（A 自动填充/B 代执行/C 短期注入 TTL 收割）、T2 装包链
  （快照→pkexec/polkit→审计）、canvas `/api/audit` + `/replay` 回放时间轴。
  退出标准双演示通过：185 行审计零明文；误操作（装 sl）→回放定位→`snapper
  rollback` 回滚态实证。
- **LanRhyme 观感落地**（`6d3a262`）：莫兰迪色板（源色 `#eee6ba`，`useWallpaperColors`
  防 colors.json 被覆写是关键机制）+ kita 壁纸 + 顶部横栏（用户偏好，LanRhyme 本人用左侧）。
- **毛玻璃回归**（`07bb61b`）：quickshell 0.2.1→0.3.2（COPR `errornointernet/quickshell`），
  niri 26.04 `ext-background-effect-v1` 原生支持；补丁集改为双版本矩阵，新增 0005
  （Region 角布尔→每角半径的 0.2→0.3 API 适配）。视觉模型验证栏后真高斯模糊。
- **M5 aarch64 镜像构建打通**（`0bf7df4`/`1c7dad6`/`e94be4c`/`a0f1359`）：
  quay 拉取走 Mac skopeo 中转（933MB/2min vs VM 直连 2h 失败）；修 bootc 基镜像
  `/root` 悬空符号链接与 F44 pipewire 包名；产出 `agentos:dev-aarch64` 4.38GB/81 层，
  容器冒烟全过。
- **M5 收尾五连（晚，worktree `feat/m5-final`）**：greenboot 接入（0.16.4 原生
  bootc 回滚支持，检查脚本语义按「greenboot 跑在登录前」设计防误报回滚）；
  CI 双架构 workflow 实装（原生 runner matrix，本地三重校验、未实跑如实标注）；
  bootc-image-builder 出 qcow2 2.0GB（预置 demon/wheel+sshd；五个坑入档：
  DefaultRootFs 必须显式、bib 只认标准 store 路径、多镜像 tar 丢 entrypoint、
  磁盘预算、构建机 store 位置）；**Fusion 点亮成功**（streamOptimized 只读坑
  定位→monolithicSparse；SDDM Wayland greeter 实跑、graphical.target 达成、
  canvas 200、goose 1.55.0；VM agentos-bootc-test 保留运行供亲验）；
  30 分钟演练：产物在手→可用对话 **11 分钟**（达标）。关键新知：bootc 部署期
  对系统单元重放 preset，构建期 enable 会被 99-default-disable 抹掉——镜像须
  随附 system-preset（Bazzite 同款），user 单元不受影响。详录 m5-atomic.md
  附 B/C/D。
- **键位速查页**（`92f8f8d`）：Super+K → canvas `/keys`（可滚动+分组吸顶+过滤框；
  键位实时解析 niri 配置、配色实时读 colors.json，双零副本）；`Mod+Shift+Slash`
  保留 niri 内置兜底。
- **M5 镜像点亮用户亲验 ✅（2026-10-18）**：用户登录 agentos-bootc-test 成功——
  SDDM → niri 会话可进、终端可运行。镜像骨架链闭合；观感层（Noctalia/主题/ghostty）
  未进镜像为已知断层，用户决定暂不补齐（补齐方案已备，随 D1/D2 一起拍板）。
  另：vmrun captureScreen 被拒是 macOS 权限弹窗无人处理所致——今后遇到宿主权限类
  失败立即告知用户处理，不再静默绕行。
- **键位速查浮层**（`c111027` 后续）：Super+K 弃用 chromium `--app`（"像启动了个 app"），
  改 layer-shell 覆盖层 `qs -c agentos-hotkeys`（`os/configs/hotkeys/shell.qml`）——
  Omarchy/niri 心智：居中面板+压暗背景+一行一条，Esc/点按关闭。数据/配色双零副本
  （实时解析 niri 配置 62 条全量 + 读 Noctalia colors.json）。canvas `/keys` 网页版
  保留为 agent 演示通道。两个 quickshell 0.3.2 实测坑入档：`FileView.text` 是同步
  方法且需 `blockLoading: true`；面板尺寸必须绑 `screen` 而非 `parent`（创建瞬间
  未定型 → 负宽度 → 不渲染）。
- **默认终端 → Ghostty**（`ebcf33b`/`353180b`）：COPR `scottames/ghostty`（官方仓库无包），
  内置 `Catppuccin Frappe` 主题 + Noto CJK；**毛玻璃真相**：ghostty 自带 blur 只走
  KDE 协议、niri 只提供 ext-background-effect-v1，零重叠——真模糊由 niri 窗口规则
  `background-effect { blur true }` 合成器侧实现（A/B 截图对照证实）。报告见
  [docs/ghostty.md](docs/ghostty.md)。

---

## 2026-10-18（深夜）

- **ghostty 已开窗口热重载打通（修正前论）**：用户实测菜单重载能换色 → 推翻"palette
  属 surface 级"定论；受控实验证明根因是**文件监视器不触发**（配置已变、窗口不变）。
  方案：theme-apply-all 内置 reload_ghostty_windows——niri 轮询 ghostty 窗口 + wtype
  注入 ctrl+shift+,（用户级），焦点还原；终验已开窗口暗↔浅自动换色。
- **悬浮球收起修复**：面板 400px 盖住球体导致无法收起——面板右上角加 × 收起按钮。


- **悬浮球服务化**：`os/systemd/agentos-orb.service`（Restart=on-failure）——手动拉起的
  进程悄悄死过一次，systemd 接管后自愈；ghostty 热重载定论：palette 属 surface 级，
  两条重载路径已开窗口均不换色（如实修正 theming 表述）。

- **两处收尾**：设置条目更名"系统设置"（去括号说明）；Noctalia 暗亮切换会**覆写
  colors.json**（实测切浅色后 72 键莫兰迪被 437 字节浅色默认顶掉）——挂
  darkModeChange/wallpaperChange/colorGeneration 三钩子自动重落色板，darkMode 回暗档
  （莫兰迪浅色变体留待后续生成）。

- **启动器统一与设置入口修复**：Super+D/Space → `agentos-launcher`（Noctalia 启动面板
  IPC，fuzzel 兜底——换状态栏只改脚本一处，键位与习惯不变）；"设置"打不开的根因=
  gnome-control-center 拒绝非 GNOME 会话（实测原话 "only supported under GNOME and
  Unity"）——隐藏死条目 + 新 agentos-settings.desktop 经 IPC 开 Noctalia 设置面板
  （该面板实测可开，截图存证）。


- **状态栏莫兰迪"假阳性"更正与真修复**：像素采样实锤——状态栏此前一直是 Noctalia
  内置海军蓝（#090922 系），10-17 的"莫兰迪已生效"是把默认黄 #fff59b 误判的假阳性
  （用户直觉"不是一个主题"是对的）。根因：v4.7.1 只认 m 驼峰键（官方模板
  Assets/Templates/noctalia.json），LanRhyme 蛇形键对不上→静默回落默认。
  `scripts/theme-noctalia.sh` 生成双键格式合并文件；复测栏主色 #21201c ✓。
- **ghostty 终端莫兰迪化**：`scripts/theme-ghostty.sh`（16 色+背景/前景/光标/选区，
  从规范色板生成，注释保留原 Catppuccin 可回切）。
- **系统主题同步原则**（用户提出，写入 theming.md §7）：一切第一方可主题界面读同一
  份 Material 蛇形色板（colors.json），换壁纸全系统跟随；第三方应用尽力而为。

## 2026-10-18（下午）

- **通知样式对齐系统主题**：`scripts/theme-mako.sh`——从 Noctalia 色板（colors.json，
  换壁纸自动跟随）生成 mako 配置：莫兰迪底/描边/圆角 12，三档紧急度分级
  （low 淡、normal 标准、critical 醒目描边+不过期=确认横幅档）；VM 实测截图过。

## 待办

### 用户侧（等你在场 / 你操作）

1. **吊销 GLM 临时 API key**（见本地记录，勿入公开仓库——已从本文件抹除前缀）；
2. **T1 复核**：真人鼠标点一次确认横幅（虚拟指针等价路径已验证，产品语义需真人过一遍）；
3. **T2 复核**：真人输一次 polkit 密码（ydotool 键盘等价已验证）；
4. **Ghostty**：物理键盘 Super+Return 实按开终端（当时为避免与 M4 ydotool 测试冲突跳过）；
5. **worktree 清理确认**：`../AgentOS-theming`（你的美化分支，已合并）、
   `../AgentOS-pi-research`（研究分支）——确认不用即可删；
6. **M5 点亮亲验**：`agentos-bootc-test` VM 正在 Fusion 运行（192.168.54.131，
   测试机账号密码见本地备忘）——用键盘在 SDDM 登录一次进 niri 会话（这是自动化覆盖不到的
   最后一步），看完可自行关机；产物在 `~/codespace/agentos-images/`。

- **goose 悬浮球**（`55e2faa`）：`qs -c agentos-orb` 常驻右缘——idle/working（审计驱动，
  显示当前工具）/attention（Confirm1 待确认）三态 + 点击面板（最近活动/待确认/直达
  /replay 与 /artifacts）；Confirm1 增只读 ListPending。VM 三态+面板全链实测。
### 设计债（用户观察 2026-10-18）

1. **启动器重复**：状态栏火箭图标（Noctalia Launcher，点击开 Noctalia 启动面板）与
   Super+D / Super+Space（fuzzel）是两套并存的启动器。建议：agent 优先+键盘文化下
   fuzzel 为主，去掉栏上火箭组件（或反过来全押 Noctalia 启动器并让 Super+D 调它——
   但其无 CLI 入口，需查 Noctalia IPC）。待用户拍板。
2. **状态栏与系统主题的"同源异形"**：色源一致（bar/键位浮层/mako 通知/orb 都读同一
   colors.json 莫兰迪色板），但**形态语言**不同——Noctalia 自带设计系统（胶囊 capsule、
   tabler 图标集、0.93 透明度），我们的浮层/通知是另一种语法（无胶囊、描边卡片）。
   建议：立一份"系统视觉语言"规范（胶囊半径/描边宽度/透明度/图标集/圆角档位），
   把 keys 浮层、mako、orb、canvas 三页对齐到同一语法。待排期。

### 项目侧（下次开发）

- **M5 发行（收尾会话已推进大头，剩尾款）**：x86_64 CI 实跑（workflow 已写好，
  接 GitHub 后 workflow_dispatch 首跑）、ISO 安装介质（bib 换代 `bootc-generic-iso`
  需实测）、greenboot 负路径回滚演示、M1 端到端任务在 bootc 新 VM 重放（需 API
  key）、发行决策 D1/D2 拍板（ghostty 进镜像 + COPR 供应链，分析已入
  m5-atomic.md §9）、`os/install.sh` x86_64 真机验证（ADR-0001 挂账）；
- **M2 收尾两项**：artifacts 全类型统一索引（现覆盖 HTML 类）、动作型通知（“查看产物”按钮）；
- **发行决策（M5 §9 分析已备，待拍板）**：ghostty 是否进 bootc 镜像（现为
  alacritty，且默认配置已 spawn ghostty——存在开箱断层，发行前必须闭合）；
  COPR `scottames/ghostty` 供应链三选一（信任/pin+校验/自建）；
- **等上游**：音频频谱（quickshell 缺 `PwAudioSpectrum`）；换壁纸自动重生成配色
  （需 noctalia CLI/matugen，LanRhyme 的 morandi-gen.py 已入库待接线）；
- **真机方案差异**：测试 VM 的 GDM 自动登录必须去除；chromium 首启双窗口 quirk；
  快照回滚永久化方向指向 bootc（本机 fstab 钉死 `subvol=root`，`set-default` 不生效）。
