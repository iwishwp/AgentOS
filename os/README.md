# os/ — 发行物目录

AgentOS 面向最终用户的部分，当前是 M5（发行）的种子，随里程碑逐步充实：

| 文件/子目录 | 状态 | 说明 |
|---|---|---|
| `install.sh` | ✅ 可用 | 开发环境一键安装：系统包（pacman/dnf）+ 构建 + 测试，支持 `--skip-packages` / `--with-goose` |
| `systemd/agentos-goose.service` | 草稿 | goose 常驻（`goose serve`，ACP over HTTP/WebSocket，127.0.0.1:3284），密钥走 EnvironmentFile；真机验证后转正 |
| `configs/niri/config.kdl` | 草稿 | niri 会话默认键位模板（Omarchy 风格子集，含 `spawn-at-startup "mako"` 与状态栏自启）。部署到 `~/.config/niri/config.kdl`；键位文档见 [docs/keyboard.md](../docs/keyboard.md)，调研出处见 [docs/omarchy-keybindings-research.md](../docs/omarchy-keybindings-research.md)。待真机 `niri validate` 后转正 |
| `configs/ghostty/config` | 🆕 VM 已实证 | 默认终端 ghostty 配置（Catppuccin Frappé 主题 + Noto CJK 字体 + 半透明；模糊由同目录 niri 配置的 `background-effect` 窗口规则提供）。部署到 `~/.config/ghostty/config`；调研与真机实证见 [docs/ghostty.md](../docs/ghostty.md)。alacritty 保留为回退 |
| `configs/noctalia/` | ✅ VM 已启用 | Noctalia（legacy-v4）状态栏/桌面 shell 的兼容补丁集（上游 v4.7.1，适配 Fedora quickshell 0.2.1）。安装：`scripts/install-noctalia.sh`；选版论证/兼容矩阵/升级路径见 [docs/noctalia.md](../docs/noctalia.md)。`lanrhyme/` + `scripts/apply-lanrhyme-theme.sh` 为 LanRhyme 观感移植（垂直栏/莫兰迪配色/壁纸）。waybar 过渡配置保留在 `configs/waybar/` 作为回退 |
| `configs/theming/` | 🆕 美化样板 | niri 美学（间距/动画/莫兰迪色板）+ CJK 字体回退 + GTK 主题；方案见 docs/theming.md |
| `snapper/` | 🆕 M4 已配置 | btrfs 快照策略（agent 系统级变更前必须先快照）：配置记录、回滚流程与 VM 实测；配套 `scripts/snapshot.sh` |
| `bootc/` | 🆕 M5 Atomic PoC | Fedora Atomic（bootc/OCI）镜像定义：Containerfile 分层结构（含 greenboot 自动回滚层）+ 首启动脚本 + user 单元 + greenboot 健康检查 + 磁盘镜像构建配置（`disk-image-config.toml`）。构建入口 `scripts/build-image.sh`，CI 双架构 `.github/workflows/build-image.yml`；设计与验证记录见 [docs/m5-atomic.md](../docs/m5-atomic.md) |
| `metapackage/` | 计划 M5 | pacman meta-package（AgentOS 全组件 + 默认配置） |
| `archiso/` | 计划 M5 | archiso respin 配置（出 ISO） |

## 架构策略

`install.sh` 同时接受 x86_64 与 aarch64（Apple Silicon 虚拟机冒烟路径走 dnf/Fedora），
但**主线支持与发行目标只有 x86_64**，详见 [architecture.md §7.1](../docs/architecture.md)。
