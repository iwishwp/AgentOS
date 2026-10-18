# Agent 能力矩阵 —— "agent 能否操作任何打开的应用？"

> 结论先行：**不是"任何"，但覆盖面是分层的、可预期的**。L0 系统层与 L2 浏览器层实测全通；
> L1 无障碍树对 GTK 应用实测全通（读写点击、无需焦点、不打扰用户），对 Qt/Chromium/Electron/
> Java/X11 老应用各有前置条件或缺口；L3 视觉/输入兜底里键盘可靠、指针受硬件加速度拖累。
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
| **L1 无障碍树 AT-SPI2** | GTK3 应用 | ✅ | M3 实测（树读/按名点击/写文本） |
| | GTK4 应用 | ✅ | M3 实测 + 本次 goose 任务 2：gnome-calculator 点 C→4→2→×→1→0→= 读回 420。坑：树在 AT 客户端注册后才完整（16→105 节点）；索引路径跨连接会重建，**必须按名称寻址** |
| | 同名多实例寻址 | ⚠️ | 本次实证：桌面与水族馆各有一个 gnome-calculator 时，桥按名称解析到先注册者——agent 需自己判别实例（读文本对状态）后再操作，或关掉多余实例 |
| | Qt 应用 | ⚠️ | 需 `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`。已带此变量的 lxqt-policykit-agent 在总线注册成功（本次 a11y_list_apps 实证）；**全局方案未做**——验证记录见文末附录 A |
| | Chromium / Electron | ⚠️ | 需 `--force-renderer-accessibility` 启动；本项目浏览器操作不走此路（见 L2），未单测 |
| | Java (Swing/AWT) | ❌ | 需 Java Access Bridge + GTK look-and-feel；系统无 JRE 桌面应用，未装未测 |
| | X11 老应用（XWayland） | ❌ | X11 内的 AT-SPI 桥接未配置未测（xatkbridge 路径）；本机默认应用全是 Wayland 原生 |
| | niri 自身 UI（热键浮层/overview） | ❌ | 合成器内部 overlay，不在 AT-SPI 总线（本次实证）；按 Esc 关，输入注入可达 |
| **L2 浏览器 CDP** | 页面打开/填表/提交/读内容/截图 | ✅ | browser-mcp（Chromium+原生 CDP，水族馆内无头）；M3 退出标准：必应表单全链路 + 遇验证码主动拒绝 |
| **L3 视觉/输入兜底** | grim 截图 | ✅ | 整屏/输出器粒度；水族馆定向截图走 session-mcp（M3） |
| | ydotool 键盘 | ✅ | M4 实证（polkit 密码直输、Super+K 弹浮层）；绝对按键可靠 |
| | ydotool 指针 | ⚠️ | 加速度下漂移：libinput 低速加速系数 ≈0.5，绝对定位失准（M2/M4 两代理实证）；且 ydotoold socket 为 root 600，agent 沙箱不可直连，须借 open_app 在真实桌面环境执行（本次任务 2 实证绕行路径） |

## "哪类应用当前打不开/打不好"

1. **Java 桌面应用**（IDE 如 IntelliJ 系、老 Swing 工具）：无 JAB，L1 不可达；L3 键盘可用但盲打。
2. **X11 老应用**（GTK2 时代/某些工程软件）：XWayland 下 AT-SPI 桥未配置；补齐=装 at-spi2 的 X11 桥并验证。
3. **Chromium/Electron 未带 a11y 开关启动的**：树不暴露；补齐=改 .desktop/包装脚本统一加 `--force-renderer-accessibility`（浏览器类我们本来走 L2 CDP，优先级低）。
4. **Qt 应用**：逐个带 env 可用，全局补齐=会话级环境变量或 systemd 用户环境（附录 A）。
5. **合成器自身 UI**（浮层/overview/锁屏）：无障碍总线之外，只能 L3 输入注入；水族馆初始热键浮层即此类（本次实证用 Esc 注入关闭）。
6. **无障碍总线上"无树"的轻量 GUI**（部分 layer-shell 面板、游戏、自绘 UI）：L1 无从下手，L3 截图+键盘兜底，指针不可靠。

## 升级路径（优先级）

1. **Qt 全局开关**（一行 env，收益/成本比最高）→ 附录 A 方案；
2. **Chromium/Electron 包装脚本**统一加 a11y flag（覆盖第三方 Electron 应用）；
3. **X11 桥验证**（存量工程软件）；
4. **JAB**（等真实用例出现再装）；
5. **指针精度**：自研受控 uinput 守护（绕开 libinput 加速度，绝对坐标语义）——已有里程碑级挂账（M3 遗留）。

## 端到端证据索引（2026-10-18 goose 真会话，GLM glm-5.3-flash）

三轮任务均以 `goose run -t`（无头）执行，全程审计 `~/.local/state/agentos/audit.jsonl`：

- **任务 1 系统操作链**（两跑）：
  - 首跑（无代答）：读操作全通；open_app/move/close 弹 T1 横幅 30s 无人应答→超时拒绝，桌面零变动——**安全语义实证**；
  - 重跑（`org.agentos.Confirm1.Respond` 编程应答=测试通道，permissions.md §4.1）：7 步全通——开 ghostty（id 35）→移工作区 2（时间线 ws_id 5→6 即 idx 2 独立核验）→关闭→通知汇报；模型还自行用 list_workspaces 核对了 idx↔id 映射。
- **任务 2 GUI 计算链**：水族馆开 gnome-calculator → dump 树找按钮名 → 按名点 C/4/2/×/1/0/= → 读文本得 **420** → 截图（首轮被水族馆热键浮层遮挡，模型自主定位浮层不可 a11y、借 open_app 注入 Esc 关闭，终获清净截图）。附带三个诚实发现：①同名实例寻址歧义（见矩阵）；②T2 装包无头必超时（polkit 须人）；③goose 内建 shell 扩展不经 AgentOS 策略网关（策略面只覆盖 MCP 扩展）。
- **任务 3 文档链**：（跑后回填）

### 代答与真实点击的证据区分

矩阵中的 ✅ 不含"用户真实点击横幅"证据——本轮全部 T1 放行均为 `by=respond` 编程应答（490ms/390ms/550ms 级），真实点击（`by=notify-action`）当时由主会话用户另行复核。审计行天然区分两者。

## 附录 A：Qt 全局 a11y 开关验证

（VM 实测后回填）
