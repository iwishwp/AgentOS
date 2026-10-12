# 凭据代理与密码管理集成设计

> 状态：v0.1 草案（2026-10）。对应里程碑 **M4**。
> 核心原则一句话：**用户在密码管理器里录一次，agent 之后可以“用”凭据，但永远“读”不到明文。**

## 1. 目标与威胁模型

用户需求：集成 1Password 之类的密码管理软件，agent 不接触密码本身，但能代用户完成需要凭据的操作（登录网站、git push、API 调用……）。

要防的泄漏路径：

| 路径 | 场景 | 对策 |
|---|---|---|
| agent 上下文泄漏 | 密码作为工具返回值进入对话历史，被日志/云端模型看到 | 明文永不作为工具返回值，broker 只返回“结果”不返回“秘密” |
| prompt injection | 恶意网页诱导 agent “读取并复述密码” | agent 无读取明文的工具，物理上不可为 |
| 录屏/截屏泄漏 | 视觉 computer use 看到密码输入框 | broker 通道下不走键盘注入；必要时代填后对 agent 输出打码 |
| 进程环境泄漏 | secret 写进 env/命令行被 `ps`、日志捕获 | 走 broker 持有的解锁会话，不落 agent 进程环境 |

## 2. 架构：credential broker

在 agent 与密码管理器之间加一层常驻代理（systemd user service）：

```
agent（goose + MCP）
   │  请求：“用 vault://bank/login 完成某事”（只传引用，不见明文）
   ▼
credential-broker（守护进程，持有解锁会话/集成了 1Password 桌面端）
   │                      │                        │
   ▼ 通道A: 自动填充       ▼ 通道B: 代为执行         ▼ 通道C: 短期凭据注入
密码管理器直接填充到        broker 起子进程，secret    broker 起 wrapper 进程，
目标窗口（agent 只知       只存在于子进程内，        短期 token 只注入该进程
道“已填充”，看不到内容）    agent 只拿到进程输出      env，对 agent 进程不可见
   ▼
Secret Service / gnome-keyring / Bitwarden / KeePassXC / 1Password
```

### 通道 A：自动填充（网页登录类，推荐默认）

1Password/Bitwarden 桌面端自带的 autofill 直接填充到目标窗口；agent 只发起
“请在窗口 X 填充 vault://…/login”请求并等待完成信号。填充过程对 agent 不可见。

### 通道 B：代为执行（CLI/命令类）

借鉴 1Password Shell Plugins 的模式：需要凭据的命令（`git push`、`op run --`、
curl 带 token 等）由 broker 代为起进程，secret 经 stdin 或 broker 注入的 env 进入
**子进程**，agent 只拿到进程的 stdout/stderr/退出码。等价于“agent 说要做什么，
broker 替它做需要钥匙的那一步”。

### 通道 C：短期凭据注入（必须 agent 进程自己调用的场景）

少数场景 agent 起的进程必须持有凭据（如 OAuth 短期 token）。broker 换取**短 TTL、
最小权限**的 token，注入到 broker 起的 wrapper 进程 env；token 不出现在命令行、
不进入 agent 上下文、过期自动失效。

## 3. 后端选择：Secret Service 为底座，1Password 为增强

| 后端 | 定位 | 说明 |
|---|---|---|
| **Secret Service（libsecret/gnome-keyring）** | 通用底座、最大公约数 | freedesktop 标准接口；Bitwarden 桌面端、KeePassXC 均可实现该服务；Linux 原生、零额外依赖 |
| **1Password** | 增强后端 | 桌面端 autofill 最成熟；CLI（`op`）+ Shell Plugins 已验证“引用而非明文”模式，是通道 B/C 的设计参照 |
| Bitwarden / KeePassXC / pass | 兼容目标 | 经 Secret Service 或各自 CLI 接入 broker 抽象层 |

broker 内部以 `secret://<backend>/<item>` 引用寻址，后端差异被抽象掉；
agent 工具面只认引用。

## 4. 权限策略

每条凭据一条策略（首次使用时经桌面通知向用户确认，落 portal 权限库）：

```yaml
# ~/.config/agentos/credentials.yaml（示意）
vault://bank/login:
  allow: autofill          # A/B/C 通道白名单
  scope: [browser]         # 哪些工具/应用可用
  confirm: session         # always | session | once
vault://github/token:
  allow: [execute, inject]
  scope: [git, gh]
  confirm: once            # 授权一次后本策略长期有效
```

- `confirm: always` 每次弹窗；`session` 每次登录会话问一次；`once` 授权即记住；
- 所有授予/使用事件进审计日志（M4 的审计体系共用）；
- 撤销入口：设置面板一键吊销任意引用的授权。

## 5. 与其他模块的关系

- **agent 会话（M3）**：agent 会话内浏览器的登录态由通道 A/C 支撑，不落明文；
- **审计（M4）**：broker 每次放行记录“谁、哪条引用、哪个通道、何时”，录屏对通道 A 的填充画面自动打码或不录；
- **权限分级（M4）**：凭据使用属于最高级确认档，与工具级 allowlist 联动。

## 6. 待决问题（Open Questions）

- 通道 B 的“代为执行”与 M1 权限模型中“敏感动作确认”如何合并为一个 UX；
- 1Password 桌面端 Linux 版的 autofill 覆盖范围（浏览器之外的应用）需要实测；
- Secret Service 解锁会话的生命周期与用户登录会话的绑定方式（PAM 集成 vs 手动解锁）；
- agent 会话（嵌套 niri）内的 keyring 解锁传递方式。

## 变更记录

- 2026-10-12 v0.1 初稿：broker 三通道架构、后端选型、权限策略模型。
