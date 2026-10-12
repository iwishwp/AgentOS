# AgentOS（暂名）

> agent 优先的 Linux 桌面操作系统——用户只与 agent 对话，其余一切由 agent 完成并决定呈现方式。

受 [Omarchy](https://omarchy.org) 启发，技术底座与核心思路：

- **底座**：CachyOS（Arch 系，btrfs 默认，性能内核）+ [niri](https://github.com/YaLTeR/niri)（Rust 滚动平铺 Wayland 合成器，JSON IPC + 事件流）+ [Noctalia](https://github.com/noctalia-dev/noctalia)（QuickShell 桌面 shell，视觉参考 [LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles)）
- **agent 引擎**：[goose](https://github.com/block/goose)（Agentic AI Foundation / Linux Foundation，Apache-2.0），以 systemd 用户服务常驻，集成而非 fork
- **agent 的手**：一组自研 MCP servers——窗口管理（niri IPC）、应用启动（xdg-open/portal）、文件、通知、无障碍树（AT-SPI2）等系统能力
- **agent 的眼**（后期）：独立嵌套 GUI 会话（“水族馆”）+ AT-SPI2 无障碍树优先 + 截图指针兜底，人与 agent 并发操作互不干扰
- **呈现层**：外发格式调起 LibreOffice/WPS；agent 原生内容走“生成式 UI”（canvas / artifacts）
- **安全**：凭据走 broker 代理（agent 可用、不可读），分级确认、审计回放、btrfs 快照一键回滚

## 当前状态

🚧 **M0 奠基阶段**——仓库与设计文档落地中，第一个 MCP server（`niri-mcp`）开发中。

## 快速开始

（开发期）体验 `niri-mcp`（需在 niri 会话内才有真实数据；无 niri 时仅能跑单测）：

```bash
npm install        # 仓库根目录
npm run build      # 构建所有 packages
npm test           # 跑通所有测试（含 MCP 冒烟测试，不依赖 niri）
```

接入 goose（stdio MCP server）示例配置见 [docs/goose-integration.md](docs/goose-integration.md)。

## 文档

- [架构设计](docs/architecture.md)
- [里程碑开发计划](docs/milestones.md)
- [凭据代理与密码管理集成](docs/security/credentials.md)
- [goose 接入说明](docs/goose-integration.md)

## License

Apache-2.0
