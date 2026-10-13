# goose 接入说明

> niri-mcp 是一个 stdio MCP server，任何 MCP 客户端都能挂载；本文以 goose 为例（我们默认的 agent 引擎）。

## 安装 goose

```bash
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
goose configure   # 配置模型 provider
```

## 前置条件

- 在 niri 会话内运行（`niri msg` 依赖 `NIRI_SOCKET` 环境变量指向 niri 的 IPC socket）；
- Node.js ≥ 20；
- 仓库根目录已执行 `npm install && npm run build`。

## 挂载到 goose

goose 的 MCP 扩展配置在 `~/.config/goose/config.yaml`（不同版本字段名略有差异，以
`goose configure` 向导生成的格式为准）：

```yaml
extensions:
  niri:
    type: stdio
    command: node
    args:
      - /path/to/AgentOS/packages/niri-mcp/dist/index.js
    envs:
      NIRI_SOCKET: ${NIRI_SOCKET}
```

或用向导添加：

```bash
goose configure --add-extension \
  --name niri \
  --command node --args /path/to/AgentOS/packages/niri-mcp/dist/index.js
```

## 验证

```bash
# 1. 会话内直接对话验证：
goose session
> 列出当前所有窗口
> 把 firefox 移到第 3 个工作区

# 2. 不经过 goose，直接手测 server（MCP inspector）：
npx @modelcontextprotocol/inspector node packages/niri-mcp/dist/index.js
```

## 常见问题

| 现象 | 原因 |
|---|---|
| `无法启动 niri` | 不在 niri 会话内，或 PATH 里没有 niri；可用 `NIRI_MSG_BIN` 指定绝对路径 |
| 动作报参数错 | niri 版本间 action 参数面有差异，以 `niri msg action --help` 输出为准 |

## 路线

- M0：本 server（窗口/工作区/spawn）；
- M1：`desktop-mcp`（xdg-open/通知/剪贴板）、`system-mcp`、`files-mcp` 陆续挂载；
- M3：事件流（`niri msg` 的 window/workspace 事件）接入 goose 上下文，让 agent 感知桌面变化。
