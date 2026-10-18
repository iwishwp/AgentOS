# goose 悬浮球（agentos-orb）

桌面右缘垂直居中常驻一个小球，是 **agent 工作进展对用户的常显通道**——不弹窗、
不抢焦点，余光可感知。`qs -c agentos-orb`（quickshell 独立配置，niri spawn-at-startup
自启），安装 `scripts/install-orb.sh`。

## 状态机（attention > working > idle）

| 状态 | 触发 | 视觉 |
|---|---|---|
| idle | 静默超过阈值 | 低饱和小圆点静置球心 |
| working | 审计日志最近一行在静默阈值内 | 呼吸动画；标签显示"正在用 <扩展>.<工具>" |
| attention | Confirm1 有未决请求 | primary 描边加粗 + 轻微弹跳 + 常显"N 项待确认" |

- **working 数据源**：watch `~/.local/state/agentos/audit.jsonl`（agent 每次工具调用
  都会追加一行），最近 5 条进内存做活动列表；1s 定时器重评，静默
  `quiet_after_secs`（默认 30s）回 idle；
- **attention 数据源**：轮询 `org.agentos.Confirm1.ListPending`（2s）——为本球在
  Confirm1 增加的只读方法（私有接口，返回未决请求的 id/agent/tool/summary/tier）。

## 交互

点击球体展开面板：最近 5 条 agent 活动（工具/决策/时间）+ 待确认摘要 +
两个直达按钮（`/replay` 回放时间轴、`/artifacts` 产物索引，chromium --app 打开）。

## 配置 `~/.config/agentos/orb.json`

```json
{ "enabled": true, "quiet_after_secs": 30, "edge_gap_px": 12 }
```

## 设计说明

- 配色与全系统同源：读 Noctalia `colors.json`（莫兰迪），缺省内置同值兜底；
  换壁纸重生成配色自动跟随；
- 形态语言对齐设计债清单（DEVLOG"设计债"节）：胶囊化/描边统一待与键位浮层、
  mako 通知一起做视觉语言规范时收口；
- 已知限制（v1）：不可拖动换位；"消息推送"通道未做（球只反映审计与确认，
  agent 主动给球发消息待 v2，可经 notify 的 action 或专用状态文件）。

## 验证记录（2026-10-18，agentos-vm）

- 常驻显示（右缘垂直居中，idle/working 截图经视觉模型复核：深色半透明球底 +
  亮米白圆点对比醒目）；
- working：向审计追加一行 → 球进入呼吸态并显示工具名；
- attention：真实 confirm 请求（timeout_ms=60000）→ 球描边加粗弹跳、面板出现
  待确认摘要，超时决出后回落；
- 面板两按钮经 niri 窗口列表验证页面真实打开；ListPending 空表/有待决两态核验。
