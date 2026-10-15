# goose 接入说明

> niri-mcp 是一个 stdio MCP server，任何 MCP 客户端都能挂载；本文以 goose 为例（我们默认的 agent 引擎）。

## 安装 goose

```bash
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
goose configure   # 配置模型 provider
```

## 接入 GLM

### 路径 A：Coding Plan 的 key（推荐，套餐内额度）—— Anthropic 兼容端点

Coding plan 的资源包**不在** OpenAI 兼容端点上（`/api/paas/v4` 会报"余额不足"，即使套餐有额度）。走 Anthropic 兼容端点：

`~/.config/goose/config.yaml`：
```yaml
GOOSE_PROVIDER: anthropic
GOOSE_MODEL: glm-5.3-flash   # 或 glm-5.3；套餐内模型在 Anthropic 端点均走 plan 额度
```

`~/.config/agentos/goose.env`（权限 600）：
```bash
ANTHROPIC_API_KEY=<coding-plan-key>
ANTHROPIC_HOST=https://open.bigmodel.cn/api/anthropic
```

goose 的 anthropic provider 会拼 `ANTHROPIC_HOST + /v1/messages`，实测通过（2026-10）。
`glm-5.3-flash` 在此端点同样走套餐额度且工具调用正常（实测）；"余额不足"只出现在
OpenAI 兼容端点——套餐额度不覆盖那条路，与模型无关。

### 路径 B：按量付费 key —— OpenAI 兼容端点

```yaml
GOOSE_PROVIDER: openai
GOOSE_MODEL: glm-5.3-flash   # flash 系列不在 coding plan 包内，仅按量付费可用
```

```bash
OPENAI_API_KEY=<按量key>
OPENAI_BASE_URL=https://open.bigmodel.cn        # 只能是主机部分！
OPENAI_BASE_PATH=/api/paas/v4/chat/completions  # 完整路径放这里
```

**URL 拼接的三个坑（实测）**：
1. `OPENAI_HOST=.../api/paas/v4` → goose 追加 `/v1/chat/completions` 得到 404（对非 `/v1` 结尾的 host 强拼 v1）；
2. `OPENAI_BASE_URL` 带路径 → 路径被丢弃（405）；
3. 正确姿势 = BASE_URL 只给主机，BASE_PATH 给全路径。

> 本机网络到 GitHub release 被重置时，在 Mac 下载
> `goose-aarch64-unknown-linux-gnu.tar.gz` 后 `scp` 进 VM 安装。

## 前置条件

- 在 niri 会话内运行（`niri msg` 依赖 `NIRI_SOCKET` 环境变量指向 niri 的 IPC socket）；
- Node.js ≥ 20；
- 仓库根目录已执行 `npm install && npm run build`。

## 挂载到 goose

goose 的 MCP 扩展配置在 `~/.config/goose/config.yaml`（1.54 实测通过的完整格式）：

```yaml
extensions:
  niri:
    type: stdio
    name: niri            # 必填！缺了整条扩展被静默丢弃（实测踩坑）
    enabled: true
    cmd: /home/demon/AgentOS/scripts/env/with-niri-env.sh
    args: []
    env_keys: []
    envs: {}
    timeout: 300          # 单位是秒，不是毫秒
  desktop:
    type: stdio
    name: desktop
    enabled: true
    cmd: /home/demon/AgentOS/scripts/env/with-desktop-env.sh
    args: []
    env_keys: []
    envs: {}
    timeout: 300
```

**排查要点（实测）**：
- 扩展没生效时 goose **不报错**，只是工具不出现。验证方法：跑一次会话后
  `grep -o '"name":"[a-z_]*"' ~/.local/state/goose/logs/llm_request.*.jsonl | grep niri`；
- 启动器（`scripts/env/*.sh`）负责自动发现 `NIRI_SOCKET`（路径含 compositor PID，每次会话不同）和补齐 Wayland/dbus 环境，不要把 socket 路径硬编码进配置；
- 手测启动器：`timeout 2 scripts/env/with-niri-env.sh </dev/null`，exit 0 即正常（stdin EOF 后干净退出）。

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
