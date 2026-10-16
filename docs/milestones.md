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
| **M4** | 信任与安全 | 3–4 周 | 凭据零明文进上下文；误操作可回滚、可回放 |
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

## M4 信任与安全

**目标**：把”敢把电脑交给 agent”变成产品能力。

范围：

- **credential broker**（详见 [security/credentials.md](security/credentials.md)）：Secret Service（libsecret/gnome-keyring，兼容 Bitwarden/KeePassXC）为底座，1Password（CLI/Shell Plugins 模式）为增强；agent 拿能力不拿明文——**通道 B（代执行）已实现并实证**（cred-mcp：白名单代执行 + 输出打码，2026-10-17 哈希严格一致、偷看拦截、审计零明文）；通道 A（自动填充）/C（短期注入）待做；
- **Keyring 自动解锁（✅ 2026-10-17 验收通过）**：注销重登实测——PAM 拉起单实例 daemon、secret-tool 写入探针瞬时成功、零弹窗（方案与实测详录 credentials.md §5.1）；
- 权限分级 v1：portal/polkit 集成，确认粒度“每次/仅此一次/永不”——**设计已定稿**（三档映射/policy.yaml
  逐档示例/pkexec 装包确认路径，见 [permissions.md](permissions.md)），实现待做；
- 审计日志：agent 全部工具调用结构化落盘；
- 会话录屏与回放：gpu-screen-recorder 录 agent 会话——**v1 已落地并 VM 实测**（`scripts/record-session.sh`
  录水族馆输出；gsr 调研结论：其 KMS/portal 架构只能录物理屏，不能只录嵌套会话，故水族馆走 grim|ffmpeg
  通道，gsr 留作整屏场景；详见 [session-recording.md](session-recording.md)）；
- snapper 快照钩子：系统级变更前自动快照 + 一键回滚（“撤销 agent 的操作”）——**脚本与 root 配置已落地
  并 VM 实测**（`scripts/snapshot.sh` + [os/snapper/README.md](../os/snapper/README.md)：手动/钩子触发、
  无定时、只读快照；与 dnf 的自动串联待权限分级落地后接）。

退出标准：任何密码类操作零明文进入 agent 上下文与日志；演示一次误操作的回滚与回放。

## M5 发行

**目标**：从“我电脑上的配置”变成“别人能装的系统”。

范围：

- **Atomic 镜像 PoC（默认方向，ADR-0001）**：基于 Fedora bootc 基础镜像构建 AgentOS OCI 镜像
  （niri + 全组件 + 默认配置），对照 Bazzite 参考实现——host 不可变、原子更新、自动回滚；
- 一键安装脚本（过渡路径）：Fedora Workstation 基础上一条命令得到 AgentOS（已就绪）；
- meta-package/RPM：打包全部组件与默认配置（pacman/AUR 分支保留作社区变体）；
- 默认配置打磨（LanRhyme 风格视觉、中文环境、输入法 fcitx5-rime）；
- 用户文档与官网/文档站。

退出标准：全新机器 30 分钟内完成安装并跑通 M1 的端到端任务。

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
