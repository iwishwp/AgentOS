# 多机器状态迁移（导出 / 导入）

> 脚本：`scripts/agentos-state-export.sh` / `scripts/agentos-state-import.sh` ·
> UI 入口：canvas `/settings` 页「迁移」分区（导出按钮 + 导入说明）
> 状态：v1（2026-10-19），配对语义 only-if-absent。

## 1. 目标与范围

AgentOS 的用户态状态散在 `~/.config` 下的四处，换机器/重装时需要一键带走：

| 文件 | 作用 | 缺失时 |
|---|---|---|
| `~/.config/agentos/settings-state.json` | 主题状态快照（settings-daemon 写） | 重新 apply 一次即可，无伤 |
| `~/.config/agentos/policy.yaml` | 工具权限策略（allow/confirm/deny 档） | 丢失则全部回默认档，重批一次 |
| `~/.config/agentos/credentials.yaml` | 凭据策略（引用 → 通道/exec_allow 白名单） | 丢失则所有凭据不可用，需重注册 |
| `~/.config/agentos/goose.env` | 模型 API key（**明文**，600） | 见 §3 约定 |
| `~/.config/niri/config.kdl` | 窗口管理器全配置 | 换机器基本必带 |
| `~/.config/noctalia/lanrhyme-palette{,-light}.json` | 莫兰迪色板暗/浅两份 | 可用 `apply-lanrhyme-theme.sh` 重生成 |
| `~/.config/goose/config.yaml` | goose 扩展（MCP 列表等） | 丢失则 MCP 全没，重建麻烦 |

导出把这些收进一个 `tar.gz`（内含 `MANIFEST.txt`：时间/主机/密钥模式/included/missing），
产物默认落 `~/Agent/agentos-state-<主机名>-<时间戳>.tar.gz`，权限 600。

## 2. 用法

```bash
# 本机导出（默认 goose.env 只导键名模板）
~/AgentOS/scripts/agentos-state-export.sh
# 明文密钥一并带走（警告：只经加密通道传输）
~/AgentOS/scripts/agentos-state-export.sh --with-secrets

# 目标机导入：默认 dry-run，只出差异报告
~/AgentOS/scripts/agentos-state-import.sh ~/Agent/agentos-state-*.tar.gz
# 确认后落盘
~/AgentOS/scripts/agentos-state-import.sh ~/Agent/agentos-state-*.tar.gz --apply
```

canvas `/settings` → 「迁移」分区的导出按钮走同一条路（后端起 `agentos-state-export.sh`
子进程，解析末行 `EXPORTED_PATH=`）；导入是刻意留在 CLI 的动作——它碰 `$HOME` 下的
存量文件，应当由人看着差异报告来做，不给浏览器一个按钮的误触面。

## 3. goose.env 明文密钥的处理约定

**默认排除明文。** 导出包里的 `goose.env` 是键名模板（值替换为
`<REDACTED: 明文未导出，请在新机器手动填入>`），导入后需要手动填回真值。理由：

- 状态包的传输通道不受我们控制（scp/网盘/U盘），明文 API key 不应该默认上这条路；
- `credentials.yaml` 只含引用与白名单，没有值，可以放心打包；
- keyring（Secret Service）里的凭据**永不入包**——它们本来就用 `vault://` 引用寻址，
  目标机用 `scripts/cred-store.sh` 重新注册即可，明文从头到尾不出本机 keyring
  （这正是 [security/credentials.md](security/credentials.md) "引用而非明文"设计的目的）。

`--with-secrets` 显式携带明文时：包内文件权限 600、包文件本身 600、终端打警告、
`MANIFEST.txt` 记 `密钥模式 : cleartext`，导入端再警告一次。用完即删。

## 4. 导入语义：only-if-absent + 差异报告

导入**绝不覆盖目标机已有文件**。对包里每个文件（`MANIFEST.txt` 除外）：

| 目标机状态 | 动作 |
|---|---|
| 不存在 | 安装（`cp -p` 保留包内权限；goose.env 600） |
| 存在且内容相同 | 跳过，报告"已存在且相同" |
| 存在且内容不同 | **保留本机版本**，报告 diff 摘要（头 14 行）；要覆盖请手动对比后自己来 |

默认 dry-run（只打印报告不写盘），`--apply` 才落盘。这样"清空配置→导入→状态恢复"
与"两台机器各有配置想合并"是同一套安全语义。

导入色板/状态快照后建议 `systemctl --user restart agentos-settings` 让 daemon 重读。

## 5. 验收路径（VM 实测）

1. `agentos-state-export.sh` → 检查包内 `goose.env` 为 REDACTED 模板、`grep -c` 明文
   key 零命中；
2. 清空 `~/.config/agentos/`（留备份）→ `--apply` 导入 → `settings-state.json`/
   `policy.yaml`/`credentials.yaml` 逐字节恢复；
3. 预置一个不同的 `config.kdl` 再导入 → 本机版本保留 + 报告出 diff；
4. `/settings` 页迁移分区导出按钮 → 产物出现在 `~/Agent`，页面显示路径。
