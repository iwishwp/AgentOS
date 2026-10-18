# Agent 能力矩阵 —— "agent 能否操作任何打开的应用？"

> 结论先行：**不是"任何"，但覆盖面是分层的、可预期的**。L0 系统层与 L2 浏览器层实测全通；
> L1 无障碍树对 GTK3/GTK4/Qt 应用实测全通（读写点击、无需焦点、不打扰用户），
> Chromium 树读/文本输入可达（页面点击本走 L2）；X11 分层（GTK3-X11 全通、纯 X11 无树）；
> Java 未装未测（路径已文档化）；L3 视觉/输入兜底里键盘可靠（wtype 用户级为主力、
> ydotool sudo 兜底）、指针受硬件加速度拖累。
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
| | Electron（VS Code 等） | ⚠️ | 引擎同源、同 flag 启用（附录 B"Electron"）；VM 无 Electron 应用，未实测，用例出现时按附录 B 步骤验证 |
| | Java (Swing/AWT) | ❌ | 需 Java Access Bridge + GTK look-and-feel；系统仅 headless JDK，未装未测——补齐路径见附录 B"Java" |
| | X11 老应用（XWayland） | ⚠️（分层） | 2026-10-18 实测（附录 B）：xwayland-satellite 0.8.2 在位在跑（:0）。**GTK3 强制 X11 后端全通**（注册/写/点/读——atk-bridge 走 DBus，与显示后端无关）；**GTK4 X11 后端不注册**（gtk4 a11y 桥绑 Wayland）；**纯 X11 应用（xterm）能跑但无树**——只能 L3 兜底 |
| | niri 自身 UI（热键浮层/overview） | ❌ | 合成器内部 overlay，不在 AT-SPI 总线（本次实证）；按 Esc 关，输入注入可达 |
| **L2 浏览器 CDP** | 页面打开/填表/提交/读内容/截图 | ✅ | browser-mcp（Chromium+原生 CDP，水族馆内无头）；M3 退出标准：必应表单全链路 + 遇验证码主动拒绝 |
| **L3 视觉/输入兜底** | grim 截图 | ✅ | 整屏/输出器粒度；水族馆定向截图走 session-mcp（M3） |
| | wtype 键盘（用户级） | ✅ | 2026-10-18 实测（`scripts/kb-inject.sh`）：文本/可打印键（含 space）与修饰组合键（ctrl+shift+comma→ghostty 热重载）可靠；边界：CJK 可能丢首字符、纯控制键（Return/Tab）对 GTK 不触发——控制键需求回落 ydotool |
| | ydotool 键盘（sudo） | ✅ | M4 实证（polkit 密码直输、Super+K 弹浮层）；绝对按键可靠、控制键路径全；kb-inject.sh 的回落 |
| | ydotool 指针 | ⚠️ | 加速度下漂移：libinput 低速加速系数 ≈0.5，绝对定位失准（M2/M4 两代理实证）；且 ydotoold socket 为 root 600，agent 沙箱不可直连，须借 open_app 在真实桌面环境执行（本次任务 2 实证绕行路径） |

## "哪类应用当前打不开/打不好"

1. **Java 桌面应用**（IDE 如 IntelliJ 系、老 Swing 工具）：无 JAB，L1 不可达；L3 键盘可用但盲打。补齐路径见附录 B"Java"（装完整 JDK + GTK LAF + access bridge，一行启动参数即可验证）。
2. **纯 X11 老应用**（xterm/motif/自绘 X 工具）：XWayland 下能跑（xwayland-satellite 实证）但无 a11y 树，L1 无从下手，L3 截图+键盘兜底、指针不可靠。**GTK 系 X11 应用不受此限**（GTK3-X11 实测全通）；GTK4 的 X11 后端不注册树（罕见场景，GTK4 应用默认 Wayland）。
3. **Chromium/Electron 未带 a11y 开关启动的**：树不暴露。本机 browser-mcp 已默认带 flag；第三方 Chromium/Electron 应用需各自带 flag 启动（附录 B），且 a11y bus 必须先于应用启用。
4. **合成器自身 UI**（浮层/overview/锁屏）：无障碍总线之外，只能 L3 输入注入；水族馆初始热键浮层即此类（本次实证用 Esc 注入关闭）。
5. **无障碍总线上"无树"的轻量 GUI**（部分 layer-shell 面板、游戏、自绘 UI）：L1 无从下手，L3 截图+键盘兜底，指针不可靠。

（2026-10-18 起 Qt 不再在列——全局开关已落位并实测全通，见附录 A。）

## 升级路径（优先级）

1. ~~Qt 全局开关~~ ✅ 已完成（2026-10-18，附录 A）；
2. ~~Chromium a11y flag~~ ✅ browser-mcp 已默认带 + 全局 toolkit-accessibility 已开（附录 B）；第三方 Electron 应用统一加 flag 的包装脚本待真实用例；
3. **X11 桥验证** ✅ 已定论（附录 B：GTK3-X11 全通 / 纯 X11 无树——后者无桥可装，L3 是终点）；
4. **JAB**（等真实用例出现再装，路径见附录 B）；
5. **指针精度**：自研受控 uinput 守护（绕开 libinput 加速度，绝对坐标语义）——已有里程碑级挂账（M3 遗留）。

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
