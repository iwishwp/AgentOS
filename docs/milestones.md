# 里程碑开发计划

> 状态：v0.1（2026-10）。这是阶段性的路线图而非排期承诺——每个里程碑结束时会根据实际进展修订本文档。
> 时长按 1–2 人业余/兼职投入估算，全职可显著压缩。顺序大体线性，但 M5 可与 M4 并行启动。

## 总览

| 阶段 | 主题 | 估时 | 一句话退出标准 |
|---|---|---|---|
| **M0** | 奠基 | 1–2 周 | ✅ 一句话让 agent 开应用、摆窗口、报系统状态（2026-10-15 达成） |
| **M1** | 系统工具面 | 2–4 周 | ✅ 纯对话完成“下载→整理→生成文档→调起 LibreOffice”（2026-10-15 达成） |
| **M2** | 呈现层 | 3–4 周 | 任务产物统一进 artifacts 可回看；双通道呈现可用 |
| **M3** | agent 会话 | 4–6 周 | ✅ 独立会话完成真实表单提交 + GUI 应用操作，零干扰（2026-10-16 达成） |
| **M4** | 信任与安全 | 3–4 周 | ✅ 凭据零明文进上下文；误操作可回滚、可回放（2026-10-17 达成） |
| **M5** | 发行 | 2–4 周 | 全新机器 30 分钟从 ISO/脚本到可用对话 |

---

## M0 奠基（✅ 2026-10-15 完成）

**目标**：跑通最小闭环——agent 能通过 MCP 操作 niri 窗口/工作区，验证”goose + 自研 MCP server”这条集成路线。

范围：

- 仓库、架构文档、里程碑计划、凭据设计文档；
- 真机参考环境：Fedora + niri + Noctalia（手工安装，安装手册见 real-machine.md；基座决策 ADR-0001）；
- goose 以 systemd user service 方式常驻（service 单元草稿已落 `os/systemd/`，`goose serve` = ACP over HTTP/WebSocket）；
- **`niri-mcp` v0**：窗口/工作区查询、聚焦/移动/关闭窗口、spawn 应用。

**完成记录（2026-10-14/15，Fedora 44 aarch64 @ VMware Fusion 真机）**：
- L1 ✅ / L2 ✅ / desktop 链路 ✅ / **L3 ✅**——goose + GLM(coding plan, Anthropic 兼容端点) + niri-mcp/desktop-mcp，
  一句对话完成”列窗口 → 开 alacritty → 移到工作区 2 → 关闭 → 桌面通知”，全程走自研扩展工具；
- 33 个单测在 macOS 与 aarch64 Linux 双平台全绿；
- 顺带产出：基座评估数据（F44 仓库 niri 26.04；updates 内核 6.19→7.2 rebase）、
  vmrun/SSH 远程驱动真机验证的完整工作流、GLM 双端点接入文档。

退出标准：终端对话 → agent 打开、排列、关闭应用，并能报告当前窗口与工作区状态。**已达成。**

明确不做：UI、权限模型、GUI computer use。

## M1 系统工具面（✅ 2026-10-15 完成）

**目标**：把 L0 层系统能力补齐，让 agent 能独立完成端到端任务。

范围：

- `desktop-mcp`：xdg-open（含 app 指定应用打开）、桌面通知、剪贴板读写；✅ 真机验证
- `system-mcp`：systemd 服务/日志、包查询、网络、资源概况的**只读**查询；✅ 真机验证
- `files-mcp`：工作区沙箱文件操作（越界防护/回收站/查找/download）；✅ 真机验证
- **权限模型 v0**：`@agentos/policy`（allow/deny + 规则文件 + JSONL 审计日志），四个 server 全接入；✅
- **goose 会话规范化**：行为基线提示词 `os/configs/goose-system.md`（工具优先级/产物落位/office 用 app 参数/分寸），实测显著影响 agent 行为；✅

**完成记录（2026-10-15）**：退出标准全链路达成——纯对话完成"下载（files__download）
→ 整理到工作区（downloads→inbox）→ 生成 .fodt 文档 → LibreOffice 展示（desktop__open
app=libreoffice，窗口验证 soffice 26.2）→ 通知"。意外收获：给错了下载 URL，agent 自行
探测多镜像、找到可用源并如实报告差异——故障恢复能力超出预期。76 个单测双平台全绿。

退出标准：不碰键盘鼠标，纯对话完成"下载文件 → 整理到工作区 → 生成一份文档 → 调起 LibreOffice 展示"。**已达成。**

## M2 呈现层（进行中 · 核心已通）

**目标**：agent 决定“怎么给用户看”，确立 artifacts 产品概念。

范围：

- **canvas 本地服务**（`packages/canvas`）：安全静态托管 `~/Agent/canvas/` + 自动索引页，
  仅绑 127.0.0.1；✅ **已落地并真机验证**（2026-10-15：agent 采集真实系统数据生成深色
  仪表盘 → canvas 托管 → 浏览器呈现，生成式 UI 闭环打通）。systemd 单元
  `os/systemd/agentos-canvas.service` 已部署；
- artifacts 仓库：任务化索引与历史回看——canvas 索引页已覆盖 HTML 类；⬜ 全类型
  artifacts（文件/报告）的统一索引待做；
- 通知联动：完成/失败/需确认三类通知 + “查看产物”动作；⬜ 动作型通知待 mako 配置探索；
- office 链路：✅ M1 已实证（fodt 生成 + LibreOffice 展示）。

退出标准：所有任务产物统一进 artifacts 且可回看；外发格式与生成式 UI 两条呈现通道可用。

## M3 agent 会话（✅ 2026-10-16 完成）

**目标**：人机并发落地——agent 拥有自己的 GUI 会话（”水族馆”）。

范围：

- **`session-mcp`**：嵌套 niri 生命周期（start/stop/status）、会话内启动应用、会话内窗口查询、
  定向截图（grim 只截水族馆内部）；✅ **已落地并真机验证**（2026-10-16：水族馆窗口出现在
  用户桌面，agent 在内部开 Alacritty、截图并**通过视觉描述了自己看到的内容**——
  感知-操作闭环成立，全程不动用户焦点）；
- **`atspi-mcp`**：AT-SPI2 无障碍桥（列应用/倒树/**按名称点击/读写文本**——无需焦点）；✅ **已落地并真机验证**（2026-10-16：水族馆内 gnome-calculator 被 agent 全自主操作，6×7=42 显示屏读数确认；期间 agent 还自己发现并修复了桥的角色名白名单 bug）；
- 输入注入：ydotool 受控封装——**优先级降低**：a11y 通道已覆盖主要 GUI 操作，ydotool 仅作非无障碍应用兜底；⬜ 待做
- 浏览器自动化（agent 会话内浏览器）；✅ **完成**——browser-mcp（Chromium+原生 CDP，零依赖），
  两个决定性修复：① `--password-store=basic`（钥匙环锁定会阻塞网络服务，本日悬案根因，由用户
  在屏幕上看到的 keyring 弹窗定位）；② 默认无头启动（agent 视觉由 CDP 截图承担，有头在嵌套
  Wayland 不稳）。退出标准实证：必应搜索表单全链路（打开→填入→提交→读第一条结果→截图→通知），
  且百度被风控时 **agent 主动拒绝破解验证码**（行为基线的分寸条款生效）。
- “水族馆”窗口规则（自动摆位/尺寸）；⬜ 打磨项

关键技术记录（详见 real-machine.md 实测）：GTK4 需 AT 客户端注册后才暴露完整无障碍树（16→105 节点）；libadwaita 嵌套深（按钮在 8 层以下）；**树结构跨 AT 连接会重建，索引路径不可跨进程使用——操作必须按名称寻址**；GTK3/4 角色名不一致（push button vs button）。

退出标准：agent 在独立 GUI 会话完成一个真实网页表单提交 + 一个仅有 GUI 的应用操作，全程不干扰用户正在做的事。（GUI 应用操作部分已达成，表单部分待浏览器自动化接入）

## M4 信任与安全 ✅（2026-10-17 退出标准达成，实测详录 real-machine.md 当日条目）

**目标**：把”敢把电脑交给 agent”变成产品能力。

范围（全部落地）：

- **credential broker ✅ 三通道齐装**（详见 [security/credentials.md](security/credentials.md)）：Secret Service
  （libsecret/gnome-keyring）为底座；agent 拿能力不拿明文——**A 自动填充**（CDP 页面内设值 + 逐字节
  matches 复核 + 只回长度/sha256，非安全上下文 broker 端补算）、**B 代执行**（白名单 + 输出打码，
  哈希严格一致实证）、**C 短期注入**（TTL 收割实测 3.2s）——2026-10-17 VM 六场景冒烟全过，
  全量审计明文扫描零命中；
- **Keyring 自动解锁（✅ 2026-10-17 验收通过）**：注销重登实测——PAM 拉起单实例 daemon、
  secret-tool 写入探针瞬时成功、零弹窗（方案与实测详录 credentials.md §5.1）；
- **权限分级 v1 ✅**：`@agentos/policy` 决策值 confirm + 六个 server 统一策略网关 +
  `org.agentos.Confirm1` D-Bus 服务（T1 确认流五条应答路径实测：allow_once/allow_session/
  deny_once/always_deny/30s 超时；always_deny 写回 policy.yaml 实证；拒绝后不执行实证）；
  T2 走 pkexec 专用 helper + polkit 强认证 + 装前只读快照（`system.package_install` 全链 VM 实测）。
  载体决策：Fedora mako 1.11 不渲染动作按钮 → 每个选择一条横幅、点击即选（见 permissions.md §4.1 修订）；
- **审计日志 ✅**：全部工具调用结构化落盘（tier/confirm/snapshot 扩字段），canvas `/api/audit`
  暴露 + `/replay` 时间轴页渲染实测（186 条真实事件）；
- 会话录屏与回放：gpu-screen-recorder 录 agent 会话——**v1 已落地并 VM 实测**（`scripts/record-session.sh`
  录水族馆输出；gsr 调研结论：其 KMS/portal 架构只能录物理屏，不能只录嵌套会话，故水族馆走 grim|ffmpeg
  通道，gsr 留作整屏场景；详见 [session-recording.md](session-recording.md)）；
- **snapper 快照钩子 ✅ 与 T2 自动串联**：装包 helper 装前强制只读快照（无快照不安装）；
  回滚演示完成——审计时间轴定位误操作 → 快照启动实证回滚态 → 撤销落定（本机 fstab/rootflags
  钉死 subvol 的限制与无人值守路径见 real-machine.md；永久化提升指向 M5 bootc/atomic）。

退出标准 ✅：**零明文**——密码类操作（凭据三通道、polkit 认证）实测明文不进 agent 上下文与日志
（审计 grep 零命中；认证框密码由 ydotool 键盘直输 GUI，不经过 agent）；**回滚与回放**——
"agent 误装包 → /replay 时间轴定位 → 快照回滚（sl 实证消失）→ 撤销落定"全程命令与输出留证。
遗留待用户在场复核两项：真实鼠标点选横幅、真人输 polkit 密码（无人值守已分别由 makoctl invoke
与 ydotool 键盘驱动覆盖信号等价路径）。

## M5 发行（进行中 · 已完成 X，2026-10-17 晚）

**目标**：从“我电脑上的配置”变成“别人能装的系统”。

**已完成（本里程碑累计，详录 [m5-atomic.md](m5-atomic.md)）**：

- ✅ **Atomic 镜像构建链（aarch64）**：bootc OCI 镜像 `agentos:dev-aarch64`
  4.43GB/84 层，容器内冒烟全过（Mac 中转 skopeo 方案破 quay 网络阻断，附 A）；
- ✅ **greenboot 自动回滚接入**：检查脚本 + preset 声明，qemu/Fusion 真实引导
  验证 healthcheck active、检查通过、grubenv 落盘（§8.1；负路径回滚演示待做）；
- ✅ **CI 双架构 workflow**：`.github/workflows/build-image.yml`（原生 runner
  matrix，bootc 含内核必须原生构建）；本地三重静态校验过，**未实跑**（无 remote）；
- ✅ **bootc-image-builder 产物**：qcow2 2.0GB（sha256 见附 B），预置 demon/wheel
  + sshd；构建配置与五个踩坑实录入档（附 B）；
- ✅ **Fusion 点亮**：arm VM 从 vmdk 引导，SDDM（Wayland greeter）active、
  graphical.target 达成、canvas HTTP 200、goose 1.55.0 在位；VM 保留运行
  供亲验（附 C；streamOptimized 只读坑已定位并绕开）；
- ✅ **30 分钟演练**：产物在手 → 可用对话 ≈**11 分钟**（达标；附 D 差距分析）。

**未完成（遗留，见 m5-atomic.md §10 遗留清单）**：x86_64 构建（CI 实跑）、
ISO 安装介质（bib 类型已换代需实测）、M1 端到端任务在新 VM 重放（需 API key）、
greenboot 负路径回滚演示、ghostty/镜像终端断层（决策待定 D1/D2，§9）。

范围（原始定义，含未启动项）：

- **Atomic 镜像 PoC（默认方向，ADR-0001）**：基于 Fedora bootc 基础镜像构建 AgentOS OCI 镜像
  （niri + 全组件 + 默认配置），对照 Bazzite 参考实现——host 不可变、原子更新、自动回滚；
- 一键安装脚本（过渡路径）：Fedora Workstation 基础上一条命令得到 AgentOS（已就绪）；
- meta-package/RPM：打包全部组件与默认配置（pacman/AUR 分支保留作社区变体）；
- 默认配置打磨（LanRhyme 风格视觉、中文环境、输入法 fcitx5-rime）；
- 用户文档与官网/文档站。

退出标准：全新机器 30 分钟内完成安装并跑通 M1 的端到端任务。
（窗口内实测 11 分钟到「可用对话」；M1 端到端重放待用户 API key 环境。）

---

## 跨阶段事项

- **节奏**：macOS 上开发（fake runner 单测 + MCP 冒烟），每阶段收尾在真机 Linux 回归；
- **文档随代码走**：每阶段结束修订本文档与 architecture.md 的对应章节；
- **上游关系**：goose / niri / Noctalia 均只集成不 fork，本地补丁以 PR 回馈为目标。

## 风险与应对

| 风险 | 应对 |
|---|---|
| niri headless/串流生态不成熟（Hyprland 已知有坑） | V1 用嵌套方案绕开 headless 依赖 |
| ydotool 权限模型粗、无 seat 隔离 | V1 靠嵌套窗口隔离；必要时自研受控 uinput 守护 |
| goose 上游 API 演进 | 只通过 MCP 集成，不依赖其内部接口 |
| 视觉 computer use 又贵又慢 | 架构上它只是 L3 兜底，L0/L1 承担主力 |
| 凭据方案平台差异大 | broker 抽象层隔离，Secret Service 为最大公约数 |

## 变更记录

- 2026-10-12 v0.1 初稿：M0–M5 六个里程碑及退出标准。
