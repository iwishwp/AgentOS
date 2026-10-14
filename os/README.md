# os/ — 发行物目录

AgentOS 面向最终用户的部分，当前是 M5（发行）的种子，随里程碑逐步充实：

| 文件/子目录 | 状态 | 说明 |
|---|---|---|
| `install.sh` | ✅ 可用 | 开发环境一键安装：系统包（pacman/dnf）+ 构建 + 测试，支持 `--skip-packages` / `--with-goose` |
| `systemd/agentos-goose.service` | 草稿 | goose 常驻（`goose serve`，ACP over HTTP/WebSocket，127.0.0.1:3284），密钥走 EnvironmentFile；真机验证后转正 |
| `metapackage/` | 计划 M5 | pacman meta-package（AgentOS 全组件 + 默认配置） |
| `archiso/` | 计划 M5 | archiso respin 配置（出 ISO） |

## 架构策略

`install.sh` 同时接受 x86_64 与 aarch64（Apple Silicon 虚拟机冒烟路径走 dnf/Fedora），
但**主线支持与发行目标只有 x86_64**，详见 [architecture.md §7.1](../docs/architecture.md)。
