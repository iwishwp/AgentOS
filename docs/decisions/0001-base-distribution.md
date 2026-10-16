# ADR-0001：基座发行版选型——Fedora

- **状态**：已接受（2026-10-17）
- **决策者**：项目维护者（讨论见会话记录 2026-10-13/15）
- **替代方案**：CachyOS（初始假设）、Arch + archiso（Omarchy 同构模式）、Ubuntu 系

## 背景

项目立项时按 Omarchy 模式选定 CachyOS（Arch 系）为基座。开发过程中因 Apple Silicon 测试
需要转向 Fedora aarch64，一个月的实测（M0–M3 全部真机验证、50+ 提交的排错知识）都在
Fedora 44 上完成，同时采集到决定性数据。

## 决策依据（全部实测/官方确认）

| 维度 | 事实 | 来源 |
|---|---|---|
| 更新安全模型 | agent 代用户跑更新是常态。Arch 的安全前提是"升级前读人工干预公告"，对无人值守 agent 不成立；Fedora 每版是过 QA 门禁的快照 + bodhi karma | 架构讨论（2026-10-13） |
| 内核跟进 | F44 updates 仓库内内核 6.19 → 7.2.10 rebase（版内跟进实证） | VM 实测 |
| niri 可用性 | F44 官方仓库 niri 26.04（落后上游约一个小版本）；上游维护者有官方 COPR 可追最新 | VM 实测 |
| aarch64 | Fedora 一等公民（Asahi 官方形态）；**CachyOS 无 aarch64 镜像**（官方确认：等 Arch Linux ARM 上游成熟） | 官方论坛 |
| goose | 官方发布 arm64 Linux 二进制 | 安装脚本声明 |
| 信任架构契合 | M4/M5 需要"agent 误操作可回滚"：Fedora 有 Atomic（bootc/OCI 镜像，Bazzite 生产实证）路线，更新原子化、失败自动回滚 | Bazzite/uBlue 生态调研 |
| 实测积累 | 全部排错手册、systemd 单元、审计日志以 Fedora/dnf 环境验证 | real-machine.md |

## 决策

1. **Tier 1 基座：Fedora Workstation**（当前 F44+，滚动跟进最新两个稳定版）。开发、验证、
   文档主线全部以 dnf 环境为准。
2. **CachyOS/Arch 降级为社区变体**：`install.sh` 与 `system-mcp` 的 pacman 分支保留（双发行版
   适配已实现），不再作为主线投入。
3. **M5 发行形态：Fedora Atomic（bootc/OCI 镜像）为默认方向**——AgentOS 整体作为镜像在 CI
   构建（Bazzite 模式），host 不可变、agent 装软件走容器/分层、更新即拉新镜像、失败自动回滚；
   过渡期保留"Workstation + meta-package + 安装脚本"的低门槛起步路径（Omarchy 模式）。

## 代价与已知风险

- **RPM/COPR 重于 PKGBUILD**，AUR 生态不可用：Wayland 长尾小工具偶尔需自建 COPR（核心栈已
  验证全部在官方仓库）；
- **失去 CachyOS 性能叙事**（x86-64-v3 优化包、BORE 调度器）：可用 COPR/自建镜像补，但
  "出厂即优化"卖点让位于"信任/安全"卖点——agent OS 的瓶颈在 agent 延迟而非内核 3%；
- **半年大版本节奏**：Atomic 形态下基本消除（bootc 切镜像如 pull 容器）；Workstation 形态
  需 `dnf system-upgrade`；
- **团队学习成本**：M5 需掌握 bootc/OCI 镜像构建（对照 Bazzite 参考实现）。

## 迁移动作（本 ADR 附带）

- architecture.md §7 底座描述改为 Fedora 主线；
- milestones.md M5 范围改为 Atomic 镜像方向；
- README 底座一句话更新；
- real-machine.md 标注 Fedora 为主路径、CachyOS 段落保留作历史参考。

## 待验证（后续）

- x86_64 真机完整跑通 `os/install.sh`（当前全部验证在 aarch64 VM，Tier 1 承诺架构）；
- Atomic 镜像 PoC：基于 bootc 基础镜像装 niri + 全部组件（M5 首项）。
