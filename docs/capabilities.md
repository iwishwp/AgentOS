# Agent 能力矩阵 —— "agent 能否操作任何打开的应用？"

> 结论先行：**不是"任何"，但覆盖面是分层的、可预期的**。L0 系统层与 L2 浏览器层实测全通；
> L1 无障碍树对 GTK3/GTK4/Qt 应用实测全通（读写点击、无需焦点、不打扰用户），
> Chromium 树读/文本输入可达（页面点击本走 L2）；X11 分层（GTK3-X11 全通、纯 X11 无树）；
> Java 未装未测（路径已文档化）；L3 视觉/输入兜底全通——键盘（wtype 用户级为主力、
> ydotool sudo 兜底）与指针（uinput tablet 协议绝对坐标，2026-10-19 根治，附录 C）；
> 水族馆专用键鼠真并行（直连嵌套 display 的虚拟键鼠协议，2026-10-25 定案，附录 E）。
> 每一格的判定都基于真机实测（Fedora aarch64 @ VMware Fusion，niri Wayland 会话），证据出处标注在格内。

图例：✅ 实测可达 · ⚠️ 有条件（条件写明）· ❌ 缺（含补齐路径）

## 矩阵总览

| 层级 | 能力 | 状态 | 关键条件 / 缺口 |
|---|---|---|---|
| **L0 系统层** | 窗口/工作区/启动（niri IPC） | ✅ | [goose 端到端 2026-10-18]：列窗→开 ghostty→移工作区 2→关闭全链路；写操作过 T1 确认 |
| | systemd 服务查询 / journal / 网络 / 包查询 | ✅ | system-mcp 只读全 allow（M1 实测 + 本次 goose 会话） |
| | 装包（改系统状态） | ⚠️ | T2 强确认：polkit 密码框须有人输（ydotool 键盘等价已实证，M4）；无头跑=300s 超时拒绝（本次 goose 任务 2 实证） |
| | 文件沙箱（~/Agent 读写/移动/回收站删除/下载） | ✅ | M1 实测；下载协议/大小受限且过 confirm |
| | 桌面通知（三档契约 + 动作型） | ✅ | M2 实测；完成=low+查看产物动作、失败=critical、决策走 confirm 横幅 |
| | 剪贴板读写 | ✅ | desktop-mcp（wl-copy/wl-paste），M1 真机验证；策略归 desktop `*`→confirm 档 |
| | 打开产物（xdg-open / app 白名单） | ✅ | 白名单仅 libreoffice/soffice（防任意执行）；M1/M2 实测 fodt→soffice、url→chromium |
| **L1 无障碍树 AT-SPI2** | GTK3 应用 | ✅ | M3 实测（树读/按名点击/写文本）；X11 后端下同样全通（2026-10-18，见 X11 行） |
| | GTK4 应用 | ✅ | M3 实测 + 本次 goose 任务 2：gnome-calculator 点 C→4→2→×→1→0→= 读回 420。坑：树在 AT 客户端注册后才完整（16→105 节点）；索引路径跨连接会重建，**必须按名称寻址** |
| | Qt 应用（Qt5） | ✅ | 2026-10-18 实测（附录 A）：`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` 已落 /etc/environment，重启持久（PAM→GDM→niri→spawn 全链验证）；PyQt5 探针窗注册/dump/写/点/读全链通（"你好，重启后"）。QLabel 不实现 Text 接口（文本在 accessible name）——桥已回落 name 读回 |
| | 同名多实例寻址 | ⚠️ | 本次实证：桌面与水族馆各有一个 gnome-calculator 时，桥按名称解析到先注册者——agent 需自己判别实例（读文本对状态）后再操作，或关掉多余实例 |
| | Chromium（含 browser-mcp 实例） | ✅（读/文本输入） | 2026-10-18 实测（附录 B），三条件：① `--force-renderer-accessibility`（browser-mcp 已默认带，`AGENTOS_BROWSER_NO_A11Y=1` 可关）；② `toolkit-accessibility=true`（已全局开；**a11y bus 必须在应用启动前启用**，后开无效需重启应用）；③ 树懒构建，AT 调 GetAttributes 触发（桥已内建 prime）。页面元素树完整、按名读文本 ✅；entry 经 grabFocus+wtype 输入 ✅；**按钮 doAction 派发成功但不激活 onclick**（Chromium 155 两会话复现）——页面点击走 L2 CDP 本职 |
| | Electron（goose desktop 等） | ⚠️（读待验/点击 ✅） | 引擎同源、同 flag 启用（附录 B"Electron"）；goose desktop 已带 `--force-renderer-accessibility`（树读待真实用例验证）；**点击已实测 ✅**——不走 a11y 而走 CDP（附录 D：app-cdp.mjs + 固定 9223，模型选择器弹层三证） |
| | Java (Swing/AWT) | ❌ | 需 Java Access Bridge + GTK look-and-feel；系统仅 headless JDK，未装未测——补齐路径见附录 B"Java" |
| | X11 老应用（XWayland） | ⚠️（分层） | 2026-10-18 实测（附录 B）：xwayland-satellite 0.8.2 在位在跑（:0）。**GTK3 强制 X11 后端全通**（注册/写/点/读——atk-bridge 走 DBus，与显示后端无关）；**GTK4 X11 后端不注册**（gtk4 a11y 桥绑 Wayland）；**纯 X11 应用（xterm）能跑但无树**——只能 L3 兜底 |
| | niri 自身 UI（热键浮层/overview） | ❌ | 合成器内部 overlay，不在 AT-SPI 总线（本次实证）；按 Esc 关，输入注入可达 |
| **L2 浏览器 CDP** | 页面打开/填表/提交/读内容/截图 | ✅ | browser-mcp（Chromium+原生 CDP，水族馆内无头）；M3 退出标准：必应表单全链路 + 遇验证码主动拒绝 |
| | 桌面 Electron/Chromium 应用点击（app-cdp） | ✅ | 2026-10-19 实测（附录 D）：`scripts/app-cdp.mjs`（click/key/press/eval/screenshot，零依赖）走 Input.dispatchMouseEvent 真实点击语义，绕开 AT-SPI doAction 不触发 onclick 的限制；goose desktop 固定 9223（launch-goose-desktop.sh），实测模型选择器弹层三证（截图/data-state=open/[role=menu]）；主会话 chromium（9224）onclick 计数复验 |
| **L3 视觉/输入兜底** | grim 截图 | ✅ | 整屏/输出器粒度；水族馆定向截图走 session-mcp（M3） |
| | wtype 键盘（用户级） | ✅ | 2026-10-18 实测（`scripts/kb-inject.sh`）：文本/可打印键（含 space）与修饰组合键（ctrl+shift+comma→ghostty 热重载）可靠；边界：CJK 可能丢首字符、纯控制键（Return/Tab）对 GTK 不触发——控制键需求回落 ydotool |
| | ydotool 键盘（sudo） | ✅ | M4 实证（polkit 密码直输、Super+K 弹浮层）；绝对按键可靠、控制键路径全；kb-inject.sh 的回落 |
| | 鼠标指针（uinput tablet，`scripts/mouse-click.sh`） | ✅ | **2026-10-19 根治（附录 C）**：虚拟数字化仪 ABS_X/Y + BTN_TOOL_PEN/BTN_TOUCH，绝对坐标无加速度语义，niri 消费 pen→光标、tip→按下；用户级（/dev/uinput input 组 0660，udev 规则入镜像）。实测：计算器连点读回 77、Noctalia 顶栏 ControlCenter 弹层、zenity entry 右键菜单（BTN_STYLUS）。ydotool mousemove -a（加速度漂移）与 uinput pointer/触摸屏协议（niri 不消费）均已废弃 |
| | 水族馆专用键鼠真并行（`scripts/agent-input.sh`） | ✅ | **2026-10-25 定案（附录 E）**：wtype/wlrctl 直连水族馆自己的 Wayland display——嵌套 niri 同样暴露 zwp_virtual_keyboard_v1 与 zwlr_virtual_pointer_v1 v2，注入只进嵌套 seat，与人的主 seat 键鼠**结构上**互不干扰。实测：主桌面聚焦别的窗口时双路并发打字各进各窗（human 窗口与水族馆窗口内容零串扰）；指针"角落钳位+相对位移"合成绝对点击，300,300 / 200,500 / 400,200 / 380,220 等全部命中，主 seat 焦点全程未动 |

## "哪类应用当前打不开/打不好"

1. **Java 桌面应用**（IDE 如 IntelliJ 系、老 Swing 工具）：无 JAB，L1 不可达；L3 键盘+指针可用（盲打但能点）。补齐路径见附录 B"Java"（装完整 JDK + GTK LAF + access bridge，一行启动参数即可验证）。
2. **纯 X11 老应用**（xterm/motif/自绘 X 工具）：XWayland 下能跑（xwayland-satellite 实证）但无 a11y 树，L1 无从下手——L3 截图+键盘+指针（mouse-click.sh 绝对坐标）兜底。**GTK 系 X11 应用不受此限**（GTK3-X11 实测全通）；GTK4 的 X11 后端不注册树（罕见场景，GTK4 应用默认 Wayland）。
3. **Chromium/Electron 未带 a11y 开关启动的**：树不暴露。本机 browser-mcp 已默认带 flag；第三方 Chromium/Electron 应用需各自带 flag 启动（附录 B），且 a11y bus 必须先于应用启用。点击不受此限——带 `--remote-debugging-port` 启动即可走 app-cdp（附录 D）。
4. **合成器自身 UI**（浮层/overview/锁屏）：无障碍总线之外，只能 L3 输入注入（Esc 键盘、mouse-click.sh 指针均可）；水族馆初始热键浮层即此类（本次实证用 Esc 注入关闭）。
5. **无障碍总线上"无树"的轻量 GUI**（部分 layer-shell 面板、游戏、自绘 UI）：L1 无从下手，L3 截图+键盘+指针兜底（Noctalia 顶栏即此类，mouse-click.sh 实测命中 ControlCenter）。

（2026-10-18 起 Qt 不再在列——全局开关已落位并实测全通，见附录 A。）

## 升级路径（优先级）

1. ~~Qt 全局开关~~ ✅ 已完成（2026-10-18，附录 A）；
2. ~~Chromium a11y flag~~ ✅ browser-mcp 已默认带 + 全局 toolkit-accessibility 已开（附录 B）；第三方 Electron 应用统一加 flag 的包装脚本待真实用例；
3. **X11 桥验证** ✅ 已定论（附录 B：GTK3-X11 全通 / 纯 X11 无树——后者无桥可装，L3 是终点）；
4. **JAB**（等真实用例出现再装，路径见附录 B）；
5. ~~指针精度~~ ✅ 已根治（2026-10-19，附录 C：uinput tablet 协议绝对坐标，mouse-click.sh 用户级）；
6. ~~桌面 Electron 点击通道~~ ✅ 已统一（2026-10-19，附录 D：app-cdp.mjs + goose 固定 9223）；
7. ~~真·双 seat 键鼠并行~~ ✅ 已成立（2026-10-25，附录 E：水族馆 display 虚拟键鼠协议直连，不需要 niri 上游多 seat；"借道聚焦三步走"降级为主桌面兜底）。

## 端到端证据索引（2026-10-18 goose 真会话，GLM glm-5.3-flash）

三轮任务均以 `goose run -t`（无头）执行，全程审计 `~/.local/state/agentos/audit.jsonl`：

- **任务 1 系统操作链**（两跑）：
  - 首跑（无代答）：读操作全通；open_app/move/close 弹 T1 横幅 30s 无人应答→超时拒绝，桌面零变动——**安全语义实证**；
  - 重跑（`org.agentos.Confirm1.Respond` 编程应答=测试通道，permissions.md §4.1）：7 步全通——开 ghostty（id 35）→移工作区 2（时间线 ws_id 5→6 即 idx 2 独立核验）→关闭→通知汇报；模型还自行用 list_workspaces 核对了 idx↔id 映射。
- **任务 2 GUI 计算链**：水族馆开 gnome-calculator → dump 树找按钮名 → 按名点 C/4/2/×/1/0/= → 读文本得 **420** → 截图（首轮被水族馆热键浮层遮挡，模型自主定位浮层不可 a11y、借 open_app 注入 Esc 关闭，终获清净截图）。附带三个诚实发现：①同名实例寻址歧义（见矩阵）；②T2 装包无头必超时（polkit 须人）；③goose 内建 shell 扩展不经 AgentOS 策略网关（策略面只覆盖 MCP 扩展）。
- **任务 3 文档链**：files 读 inbox 三个零散文件（md/txt/csv，allow 免批）→ 整理写出
  `reports/weekly-report.fodt`（flat ODF，开销合计 118 计算正确）→ `open` 带
  `app:"libreoffice"`（T1 白名单代答 345ms 放行）→ list_windows 实证 soffice 窗口（id 40，
  "LibreOffice 26.2" 聚焦）→ notify low + open_path 动作。视觉复核：截图见 Writer 窗口
  渲染出周报全文与莫兰迪桌面。附带实证：上次 soffice 异常退出会弹 "Document Recovery"
  窗口（win 41）——单实例/恢复锁现象的又一形态，已入 SKILL 坑表。

### 代答与真实点击的证据区分

矩阵中的 ✅ 不含"用户真实点击横幅"证据——本轮全部 T1 放行均为 `by=respond` 编程应答（490ms/390ms/550ms 级），真实点击（`by=notify-action`）当时由主会话用户另行复核。审计行天然区分两者。

## 附录 A：Qt 全局 a11y 开关验证（2026-10-18 VM 实测，两轮）

**第一轮（附录 A 原始记录，部分验证）**：当时 VM 上唯一带 `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`
的 Qt6 应用是 lxqt-policykit-agent（正承担 polkit 认证职能不能动），只证到"注册层 ✅、
树内容 ⚠️ 未验证、全局方案未做"。

**第二轮（2026-10-18 补全，全链实测）**：

- **载体**：`dnf install python3-qt5`（PyQt5 5.15.12，Fedora 官方仓库 29 个包，未拉 KDE 全家桶）
  + 20 行探针窗（QLabel + QLineEdit + 两个 QPushButton，`setApplicationName("qt-a11y-probe")`）；
- **注册层 ✅（且超出预期）**：本机（GNOME 基座 + at-spi2-core 新版）**不带 env 的 PyQt5 应用
  启动即注册总线**——at-spi2 新版移除了 `org.a11y.Bus.IsEnabled` property 时代 Qt5 的检测
  路径如此；`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` 作为显式保证仍落位（防其他环境检测路径
  失效），lxqt-policykit-agent（Qt6）带 env 正常运行不受影响；
- **树与交互 ✅**：dump 树完整（application→filler(窗口)→label/text/button×2）；
  `settext "*" "AgentOS"` → `click "打招呼"` → label 由"初始状态"变"你好，AgentOS"；
  `click "清空"` → "已清空"；带 env 组复验 `settext "世界"` → "你好，世界"；
- **发现与修复：QLabel 不实现 AT-SPI Text 接口**（queryText 抛异常），可见文本只在
  accessible name 里——桥的 `texts` 命令已加 label 角色回落 name 读回（GTK label 走
  Text 接口优先），Qt/GTK 通吃；
- **全局落位 ✅（重启持久）**：`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` 写入 `/etc/environment`
  （PAM pam_env 载体，SSH/GDM 登录会话通吃），重启 VM 后全链复验：新 SSH 会话 env 有值 →
  niri 进程 `/proc/<pid>/environ` 有值 → `niri msg action spawn-sh` 拉起的探针窗（不显式带
  env）自动注册总线 → settext/click/texts 读回 **"你好，重启后"**。选 /etc/environment 而非
  `environment.d` 的理由：它同时覆盖 SSH 会话与 GDM 图形会话，且不依赖 systemd 用户实例的
  加载时机。

矩阵中 Qt 格的"✅"即上述含义：注册、树、写、点、读全链实测，全局开关重启持久。

## 附录 B：Chromium / X11 / Java / 注入四项实测（2026-10-18 VM）

### Chromium：三层条件 + 两个坑（读/输入 ✅，页面点击归 L2）

在水族馆（嵌套 niri）与主会话分别实测 Chromium 155（Fedora chromium-browser），结论：

1. **`--force-renderer-accessibility`（必要，已默认）**：不带 flag 时 CDP Accessibility 域
   只有空壳；带 flag 后 renderer 树构建（测试页 21 节点起）。**browser-mcp 已默认加此
   flag**（`AGENTOS_BROWSER_NO_A11Y=1` 可关，单测覆盖），headless=new 与有头 ozone=wayland
   行为一致；
2. **`org.gnome.desktop.interface toolkit-accessibility` 必须为 true，且必须先于应用启动**
   （最大的坑）：GNOME 默认 false，此时 Chromium **启动后永不注册 AT-SPI 总线**，事后打开
   也无效（AT 常驻在线也没用），必须重启应用。解法已落位：
   `gsettings set org.gnome.desktop.interface toolkit-accessibility true`（dconf 用户级持久，
   重启验证依然 true；本机 at-spi2 registryd 会把它同步到 bus 的 IsEnabled）。这个开关对
   GTK/Qt 也生效，等于"全系统声明有无障碍需求"——agent-first 桌面的合理默认；
3. **树懒构建，AT 调 GetAttributes 才展开页面内容**（第二坑）：注册后先只能看到窗口装饰
   （最小化/最大化按钮），需要 AT 客户端对节点调 `GetAttributes`/`GetRelationSet`（Orca 的
   同一条路）。桥已内建 `prime_tree()`：tree/click/texts/settext 入口自动触发 + 轮询，实测
   触发后 h1/button/input/段落全部出现（document web → heading"深海平原监测站"、
   button"触发警报"、entry"值班员姓名"…）；
4. **读 ✅**：`texts` 命令读回页面全部可见文本（桥的白名单已扩 static/heading/paragraph/
   entry）；
5. **文本输入 ✅（键盘组合拳）**：Chromium 的 entry 不响应 AT-SPI `setTextContents`
   （EditableText 接口未实现），但 `Component.grabFocus()` + wtype 键盘注入有效——实测
   grabFocus entry 后 wtype "潜航员甲"，树内读回 '航员甲'（wtype 丢了首字符，见"注入"节）；
6. **按钮点击 ❌（如实定论）**：`doAction(press)` 派发成功（返回 true）但页面 onclick 不
   执行——水族馆与主会话两会话复现；grabFocus 按钮 + Return/Space 键盘路径同样不激活。
   页面点击本来就是 L2 CDP 的本职（browser_eval 一步到位），L1 对 Chromium 的定位是
   **树读 + 状态读 + 文本输入**。

**Electron 启用（引擎同源，推断路径）**：Electron 即 Chromium，同一 flag 直接有效：
`code --force-renderer-accessibility`（VS Code；首启还会问"是否在使用屏幕阅读器"，选是或
设 `editor.accessibilitySupport: "on"`，否则 VS Code 只暴露编辑器级树）；其他 Electron 应用
同法加 flag（或改 .desktop/包装脚本统一注入）。同样要求 toolkit-accessibility 先于启动为
true。VM 无 Electron 应用，未实测——出现用例时按本节步骤验证即可。

### X11：分层结论（xwayland-satellite ✅ / GTK3-X11 ✅ / GTK4-X11 ❌ / 纯 X11 ❌）

xwayland-satellite 0.8.2 在位在跑（`xwayland-satellite :0`，DISPLAY=:0）。三层实测：

- **纯 X11 应用**：装 xterm（`xorg-x11-apps` 已被 Fedora 41+ 移除，xterm 是现役替代），
  `DISPLAY=:0 xterm` 窗口真实开出（niri 列窗 id 80/app_id "XTerm" 实证），但 a11y 总线上
  **没有它**——"X11 应用能跑但无 a11y 树"的边界成立，只能 L3 兜底。这不是缺桥可装
  （X11 工具根本没实现 a11y），是这类应用的终点状态；
- **GTK3 强制 X11 后端**（`GDK_BACKEND=x11` + GTK3 探针窗）：窗口经 XWayland 开出，
  **总线注册 ✅ 且交互全通**——settext "深潜" → click "打招呼" → label 读回"你好，深潜"。
  机理：GTK 的 atk-bridge 走 DBus 连 a11y bus，与显示后端无关。存量 GTK 系工程软件在
  XWayland 下 L1 全可达；
- **GTK4 强制 X11 后端**（gnome-calculator）：窗口能开，**总线不注册**——gtk4 的 a11y
  桥（GtkAtSpiContext）绑定 Wayland 后端，X11 后端无 a11y。GTK4 应用默认走 Wayland，
  实际影响面很小。

### Java：JAB 补齐路径（文档化，未装）

系统仅 `java-25-openjdk-headless`（无 AWT/Swing GUI）。真实用例出现时的启用路径：

1. `dnf install java-25-openjdk`（完整版，含 libawt_xawt/Swing）；
2. Swing 应用用 GTK look-and-feel 才有桥：`-Dswing.defaultlaf=com.sun.java.swing.plaf.gtk.GTKLookAndFeel`；
3. OpenJDK 内置 Linux Access Bridge（java-atk-bridge，JDK 11+ 随 JDK 提供），AT-SPI 总线侧
   由 `toolkit-accessibility=true`（已全局开）配合；老 JDK 8 时代才需要单独的
   `java-access-bridge` 包；
4. 验证：写 20 行 Swing 窗（JLabel+JTextField+JButton），桥 `apps` 看注册、`texts` 读回。
   注意 Java 应用的角色命名（"text"）与 GTK 一致，桥无需改。

### 注入：wtype 为主力、ydotool 兜底（scripts/kb-inject.sh）

统一入口 `kb-inject.sh type|type-slow|key`：优先 wtype（Wayland zwp_virtual_keyboard，
**用户级无需 sudo**——比 ydotool 的 root-600 socket 沙箱友好得多），回落 ydotool（sudo +
`YDOTOOL_SOCKET=/tmp/.ydotool_socket`，SUDO_PW 环境变量）。实测边界（全部入脚本头注释）：

- **文本/可打印键 ✅**：GTK3 entry 输入 'hello-kb-inject'、Chromium entry '航员甲' 均树内读回；
- **修饰组合键 ✅**：ctrl+shift+comma 注入 ghostty 触发热重载（theming 轮已实证）；
- **纯控制键（Return/Tab）⚠️**：wtype 注入后 GTK entry 的 activate 不触发（space 却能进字），
  需要回车/导航键的场景走 ydotool（M4 实证其 evdev 路径全通）；
- **CJK ⚠️**：wtype 多字符中文可能丢首字符（"潜航员甲"→"航员甲"），type-slow 逐字符缓解，
  关键输入后从 a11y 树读回核对。

## 附录 C：鼠标指针根治——uinput tablet 协议（2026-10-19 VM 实测）

### 排除法与第三条路

两条旧路均废弃（M2/M4 两代理实证，采信未重走）：ydotool `mousemove -a` 受 libinput
指针加速度拖累（低速加速系数 ≈0.5，绝对定位漂移，1.0.4 溢出钳位+1px 步进虽可用但极慢）；
自建 uinput **pointer 协议**（REL 转绝对）与**单点触摸屏协议**（ABS_X/Y + BTN_TOUCH），
niri/smithay 均不消费。

第三条路成立：**tablet/pen 协议**。数字化仪是原生绝对坐标设备，libinput 对 tablet 支持
完整（无加速度语义），合成器把 pen 位置映射为光标移动、笔尖触底映射为按下——与 wacom
数位板同一代码路径，GNOME/KDE 同语义。`scripts/uinput-tablet.py`（纯 ioctl+struct，零依赖）
创建虚拟数字化仪：EV_ABS ABS_X/ABS_Y/ABS_PRESSURE + EV_KEY BTN_TOOL_PEN/BTN_TOUCH/BTN_STYLUS，
tap 序列 = 入感应区（pen 1）→ 触底（BTN_TOUCH+压力）→ 抬笔 → 出感应区；
右键 = 触底期间按 BTN_STYLUS（桶键）。`scripts/mouse-click.sh` 封装：`<x> <y> [left|right]`、
`--move`、`--hold-ms`，屏幕逻辑范围自动从 `niri msg -j outputs` 包围盒取。

### 两个必须的内核细节（libinput 拒收门槛）

初版设备被 libinput 整体忽略，报
`libinput bug: missing tablet capabilities: btn-stylus resolution`：

1. **BTN_STYLUS 的 keycode 是 0x14b**（0x141 是 BTN_TOOL_RUBBER/eraser，写错等于注册了
   橡皮擦工具而没注册桶键）；
2. **ABS_X/ABS_Y 必须带非零 resolution**（单位/毫米）。老式 `uinput_user_dev` 全量写入
   **没有** resolution 字段，必须走 `UI_ABS_SETUP` ioctl——且注意
   `struct uinput_abs_setup = {u16 code; struct input_absinfo absinfo}`（28 字节，
   absinfo 首字段是 **value**，随后 minimum/maximum/fuzz/flat/resolution），
   `struct uinput_setup` 是 **id 在前 name 在后**（{input_id; name[80]; ff_effects_max}）。
   照网上常见的 24 字节/名字在前布局打包，内核直接 EINVAL。

resolution 数值本身不影响落点（合成器按 [0,1] 归一化映射输出），给 40（数位板量级）即可。
ABS 轴范围 = 屏幕逻辑范围 → 坐标系即 niri 逻辑坐标。

### 权限（用户级）

/dev/uinput 默认 root:600。方案：udev 规则 `KERNEL=="uinput", MODE="0660", GROUP="input"`
（`os/configs/udev/60-agentos-uinput.rules`，已入镜像 Containerfile）+ 桌面用户入 input 组
（`usermod -aG input <user>`，重新登录生效——SSH 新会话即够）。回落：SUDO_PW + sudo
（kb-inject.sh 同款）。设备即建即毁（热插拔），无残留状态；注入全局生效，不依赖调用方
在哪个会话。

### 实测证据（VM 1280x800 / niri 26.04 / kernel 6.19）

- **libinput 识别**：`libinput list-devices` → "AgentOS Virtual Tablet"，Capabilities: tablet，
  无拒收告警；
- **左键点击精度**：gnome-calculator 连点 "7"(726,613) 两次 → a11y 树读回显示区 `77`，
  截图同步见 77 与 7 键高亮；
- **真实 UI 小目标**：Noctalia 顶栏 ControlCenter 图标（915,15，约 16px 宽）命中弹出控制
  中心面板（截图证据），复点关闭；
- **右键**：zenity entry（640,410）右键 → GTK 上下文菜单（剪切/复制/粘贴/全选）弹出（截图证据）；
- **用户级**：以上 ControlCenter 命中/关闭一轮走 `mouse-click.sh` 无 sudo 完成
  （input 组新会话）。

## 附录 D：桌面 Electron/Chromium 统一 CDP 通道（2026-10-19 VM 实测）

### 动机与形态

AT-SPI `doAction` 对 Chromium 系按钮"派发成功但不触发 onclick"（附录 B，Chromium 155
两会话复现），桌面 Electron 应用一直缺可靠点击路径。统一通道 `scripts/app-cdp.mjs`
（零依赖单文件，Node 22 全局 WebSocket/fetch，与 browser-mcp 的 CDP 客户端同构但独立
最小实现）：

- `click <x> <y> [--button left|right|middle] [--count n]`：Input.dispatchMouseEvent，
  序列 **mouseMoved → mousePressed → mouseReleased**——hover 前置是必须的（实测 goose 的
  React 弹层无 hover 不开：无 mouseMoved 的首击未展开，补上后三证齐全）；
- `key "文本"`（Input.insertText）/ `press Enter|Tab|Escape|...`（dispatchKeyEvent 控制键）；
- `eval "js"`（Runtime.evaluate——查 getBoundingClientRect 拿精确点击坐标）；
- `screenshot <path>` / `targets`（端口发现调试）。

坐标语义：应用客户区 CSS 像素（viewport 原点=窗口左上，不含系统装饰）。端口约定：
**goose desktop 9223**（`launch-goose-desktop.sh` 固定 `--remote-debugging-port=9223` +
`--remote-allow-origins=*`；与水族馆 chromium 的 9222 区分，仅 127.0.0.1 可达）；其他应用
`--remote-debugging-port` 自选 + `--port` 指定。

### 实测证据

- **goose desktop（Electron 150 / X11 后端）**：`eval` 查得模型选择器 trigger（glm-5.3-flash，
  116,426）→ `click` → 弹层展开三证：CDP 截图（模型列表含 GLM/glm-5.3-flash/200K）、DOM
  `data-state="open"`、`[role=menu]` 存在 → `press Escape` 关闭，布局恢复原状（对比前后截图）；
- **主会话 chromium（Chromium 155 / ozone wayland / 临时 profile / 9224）**：本地测试页
  `click`×2 → onclick 计数 "被点了 2 次"；`key` 输入 → input 事件回显 "输入:hello-app-cdp"；
  `press Enter/Tab` 正常，端口全程存活。

### 与既有层的关系

页面内操作（agent 专属浏览器）仍走 L2 browser 扩展（browser_eval 一步到位）；app-cdp
补的是**桌面用户会话里的** Electron/Chromium 应用（goose desktop 首位用户），二者共用
CDP 语义、端口隔离。L3 mouse-click.sh 与 app-cdp 的分工：应用带 CDP 端口 → app-cdp
（不依赖屏幕坐标、不受窗口遮挡影响）；无端口（xterm/游戏/合成器 UI/未开调试的自拉应用）
→ mouse-click.sh（屏幕绝对坐标）。

## 附录 E：双 seat 键鼠真并行——直连水族馆 display 的虚拟键鼠（2026-10-25 VM 实测）

### 问题与假设

此前输入注入（wtype/uinput tablet）作用于**主 seat**：agent 要输入水族馆必须"聚焦水族馆
→注入→还原焦点"，打断用户焦点，无法真并行；os/configs/goose-system.md 的旧定案是
"真·双 seat 需 niri 上游多 seat 支持"。

本次验证的核心假设：**水族馆（嵌套 niri）有自己的 Wayland display 与独立 seat，若它在
display 上实现虚拟输入协议，客户端直连水族馆 display 即可注入只进嵌套 seat**——与人的
主 seat 键鼠完全并行，且这是结构保证（注入根本不经过主 seat），不是时序保证。

### 协议验证（niri 26.04）

主 display（wayland-1）与水族馆 display（wayland-2）分别 `wayland-info`，两协议**齐备且
版本一致**：

```
zwp_virtual_keyboard_manager_v1  v1   # wtype 走它（键盘）
zwlr_virtual_pointer_manager_v1  v2   # wlrctl 走它（指针，wlr-protocols 系）
```

嵌套 niri 是完整 compositor，主会话有的虚拟输入协议它同样暴露——不需要 smithay/niri
上游任何新能力。指针客户端 wlrctl 在 Fedora 官方仓（`dnf install wlrctl`，75KB）。

### 键盘并行实验

水族馆内开 ghostty 跑 `stty -icanon -echo; cat > /tmp/aq-kb.txt`（每字符即时落盘），
主 seat 开同款终端写 /tmp/human-kb.txt 并**聚焦它**（水族馆窗口在主 seat 无焦点）。
双路**同时**注入：

```
WAYLAND_DISPLAY=wayland-1 wtype "HUMAN-TYPING-ON-MAIN"   # 模拟人打字（主 seat 焦点窗口）
WAYLAND_DISPLAY=wayland-2 wtype "AGENT-TYPING-ON-AQ"     # agent 打字（水族馆 display）
```

结果：human 窗口精确收到 `HUMAN-TYPING-ON-MAIN`，水族馆窗口精确收到 `AGENT-TYPING-ON-AQ`，
零串扰、零丢字；主 seat 焦点状态全程未变。CJK（"脚本直连水族馆"）经逐字符慢输同样精确。

### 指针并行实验

水族馆内跑 PyQt5 全屏靶点（mousePressEvent 把 globalX/globalY 落盘）。wlrctl 只发**相对
位移**（协议本身有 motion_absolute，wlrctl 未暴露），绝对坐标用合成法：

```
wlrctl pointer move -9999 -9999   # 钳到左上角（屏幕边缘 clamp）
wlrctl pointer move 300 300       # 位移量即绝对坐标
wlrctl pointer click left         # 按钮名 left|right|middle
```

实测（主 seat 焦点始终在 human 窗口）：300,300 / 200,500 / 400,200 / 450,260 / 380,220 /
150,150 / 500,400 / 100,600 全部按命令精确落点，左/右/中三键均送达；并发轮（人打字与
agent 点击同一时刻）human 文件完整、水族馆落点精确。已知边界：连续两次 wlrctl 间隔
<0.2s 偶发一次落点偏移（钳位竞态），间隔 0.4s 未再复现——脚本已固化 0.4s。

### 封装：scripts/agent-input.sh

`display|type|key|move|click x y [left|right|middle]`。display 自动发现：扫
`/run/user/$UID/niri.wayland-N.<pid>.sock`，取 cmdline 含 niri 且**不含 --session** 的进程
（主会话是 `niri --session`），多候选取最新；`AGENTOS_AQ_DISPLAY` 可显式覆盖（对接
session-mcp 返回的 waylandDisplay）。CJK 自动逐字符慢输（防 wtype 丢首字符老坑）。

### 残留边界与跟进项

- wlrctl 不暴露 motion_absolute：绝对点击靠"角落钳位+相对位移"合成，已实测可靠；
  需要原生绝对语义时可写 pywayland 小客户端（python3-pywayland 在 Fedora 仓）；
- wtype 纯控制键（Return/Tab）在 GTK 控件不触发行为的老边界不变——水族馆里
  "输入+回车"优先 a11y 激活或改点按钮；
- **顺带发现（重要）**：niri 26.04 拒绝 `hotkey-overlay { show-at-startup false }`
  （改成了 `skip-at-startup`，niri validate 双向实证）。VM 的 ~/.config/niri/config.kdl
  含旧写法 → 嵌套 niri 带 `-c` 启动回落默认配置+报错横幅（f2d8c04"浮层仍弹"的真根因）；
  journal 证实**主会话**（今日 10:15 起）也在解析失败回落默认配置运行。修法一行：
  该块改为 `hotkey-overlay { skip-at-startup }`。未代改（不动在用桌面，留人工确认）。

### 证据

- 双路并发文件级回读（本节命令与输出即审计记录）；
- 截图：VM `~/Agent/screenshots/2026-10-25-parallel-input-{aquarium,main}.png`
  （水族馆侧终端 -echo 无回显，内容以文件回读为准）。
## 附录 E：a11y 操作提速——基线 46.5s → 18.9s（2026-10-25 VM 实测，worktree feat/a11y-speed）

### 基线与口径

任务：goose 在水族馆操作 gnome-calculator 计算 1234×56（同一条任务提示词，全程只用
session+atspi 两扩展，读回 69104 + 截图）。环境：VM 192.168.54.130 / goose 1.54.0 /
glm-5.3-flash（bigmodel anthropic 兼容通道）/ `goose run --quiet --max-turns 30 -t <任务>`
（不带 --system，纯工具面改进的可复现口径）。指标：审计时间线首末工具调用间隔。

基线（2026-10-25 02:01，11 次工具调用，**46.53s**）：

| 分段 | 耗时 | 说明 |
|---|---|---|
| session_start → open_app | 5.0s | 单次 LLM 往返 |
| open_app → list_apps → dump_tree | 11.0s | 两跳探索 |
| dump_tree → 首次点击 | **10.9s** | dump 响应 **179,188 字节**（≈45K token），LLM 消化大上下文 |
| 8 连击（1/2/3/4/×/5/6/=） | 6.3s | 同轮并行发出、顺序执行，每击 0.9s |
| read_texts + screenshot | 13.3s | 两轮串行 |

瓶颈结论：工具执行本身 <0.3s，端到端耗时几乎全在 LLM 往返次数与 token 量。

### 四刀与实测效果

| 优化 | 改动 | 单项实测 |
|---|---|---|
| ① dump 树供给精简 | `tree` 默认 interactive 模式：可交互元素扁平清单（按钮/输入/链接/可点击+值非空文本，名称+角色）；`roles=` 白名单整体替换默认判定；`mode=full` 保留全树、`compact=1` 去 states/actions 且叶子文本并入父节点 | gnome-calculator dump 响应 179,188 → **4,594 字节**（39 倍缩减）；消化跳 10.9s → ~4-6s |
| ② 批量点击宏 | 新工具 `a11y_click_sequence(app, names[])`：桥内单次 DFS 建 名→按钮 映射后逐个 doAction，逐步结果数组返回，失败停在该步 | 8 连击 8 跳 → 1 跳，桥执行 0.90s |
| ③ prime_tree 免空轮询 | Chromium/Electron（document web 命中或名称含 chromium/chrome/electron）才保留 4×0.5s 等树循环；GTK/Qt 单轮触发即走 | 每次 a11y 调用 3.0s → **0.88s**（实测 gnome-calculator 被空轮询拖去 2.07s/次） |
| ④ 最少往返指引 | goose-system.md §GUI 应用操作提速 + 工具描述/结果内嵌（控件名已知直接 click_sequence、start+open_app 同轮、读文本+截图同轮并行、浮层如实说明不重试） | 三轮全部出现同轮 batching（start+open_app 0.00/0.26s；read+shot 相邻 1s 内） |

### 复测（部署新 dist 后三轮取均值，2026-10-25 03:06-03:10）

| 轮次 | 端到端 | 调用数 | 形态 |
|---|---|---|---|
| 1 | 21.88s | 7 | start+open_app 同轮 → interactive dump → click_sequence → read+shot 同轮 |
| 2 | 21.55s | 7 | start+open_app 同轮 → list+dump → click_sequence → read+shot 同轮 |
| 3 | **13.16s** | 5 | start+open_app 同轮 → click_sequence 直点（免探索）→ read+shot 同轮 |
| **均值** | **18.86s** | — | **-59.5%（46.53s → 18.86s），目标 ≤25s 达成** |

三轮均读回 69104 并截图存证；水族馆隔离与主桌面零触碰不变。行为基线（goose-system.md）
本轮基准未挂载（口径与基线一致）——上述成绩全部来自工具面；生产路径挂上行为基线后，
"控件名已知直接连点/免探索"会更稳定（第 3 轮形态）。

### 边界与诚实备注

- 按名寻址语义不变（M3 结论保持：名称寻址、树跨连接重建不可用索引）；interactive 清单
  只影响 dump 的供给面，click/read_texts/set_text 行为未动；
- 模型侧仍有方差：是否先 dump 验证、是否 list_apps，由模型自决（三轮中两轮验证、一轮直连），
  端到端 13-22s 波动来自此；
- 嵌套 niri 的 Important Hotkeys 浮层问题依旧（skip-at-startup 在嵌套模式未生效，f2d8c04
  遗留）：a11y 路径不受影响，截图可能带浮层；agent_screenshot 描述已注明"如实说明即可，
  不必反复重试"（未注明前实测一轮被模型拖去 5 分钟试图关闭）。