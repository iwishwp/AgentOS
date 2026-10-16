# AgentOS（暂名）

> agent 优先的 Linux 桌面操作系统——用户只与 agent 对话，其余一切由 agent 完成并决定呈现方式。

受 [Omarchy](https://omarchy.org) 启发，技术底座与核心思路：

- **底座**：**Fedora**（[ADR-0001](docs/decisions/0001-base-distribution.md) 定案：更新安全模型与 aarch64 一等支持契合 agent OS；M5 以 Atomic/bootc 镜像发行）+ [niri](https://github.com/niri-wm/niri)（Rust 滚动平铺 Wayland 合成器，JSON IPC + 事件流）+ [Noctalia](https://github.com/noctalia-dev/noctalia)（QuickShell 桌面 shell，视觉参考 [LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles)）；CachyOS/Arch 保留为社区变体
- **agent 引擎**：[goose](https://github.com/aaif-goose/goose)（Agentic AI Foundation / Linux Foundation，Apache-2.0），以 systemd 用户服务常驻，集成而非 fork
- **agent 的手**：一组自研 MCP servers——窗口管理（niri IPC）、应用启动（xdg-open/portal）、文件、通知、无障碍树（AT-SPI2）等系统能力
- **agent 的眼**（后期）：独立嵌套 GUI 会话（“水族馆”）+ AT-SPI2 无障碍树优先 + 截图指针兜底，人与 agent 并发操作互不干扰
- **呈现层**：外发格式调起 LibreOffice/WPS；agent 原生内容走“生成式 UI”（canvas / artifacts）
- **安全**：凭据走 broker 代理（agent 可用、不可读），分级确认、审计回放、btrfs 快照一键回滚

## 当前状态

🚧 **M4 信任与安全（下一个）**——**M0–M3 已全部完成**（2026-10-16）：四个里程碑退出标准全部
真机达成，最新一战是 agent 在水族馆里自主完成真实网页表单提交（必应搜索全链路）与 GUI 应用
零焦点操作（计算器 a11y）。十一个包：7 个 MCP server（niri/desktop/system/files/session/
atspi/browser，共 40+ 工具）+ policy（策略与审计）+ proc + canvas；118 个测试全绿；
keyring 悬案告破（自动解锁已列为 M4 首个验收项）。

## 快速开始

真机/虚拟机（Arch/CachyOS 或 Fedora，支持 x86_64 与 aarch64 冒烟）：

```bash
./os/install.sh               # 系统包 + 构建 + 测试（--skip-packages 跳过系统包）
./os/install.sh --with-goose  # 顺带安装 goose CLI
```

开发机（任意平台，测试不依赖真实桌面环境）：

```bash
npm install && npm run build && npm test
```

接入 goose（stdio MCP server）示例配置见 [docs/goose-integration.md](docs/goose-integration.md)。

## 文档

- [架构设计](docs/architecture.md)
- [里程碑开发计划](docs/milestones.md)
- [凭据代理与密码管理集成](docs/security/credentials.md)
- [goose 接入说明](docs/goose-integration.md)
- [真机安装与 M0 验证手册](docs/real-machine.md)

## License

Apache-2.0
