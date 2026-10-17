# AgentOS（暂名）

> agent 优先的 Linux 桌面操作系统——用户只与 agent 对话，其余一切由 agent 完成并决定呈现方式。

受 [Omarchy](https://omarchy.org) 启发，技术底座与核心思路：

- **底座**：**Fedora**（[ADR-0001](docs/decisions/0001-base-distribution.md) 定案）+
  [niri](https://github.com/niri-wm/niri)（滚动平铺 Wayland 合成器，JSON IPC）+
  [Noctalia](https://github.com/noctalia-dev/noctalia)（QuickShell 桌面 shell，视觉参考
  [LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles)，莫兰迪配色 + 合成器侧毛玻璃）；
  M5 以 Atomic（bootc/OCI）镜像发行，Bazzite 同构
- **agent 引擎**：[goose](https://github.com/aaif-goose/goose)（Apache-2.0），以 systemd
  用户服务常驻，集成而非 fork
- **agent 的手**：自研 MCP servers——niri 窗口管理、桌面（打开/通知/确认）、系统、文件、
  凭据代理、水族馆会话、AT-SPI2 无障碍树、浏览器（CDP），40+ 工具统一过策略网关
- **agent 的眼**：独立嵌套 GUI 会话（"水族馆"）——人与 agent 并发操作互不干扰；
  无障碍树优先、视觉兜底
- **呈现层**：外发格式调起 LibreOffice；agent 原生内容走"生成式 UI"（canvas：仪表盘、
  键位速查 `/keys`、审计回放 `/replay`）
- **安全**：凭据零明文进上下文（broker 三通道：自动填充/代执行/短期注入）、
  分级确认（`org.agentos.Confirm1` + polkit 强认证）、全量审计、btrfs 快照一键回滚
- **默认终端**：Ghostty（Catppuccin Frappé + niri 合成器侧毛玻璃）

## 状态与日志

里程碑 M0–M4 已完成（退出标准全部真机达成），M5 发行进行中——状态表与逐项
完成记录见 [docs/milestones.md](docs/milestones.md)；日常落地与待办清单见
[DEVLOG.md](DEVLOG.md)。

## 快速开始

真机/虚拟机（Fedora，x86_64 主线 / aarch64 冒烟）：

```bash
./os/install.sh               # 系统包 + 构建 + 测试（--skip-packages 跳过系统包）
./os/install.sh --with-goose  # 顺带安装 goose CLI
./scripts/install-noctalia.sh # 桌面 shell（v4.7.1 + 兼容补丁集）
./scripts/apply-lanrhyme-theme.sh  # 莫兰迪观感（配色/壁纸/栏位）
```

开发机（任意平台，测试不依赖真实桌面环境）：

```bash
npm install && npm run build && npm test
```

Atomic 镜像（bootc，需 podman）：`./scripts/build-image.sh --smoke`，
设计与构建记录见 [docs/m5-atomic.md](docs/m5-atomic.md)。

接入 goose（stdio MCP server）示例配置见 [docs/goose-integration.md](docs/goose-integration.md)。

## 文档

- [架构设计](docs/architecture.md)
- [里程碑开发计划](docs/milestones.md)
- [开发日志与待办](DEVLOG.md)
- [凭据代理与密码管理集成](docs/security/credentials.md)
- [权限分级 v1（三档/portal/polkit）](docs/permissions.md)
- [会话录屏与回放](docs/session-recording.md)
- [goose 接入说明](docs/goose-integration.md)
- [真机安装与验证手册](docs/real-machine.md)
- [桌面 shell（Noctalia 选版/补丁矩阵）](docs/noctalia.md) · [默认终端（Ghostty）](docs/ghostty.md) · [键位](docs/keyboard.md)

## License

Apache-2.0
