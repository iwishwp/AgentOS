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

### 通道 A：自动填充（网页登录类，推荐默认）——✅ 已实现（cred_autofill，2026-10-17 VM 实测）

实现走 **CDP 注入**而非密码管理器桌面端（1Password 桌面端 autofill 留作增强后端）：broker 取明文
→ 经 browser-mcp 的 CDP 连接在目标页面 `open(url)` → 页面内设值 + 派发 input/change 事件 →
**页面内逐字节复核**（`el.value === 注入值`，matches 布尔回传，明文不出页面）→ 回执只含
**长度 + sha256**（安全上下文页面内算；data: URL 等非安全上下文无 crypto.subtle，由 broker 用
同一明文补算——值不出 broker 栈帧，零明文纪律不变）。matches=false（被框架改写）一律拒绝。
实测：水族馆 Chromium 填 data: URL 测试页，回执 sha256 与 orchestrator 管道内独立计算逐字节一致。

1Password/Bitwarden 桌面端自带的 autofill 直接填充到目标窗口是同通道的后续载体（agent 只发起
“请在窗口 X 填充 vault://…/login”请求并等待完成信号，填充过程对 agent 不可见）。

### 通道 B：代为执行（CLI/命令类）——✅ 已实现（cred-mcp，2026-10-17）

实现：`packages/cred-mcp`（工具 `cred_list`/`cred_exec`）。安全模型四条：① 命令为数组直
spawn（无 shell 注入面），argv[0] 必须命中该凭据 `exec_allow` 白名单；② 明文只注入子进程
环境变量；③ 返回输出中所有明文出现处打码；④ 审计只记引用+命令+决策。策略文件
`~/.config/agentos/credentials.yaml`，注册工具 `scripts/cred-store.sh`。实测（2026-10-17）：
agent 经代理取到凭据 SHA256（与 orchestrator 独立计算严格一致），`bash -c echo` 偷看被
白名单拦截。

借鉴 1Password Shell Plugins 的模式：需要凭据的命令（`git push`、`op run --`、
curl 带 token 等）由 broker 代为起进程，secret 经 stdin 或 broker 注入的 env 进入
**子进程**，agent 只拿到进程的 stdout/stderr/退出码。等价于“agent 说要做什么，
broker 替它做需要钥匙的那一步”。

### 通道 C：短期凭据注入（必须 agent 进程自己调用的场景）——✅ 已实现（cred_inject，2026-10-17 实测）

broker 起 wrapper 进程并注入短期凭据 env，TTL 到点收割整个进程组（实测 sleep 60 + ttl 3 →
3.2s 被杀、exit 124、stderr 标记 AGENTOS_EXPIRED=1）；token 不出现在命令行、不进入 agent 上下文、
过期自动失效——凭据有效期即进程有效期。

少数场景 agent 起的进程必须持有凭据（如 OAuth 短期 token）。broker 换取**短 TTL、
最小权限**的 token，注入到 broker 起的 wrapper 进程 env（原设计语义，v1 以 credentials.yaml
的 `ttl_seconds` 参数按次注入实现）。

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
  allow: autofill          # A/B/C 通道白名单（单值或数组：autofill/execute/inject）
  exec_allow: [python3, sleep]   # 通道 B 的命令白名单（argv[0] 精确匹配）
vault://github/token:
  allow: [execute, inject]
  exec_allow: [git, gh]
```

- `exec_allow` 是通道 B 的硬白名单（数组直 spawn、无 shell，argv[0] 必须命中）；
  未开放通道的引用直接拒绝（不触碰 secret-tool）；
- **v1 落地取舍**：`scope`/`confirm` 两键暂未实现——工具级确认由 policy 网关统一承担
  （cred_exec/cred_autofill/cred_inject 在 policy.yaml 配 confirm 档，见 permissions.md §3），
  引用级粒度待 portal 权限库落地时补；
- 所有授予/使用事件进审计日志（M4 的审计体系共用，实测 185 行审计明文扫描零命中）；

## 5. 与其他模块的关系

- **agent 会话（M3）**：agent 会话内浏览器的登录态由通道 A/C 支撑，不落明文；
- **审计（M4）**：broker 每次放行记录“谁、哪条引用、哪个通道、何时”，录屏对通道 A 的填充画面自动打码或不录；
- **权限分级（M4）**：凭据使用属于最高级确认档，与工具级 allowlist 联动。

## 5.1 Keyring 自动解锁（M4 前置，实测教训）

2026-10-16 悬案复盘：SSH/headless 拉起的 Chromium 经 libsecret 访问 GNOME 钥匙环解密
Cookie，钥匙环未解锁 → 弹 "Unlock login Keyring" 对话框 → **网络服务阻塞等待，表现为
一切 http/https 导航挂死**（data: URL 不碰网络所以正常，极具迷惑性）。由用户在屏幕上
看到弹窗定位，`--password-store=basic` 即解（已固化进 browser-mcp）。

自动解锁的分层方案：

1. **PAM 层（✅ 2026-10-17 验证通过）**：Fedora 的 gdm-password PAM 栈含
   `pam_gnome_keyring auto_start`。实测（注销→GDM 重新登录 Niri 会话）：**单实例**
   `gnome-keyring-daemon --login`（PAM 拉起），secret-tool 写入探针**瞬时成功、零弹窗**——
   正常登录路径全程无感解锁。此前弹窗发生于多次崩溃的嵌套会话环境（无法完全复现），
   Broker 层保留统一上下文设计作为防线。
2. **Broker 层（根治）**：agent 相关进程一律经 credential broker 访问 Secret Service，
   broker 运行在已解锁的图形会话上下文里，保证连到"正确的那只" daemon——多实例分裂
   从架构上消除。
3. **隔离层（已做）**：自动化浏览器用独立 profile + `--password-store=basic`，
   永不触碰用户钥匙环——自动化环境本来就不该读用户密钥（隐私边界，不是妥协）。

## 6. 待决问题（Open Questions）

- 通道 B 的“代为执行”与 M1 权限模型中“敏感动作确认”如何合并为一个 UX；
- 1Password 桌面端 Linux 版的 autofill 覆盖范围（浏览器之外的应用）需要实测；
- Secret Service 解锁会话的生命周期与用户登录会话的绑定方式（PAM 集成 vs 手动解锁）；
- agent 会话（嵌套 niri）内的 keyring 解锁传递方式。

## 变更记录

- 2026-10-12 v0.1 初稿：broker 三通道架构、后端选型、权限策略模型。
- 2026-10-17 v0.2 M4 落地：三通道全部实现并 VM 实测（A：CDP 填充+matches 复核+broker 端补算哈希；
  B：白名单代执行哈希严格一致；C：TTL 收割 3.2s 实证）；§4 policy 模型按实现修订
  （exec_allow 硬白名单、scope/confirm 归并到 policy 网关）；全量审计零明文扫描通过。
