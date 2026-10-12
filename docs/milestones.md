# 里程碑开发计划

> 状态：v0.1（2026-10）。这是阶段性的路线图而非排期承诺——每个里程碑结束时会根据实际进展修订本文档。
> 时长按 1–2 人业余/兼职投入估算，全职可显著压缩。顺序大体线性，但 M5 可与 M4 并行启动。

## 总览

| 阶段 | 主题 | 估时 | 一句话退出标准 |
|---|---|---|---|
| **M0** | 奠基 | 1–2 周 | 一句话让 agent 开应用、摆窗口、报系统状态 |
| **M1** | 系统工具面 | 2–4 周 | 全对话完成“下载→整理→生成文档→调起 LibreOffice” |
| **M2** | 呈现层 | 3–4 周 | 任务产物统一进 artifacts 可回看；双通道呈现可用 |
| **M3** | agent 会话 | 4–6 周 | agent 在独立 GUI 会话完成真实网页表单且不打扰用户 |
| **M4** | 信任与安全 | 3–4 周 | 凭据零明文进上下文；误操作可回滚、可回放 |
| **M5** | 发行 | 2–4 周 | 全新机器 30 分钟从 ISO/脚本到可用对话 |

---

## M0 奠基（进行中）

**目标**：跑通最小闭环——agent 能通过 MCP 操作 niri 窗口/工作区，验证“goose + 自研 MCP server”这条集成路线。

范围：

- 仓库、架构文档、里程碑计划、凭据设计文档；
- 真机参考环境：CachyOS + niri + Noctalia（手工安装，形成安装笔记，为 M5 铺路）；
- goose 以 systemd user service 方式常驻（写 service 单元与配置样例）；
- **`niri-mcp` v0**：窗口/工作区查询、聚焦/移动/关闭窗口、spawn 应用。

退出标准：终端对话 → agent 打开、排列、关闭应用，并能报告当前窗口与工作区状态。

明确不做：UI、权限模型、GUI computer use。

## M1 系统工具面

**目标**：把 L0 层系统能力补齐，让 agent 能独立完成端到端任务。

范围：

- `desktop-mcp`：xdg-open、桌面通知、剪贴板读写、portal（打开文件/目录）；
- `system-mcp`：systemd/pacman/网络/磁盘的**只读**查询 + 少量白名单动作（装包走确认）；
- `files-mcp`：限定在 `~/Agent/` 工作区内的文件操作；
- 权限模型 v0：工具级 allowlist 配置 + 敏感动作经桌面通知确认；
- goose 会话/扩展目录规范化（哪些 MCP server 默认挂载、系统提示词基线）。

退出标准：不碰键盘鼠标，纯对话完成“下载文件 → 整理到工作区 → 生成一份文档 → 调起 LibreOffice 展示”。

## M2 呈现层

**目标**：agent 决定“怎么给用户看”，确立 artifacts 产品概念。

范围：

- artifacts 仓库：`~/Agent/works/` 落盘、任务索引、历史列表（聊天内可回看）；
- `canvas`：本地 HTTP 服务 + webview 窗口，生成式 UI（HTML/React 模板）、WebSocket 增量更新、niri 窗口规则自动摆位；
- office 链路打磨：文档模板、字体、中文排版检查（LibreOffice/WPS 双后端可配）；
- 结果通知：完成/失败/需确认三类通知，带“查看产物”动作。

退出标准：所有任务产物统一进 artifacts 且可回看；外发格式与生成式 UI 两条呈现通道可用。

## M3 agent 会话

**目标**：人机并发落地——agent 拥有自己的 GUI 会话（“水族馆”）。

范围：

- `session-manager`：嵌套 niri 会话生命周期管理（启动/回收/崩溃恢复）；
- 输入注入：ydotool 受控封装，输入只作用于 agent 会话（V1 嵌套窗口天然隔离；进阶做 seat 级隔离）；
- 视觉：grim 只截 agent 自己的输出；
- `atspi-mcp`：AT-SPI2 读树 + 触发 action（优先通道，视觉兜底）；
- 浏览器自动化接入（CDP 系，agent 会话内浏览器）；
- “水族馆”PiP 窗口：投屏 agent 会话，用户可围观/最小化。

退出标准：agent 在独立 GUI 会话完成一个真实网页表单提交 + 一个仅有 GUI 的应用操作，全程不干扰用户正在做的事。

## M4 信任与安全

**目标**：把“敢把电脑交给 agent”变成产品能力。

范围：

- **credential broker**（详见 [security/credentials.md](security/credentials.md)）：Secret Service（libsecret/gnome-keyring，兼容 Bitwarden/KeePassXC）为底座，1Password（CLI/Shell Plugins 模式）为增强；agent 拿能力不拿明文；
- 权限分级 v1：portal/polkit 集成，确认粒度“每次/仅此一次/永不”；
- 审计日志：agent 全部工具调用结构化落盘；
- 会话录屏与回放：gpu-screen-recorder 录 agent 会话；
- snapper 快照钩子：系统级变更前自动快照 + 一键回滚（“撤销 agent 的操作”）。

退出标准：任何密码类操作零明文进入 agent 上下文与日志；演示一次误操作的回滚与回放。

## M5 发行

**目标**：从“我电脑上的配置”变成“别人能装的系统”。

范围：

- meta-package（pacman/AUR）：打包全部组件与默认配置；
- 一键安装脚本（Omarchy 模式）：CachyOS 基础上一条命令得到 AgentOS；
- archiso respin 试点（视需）；
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
