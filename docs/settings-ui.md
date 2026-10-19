# settings-ui —— AgentOS 自己的系统设置页（canvas /settings）

> 载体：`packages/canvas`（内置页，与 /keys /replay /artifacts 并列）·
> 启动器：`os/configs/desktop/agentos-app-settings.desktop`（chromium --app 独立窗口）·
> 后端：canvas server 内的 `/api/settings/*`、`/api/credentials*`
> 状态：v1（2026-10-19，VM 全链路实测）。Noctalia 面板管 Noctalia 自己的，这一页管 AgentOS 的。

## 1. 为什么是 canvas 内置页而不是独立应用

设置页的消费数据（daemon 状态快照、审计、快照列表、凭据策略）与 canvas 已有的三个面
同源同语言（读文件 + 起子进程）；复用莫兰迪 CSS 变量页骨架（`keys-page.ts` 模式）与
127.0.0.1 绑定纪律，零新增进程。桌面条目用 `chromium --app` 开成独立窗口，
观感上就是一个"设置应用"。

## 2. 四分区

| 分区 | 内容 | 数据源 |
|---|---|---|
| **外观** | 暗/亮切换、当前变体/色板路径/上次应用/真相 darkMode、daemon 存活（socket Get）、五桥上次结果表 | `~/.config/agentos/settings-state.json`（daemon 写）+ settings-daemon CLI |
| **凭据** | 引用清单（标签/通道/exec_allow/env/keyring 存在性/最近使用）、一键吊销（二次确认）、注册引导（cred-store.sh 用法 + 复制） | `credentials.yaml` + `secret-tool search --all` + 审计反查 |
| **系统** | 守护进程四单元 systemd 状态（canvas/settings/orb/confirm）、审计入口（→ /replay）、snapper 快照表（agentos-pre-*） | `systemctl --user is-active` + `scripts/snapshot.sh list --json` |
| **迁移** | 导出按钮（产物落 ~/Agent）、--with-secrets 勾选（二次确认）、导入命令说明（复制） | `scripts/agentos-state-export.sh` 子进程 |

### 外观切换的正确姿势（2026-10-19 实测教训）

只调 `agentos-settings apply --dark` 会被 daemon 的 watcher 按真相立即回滚——
真相是 `~/.config/noctalia/settings.json` 的 `colorSchemes.darkMode`。页面按钮的语义：

1. `flipDarkMode()`：只改 settings.json 的 `colorSchemes.darkMode` 一个键（其余原样）；
2. 起 settings-daemon CLI `apply`（auto）让五桥立刻收敛，不等 watcher 防抖。

canvas 全程不做编排，只"改真相 + 请 daemon 收敛"；真相文件不可写时降级为强制变体
（行为同 D-Bus `Apply(s)`，可能与 watcher 短暂打架，响应里 `truthFlipped:false` 如实标记）。

## 3. API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/settings/appearance` | GET | `{state, stateFile, daemon}`（state 为 null = 尚未 apply） |
| `/api/settings/appearance` | POST | `{variant: dark\|light}` → 翻真相 + CLI apply，回新状态 |
| `/api/settings/system` | GET | `{units, snapshots, snapshotsError?}` |
| `/api/credentials` | GET | `{credentials[], policyPath, registerGuide}` |
| `/api/credentials/revoke` | POST | `{ref}` → 吊销事务，回三步结果 |
| `/api/settings/migrate/export` | POST | `{withSecrets?}` → 跑 export 脚本，回产物路径 |

POST 只此三条例外，其余非 GET/HEAD 照旧 405；body 上限 64KB。

## 4. 凭据分区安全边界（零明文）

与 [security/credentials.md](security/credentials.md) 的 broker 同一纪律，UI 侧的对应物：

- **只探存在性，永不取值**：keyring 探测用 `secret-tool search --all agentos-ref <ref>`
  （列属性，不解锁不吐 secret）——`lookup` 连"只做存在性检查"都不允许；
- **API 响应零值字段**：只有 引用/标签/通道/白名单/env 名/存在性/最近使用时间；
- **最近使用来自审计反查**：`extension=cred` 且 `detail` 含该 ref 的最新一条的 ts
  （审计写入侧本来就永不记值）；
- **吊销 = 三步事务**（顺序即语义）：
  1. `secret-tool clear agentos-ref <ref>` 删 keyring 条目（按属性精确匹配，幂等）；
  2. 从 `credentials.yaml` 摘除该引用的策略块——缩进块手术保留其余条目与注释，
     写前 YAML 校验（引用集恰好少一个），临时文件 + rename 原子落盘；
  3. 审计记 `credential_revoke`（detail 只含 ref 与三步结果）。
  keyring 步失败仍继续②③（策略摘除后 broker 即拒用，功能上已吊销），结果如实上报；
  步骤②校验失败则中止不落半截文件。
- UI 侧二次确认弹层写明三步与"不可撤销"。

## 5. 与 settings-daemon 的边界

canvas 不 import settings-daemon，也不复刻桥逻辑：

- **读**：直接读状态快照 JSON（daemon 的单一状态源）；存活探测走 unix socket 发一行
  `{"method":"Get"}`（与 daemon `socketCall` 同协议，500ms 超时）；
- **写**：起 `packages/settings-daemon/dist/cli.js` 子进程（`node cli.js apply`）；
  路径解析带 env 覆盖（`AGENTOS_SETTINGS_CLI/STATE_FILE/SOCKET`）与
  `~/AgentOS` / 仓库根两组候选。

## 6. 桌面入口

`os/configs/desktop/agentos-app-settings.desktop` → 部署到 `~/.local/share/applications/`。
要点（两枚都是实测坑）：

- `--ozone-platform=wayland`：本机 chromium 默认 X11 后端，ssh/启动器环境起不来
  （browser-mcp 同款教训，2026-10-19 复验）；
- `--password-store=basic`：keyring 锁死网络栈的 M3 教训。

与"系统设置"条目（Noctalia 面板）并列共存：Noctalia 管自己的外观细节，
AgentOS 设置管 daemon/凭据/审计/迁移。

## 7. 测试与验证

- 单测：`packages/canvas/test/settings.test.ts`（13）+ `credentials.test.ts`（15），
  含吊销事务（临时目录 fixture）、策略块手术、路由与 405 白名单；
- VM 全链路（2026-10-19）：页面四分区截图复核；暗/亮切换像素抽查（状态栏
  #efefde→#302f23→还原）；凭据注册→列表（keyring=true）→吊销（keyring 无条目 +
  yaml 无策略 + 审计 credential_revoke，全程明文 grep 零命中）；导出→清空→导入
  三件逐字节恢复、真 goose.env 走 only-if-absent 保留。

## 8. 已知边界与后续

- 快照列表依赖 `sudo snapper list`——需 sudoers 只读 NOPASSWD 条目
  （VM 上已配 `/etc/sudoers.d/agentos-snapper-readonly`，仅两条 list 命令），
  否则页面如实显示错误（不隐藏）；
- 凭据后端目前只有 Secret Service（secret-tool）；1Password/Bitwarden 桌面端接入
  后本页无需改动（探测走同一 search 抽象即可）；
- 首次启动引导（无 credentials.yaml/无策略时的分步向导）未做，现以注册引导文案替代；
- 页面在暗色下的实拍尚未留档（VM 验证时为浅色档）；切换即跟随 colors.json，机制同三页。
