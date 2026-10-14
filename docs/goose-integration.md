# goose 接入说明

> niri-mcp 是一个 stdio MCP server，任何 MCP 客户端都能挂载；本文以 goose 为例（我们默认的 agent 引擎）。

## 安装 goose

```bash
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
goose configure   # 配置模型 provider
```

## 接入 GLM（OpenAI 兼容端点，国内直连）

goose 1.54 实测（2026-10，aarch64 VM）。`~/.config/goose/config.yaml`：

```yaml
GOOSE_PROVIDER: openai
GOOSE_MODEL: glm-5.3-flash
```

密钥与端点放 `~/.config/agentos/goose.env`（权限 600，不进 git）：

```bash
OPENAI_API_KEY=<你的key>
OPENAI_BASE_URL=https://open.bigmodel.cn        # 只能是主机部分！
OPENAI_BASE_PATH=/api/paas/v4/chat/completions  # 完整路径放这里
```

**URL 拼接的三个坑（实测）**：
1. 用 `OPENAI_HOST=https://open.bigmodel.cn/api/paas/v4` → goose 追加 `/v1/chat/completions` 得到 404（它对非 `/v1` 结尾的 host 强拼 v1）；
2. `OPENAI_BASE_URL` 带 `/api/paas/v4` 路径 → 路径被丢弃（405，只剩主机 + BASE_PATH）；
3. 正确姿势 = BASE_URL 只给主机，BASE_PATH 给全路径。

模型选择：`glm-5.3-flash` 实测可用且便宜（带思考，工具调用走 function calling）；
`glm-5.3-flashx` 更快但同样计费；API 报错提示里的 `glm-4.5-air:free` 实际不存在。
最小验证：`goose run -t "只回复两个字:收到"`。

> 本机网络到 GitHub release 被重置时，在 Mac 下载
> `goose-aarch64-unknown-linux-gnu.tar.gz` 后 `scp` 进 VM 安装。

## 前置条件

- 在 niri 会话内运行（`niri msg` 依赖 `NIRI_SOCKET` 环境变量指向 niri 的 IPC socket）；
- Node.js ≥ 20；
- 仓库根目录已执行 `npm install && npm run build`。

## 挂载到 goose

goose 的 MCP 扩展配置在 `~/.config/goose/config.yaml`（不同版本字段名略有差异，以
`goose configure` 向导生成的格式为准）。两个 server 都挂上：

```yaml
extensions:
  niri:
    type: stdio
    command: node
    args:
      - /path/to/AgentOS/packages/niri-mcp/dist/index.js
    envs:
      NIRI_SOCKET: ${NIRI_SOCKET}
  desktop:
    type: stdio
    command: node
    args:
      - /path/to/AgentOS/packages/desktop-mcp/dist/index.js
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

- M0：niri-mcp（窗口/工作区/spawn）+ goose systemd 服务化（user service 单元，待 L3 定稿）；
- M1：`desktop-mcp`（xdg-open/通知/剪贴板，已落地）后续接 `system-mcp`、`files-mcp`；
- M3：事件流（`niri msg` 的 window/workspace 事件）接入 goose 上下文，让 agent 感知桌面变化。
