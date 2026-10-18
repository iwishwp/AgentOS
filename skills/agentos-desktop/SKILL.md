---
name: agentos-desktop
description: 操作 AgentOS 桌面（niri/Wayland）：窗口与工作区管理、GUI 应用无障碍操作、浏览器自动化、文件产物、桌面通知与呈现。任何挂载了 AgentOS 八个 MCP 扩展（niri/desktop/system/files/session/a11y/browser/cred）的 agent 框架可用。涉及"操作用户桌面上的应用/窗口/文件/通知"时使用。
---

# AgentOS 桌面操作手册（任何 agent 通用）

本手册自包含：只要你的框架能挂 stdio MCP server（goose / Claude Code / Z Code / Cursor 等），
按 §1 挂载后即可获得下面全部能力。所有条目均真机实测（Fedora + niri Wayland，
2026-10 端到端证据见仓库 docs/capabilities.md）。

## 0. 心智模型：四层能力，按优先级降级

1. **L0 系统层**——窗口/工作区/启动/文件/通知/剪贴板（niri/desktop/system/files 扩展）：最稳，优先用；
2. **L1 无障碍树**——GUI 应用内按名称点击/读写文本（a11y 扩展，AT-SPI2）：无需焦点、不打扰用户，
   GTK3/GTK4/Qt 实测全通（Qt 的全局开关与 Chromium 的 toolkit-accessibility 已是系统默认，
   2026-10-18 起）；Chromium 树读/文本输入可达（**页面点击走 L2**）；Java 未装（路径见
   capabilities.md 附录 B）；纯 X11 应用（xterm 类）无树，只能 L3；
3. **L2 浏览器 CDP**——网页一切操作（browser 扩展，agent 专属无头 Chromium）；
4. **L3 视觉/输入兜底**——grim 截图（可靠）、键盘注入（`scripts/kb-inject.sh`：wtype 用户级
   为主力，文本/组合键可靠；控制键（回车/Tab）回落 ydotool 需 sudo）、指针注入（**不可靠**：
   加速度下漂移，只作最后手段）。

遇到"打不开/打不好"的应用：先想是不是 L1 前置条件没满足（a11y 开关），再用 L3 截图看真实状态，
不要盲目重试。

## 1. 挂载（一次性）

goose（`~/.config/goose/config.yaml`，1.54 实测格式；**`name:` 字段必填，缺了整条扩展被静默丢弃**）：

```yaml
extensions:
  niri:
    type: stdio
    name: niri
    enabled: true
    cmd: /path/to/AgentOS/scripts/env/with-niri-env.sh
    args: []
    env_keys: []
    envs: {}
    timeout: 300          # 单位秒
  # desktop/system/files/session/a11y/browser/cred 同构，
  # cmd 分别用 with-desktop-env.sh / with-system-env.sh / ... （scripts/env/ 下八个启动器）
```

其他框架（Claude Code / Z Code 等 mcpServers JSON 风格）：

```json
{
  "mcpServers": {
    "niri":    { "command": "/path/to/AgentOS/scripts/env/with-niri-env.sh" },
    "desktop": { "command": "/path/to/AgentOS/scripts/env/with-desktop-env.sh" },
    "system":  { "command": "/path/to/AgentOS/scripts/env/with-system-env.sh" },
    "files":   { "command": "/path/to/AgentOS/scripts/env/with-files-env.sh" },
    "session": { "command": "/path/to/AgentOS/scripts/env/with-session-env.sh" },
    "a11y":    { "command": "/path/to/AgentOS/scripts/env/with-atspi-env.sh" },
    "browser": { "command": "/path/to/AgentOS/scripts/env/with-browser-env.sh" },
    "cred":    { "command": "/path/to/AgentOS/scripts/env/with-cred-env.sh" }
  }
}
```

要点：
- **用启动器脚本，不要直接指 node dist/index.js**——启动器负责发现 niri IPC socket
  （路径含 compositor PID，每次会话不同，如 `/run/user/1000/niri.wayland-1.2762.sock`）和补齐
  Wayland/dbus 环境（`XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`），
  从 SSH/服务环境拉起时工具才可用；
- 手测启动器：`timeout 2 scripts/env/with-niri-env.sh </dev/null`，exit 0 即正常；
- 前置：Node ≥ 20、仓库已 `npm install && npm run build`、运行在 niri 图形会话所属用户下。

## 2. 工具速查（按扩展分组，工具名 = `<扩展>__<工具>`）

### niri —— 窗口/工作区/启动（L0）
| 工具 | 用途 | 关键参数 |
|---|---|---|
| `list_windows` | 列所有窗口（id/app_id/标题/工作区/焦点） | — |
| `list_workspaces` | 列工作区（**idx 序号 与 id 是两个东西**，move 用序号或名称） | — |
| `list_outputs` | 列显示器 | — |
| `focus_window` | 切前台聚焦（会切用户视角，慎用） | `id` |
| `focus_workspace` | 切工作区（会切用户视角） | `reference`: "3" 或名称 |
| `move_window_to_workspace` | 移窗口（不抢焦点，整理用） | `id?`（缺省=聚焦窗）、`reference` |
| `close_window` | 关窗口 | `id?` |
| `open_app` | 在用户桌面启动程序 | `command`: 数组，如 `["ghostty"]` |

### a11y —— GUI 应用内操作（L1，AT-SPI2）
| 工具 | 用途 | 关键参数 |
|---|---|---|
| `a11y_list_apps` | 列无障碍总线上注册的应用 | — |
| `a11y_dump_tree` | 倒某应用的无障碍树（找按钮名/结构） | `app` |
| `a11y_click` | **按 accessible 名称点击**（无需焦点不打扰用户） | `app`、`buttonName` |
| `a11y_read_texts` | 读应用全部非空文本（显示屏/结果/标签） | `app` |
| `a11y_set_text` | 按节点名写文本框 | `app`、`match`（名称子串，缺省 `*` 第一个）、`text` |

实测纪律：**按名称寻址，不要按树索引**（树结构跨 AT 连接会重建）；GTK4 的树要等 AT 客户端
注册后才完整；同名多实例时桥解析到先注册者——先读文本对状态判别实例，必要时关掉多余实例。
Chromium 例外注意：树懒构建（桥自动触发，首次 dump 多等 1-2 秒属正常）；**写文本框用
"grabFocus + kb-inject type"组合**（Chromium 的 entry 不吃 setTextContents）；页面**按钮点击
不生效**（doAction 派发但 onclick 不跑），页面操作一律走 browser 扩展。

### browser —— 网页操作（L2，agent 专属无头 Chromium）
| 工具 | 用途 | 关键参数 |
|---|---|---|
| `browser_open` | 导航（首次调用自动拉起浏览器） | `url` |
| `browser_eval` | 页面内执行 JS，填表/点击/读内容全靠它 | JS 代码 |
| `browser_screenshot` | 截图（浏览器无头，视觉全靠它） | — |

填表标准动作：`el.value = "..."` 后必须 `el.dispatchEvent(new Event("input", {bubbles: true}))`，
否则现代框架收不到输入。**遇验证码：停下告知用户，绝不自动绕过。**

### files —— 文件沙箱（L0，根 = `~/Agent/`，路径都写相对）
| 工具 | 用途 | 关键参数 |
|---|---|---|
| `read_file` / `write_file` | 读写文本（自动建父目录） | `path`、`content` |
| `list_dir` / `create_dir` | 列目录/建目录 | `path` |
| `move` / `delete` | 移动 / 删（进 .trash 可恢复，**别用 shell rm**） | `source`/`dest`、`path` |
| `find_by_name` | 按名找文件 | `pattern` |
| `download` | http(s) 下载进沙箱（≤50MB / 60s，**别用 shell curl**） | `url`、`path` |

### desktop —— 呈现/通知/剪贴板/确认（L0）
| 工具 | 用途 | 关键参数 |
|---|---|---|
| `open` | 打开产物：URL 或文件；office 文档**必须带 `app: "libreoffice"`**（白名单，系统 MIME 关联不可靠） | `target`、`app?` |
| `notify` | 桌面通知（三档见 §3） | `summary`（必填）、`body`、`urgency`、`action?` |
| `confirm` | **向用户请示/要决策**（T1 四横幅：允许/会话允许/拒绝/永不，30s 无应答=拒绝） | `summary`（不放敏感内容）、`tier?`（t1/t2，影响文案） |
| `clipboard_read` / `clipboard_write` | 剪贴板读写 | — |

### session —— 水族馆（agent 专属嵌套 niri 会话，GUI 活都在这干）
| 工具 | 用途 |
|---|---|
| `agent_session_start` / `agent_session_stop` / `agent_session_status` | 嵌套会话生命周期（桌面上出现一个可围观的窗口） |
| `agent_open_app` | 在水族馆里启动应用（如 gnome-calculator、chromium） |
| `agent_list_windows` | 列水族馆内窗口 |
| `agent_screenshot` | 定向截水族馆内部（grim） |

### system —— 系统查询（L0 只读全放行）
`system_status` / `list_services` / `service_status` / `journal` / `network_info` /
`list_packages` / `package_info` / `package_install`（T2 强确认：弹 polkit 密码框，需人在；
无头跑必 300s 超时拒绝——别在无人值守时调）。

### cred —— 凭据（agent 拿引用不拿明文）
`cred_list`（可用凭据及其引用/env 变量名）· `cred_autofill`（通道 A：页面自动填充，明文即弃）·
`cred_exec`（通道 B：白名单代执行+输出打码）· `cred_inject`（通道 C：短 TTL 环境变量注入，
到点整组收割）。**任何需要密码/token 的操作只走 cred，禁止向用户索要明文。**

## 3. 行为约定（实测有效的纪律）

1. **产物统一落 `~/Agent/`**，按 `downloads/ inbox/ reports/ notes/ canvas/ screenshots/` 分类；
   落位即自动进 artifacts 索引（`http://127.0.0.1:7788/artifacts`），用户问"我上次的报告在哪"
   → 打开该页或报相对路径；
2. **呈现优先级**：仪表盘/报告/交互内容 → 写自包含单文件 HTML 到 `canvas/<名>/index.html` 再
   `open` 打开 `http://127.0.0.1:7788/<名>/`；office 文档 → `open` 带 `app: "libreoffice"`；
   网页 → browser 扩展；
3. **通知三档**：完成 → `notify` urgency=low + action（`{kind:"open_path", path:"reports/x.fodt"}`
   或 `{kind:"open_url", url:...}`，点通知直达产物）；失败/需尽快知道 → urgency=critical +
   一句话结论 + 原因建议；**要用户决策 → 不用 notify，走 `confirm`**（notify 没有选择语义）。
   异步结果一律通知，不要默默完成；
4. **确认与分寸**：不要动用户正在用的窗口，除非明确要求（先 `list_windows` 认准目标）；
   策略拒绝（isError 且提示"策略拒绝"）时如实告知，不要绕路；GUI 操作在水族馆里做，
   不抢用户焦点；
5. **凭据只走 cred-mcp 引用**（§2 cred 表后那句纪律）。

## 4. 环境坑速查（全部踩过）

| 坑 | 现象 | 处置 |
|---|---|---|
| niri IPC socket 路径每次会话变 | `niri msg` 连不上 | 用启动器（自动发现 `NIRI_SOCKET`），别硬编码 |
| Chromium 钥匙串锁死网络服务 | 浏览器拉起即卡 | 启动带 `--password-store=basic`（browser 扩展已内建；自己起 chromium 记得带） |
| soffice 单实例锁 | 已开 LibreOffice 时再 open 同类文档可能无窗/卡 | 先确认 soffice 进程状态；文档打开用 `app:"libreoffice"` 走启动器语义；上次异常退出还会弹 "Document Recovery" 窗口（2026-10-18 实测），列表确认窗口时别把它当成目标文档窗 |
| LibreOffice MIME 关联不可靠 | Fedora 把 fodt 识别成 text/xml 用编辑器打开 | `open` 必须带 `app:"libreoffice"` |
| Qt 应用不出现在 a11y 总线 | `a11y_list_apps` 看不到 | 系统已全局开（/etc/environment 的 `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`，重启持久）；仍看不到=应用启动早于环境落位或非 Qt 官方绑定，重启应用 |
| Chromium/Electron a11y 树为空 | dump 不出内容 | ① 启动带 `--force-renderer-accessibility`（browser 扩展已默认带）；② `toolkit-accessibility` 必须在**应用启动前**为 true（已全局开；后改无效，须重启应用）；③ 树懒构建，dump 一次让桥触发（见 §2 a11y 纪律） |
| 键盘注入选型 | 需要打字/快捷键 | `scripts/kb-inject.sh`：文本与组合键用 wtype（用户级）；**回车/Tab 等控制键 wtype 对 GTK 不生效**，走 ydotool（sudo）；中文可能丢首字符，输完从 a11y 树读回核对 |
| 水族馆初始有 niri 热键浮层 | 截图被"Important Hotkeys"遮挡 | 注入 Esc 关闭；agent 沙箱里连不上 ydotoold socket（root 600），借 `niri__open_app` 在真实桌面环境执行注入 |
| ydotool 指针漂移 | 绝对定位失准（libinput 加速度 ≈0.5） | 指针不可依赖；键盘注入可靠；socket 路径注意 `/tmp/.ydotool_socket` vs `$XDG_RUNTIME_DIR` 的版本差异 |
| GTK4 树初始不完整 | dump 只有十几个节点 | 先 `a11y_list_apps`/dump 一次让 AT 客户端注册，再 dump 才完整（16→105 节点实测） |
| 无头跑 T1/T2 确认 | 30s/300s 无人应答自动拒绝 | 预期行为：写操作需要用户在场，或测试时经 `org.agentos.Confirm1.Respond` 编程应答 |
| 装包被 packagekitd 抢锁 | dnf 偶发失败 | 装前 `systemctl stop packagekit`（T2 helper 已处理） |

## 5. 升级路径（当目标应用打不开时按序尝试）

L0（系统层，永远先试）→ L1（a11y：GTK3/4/Qt 已默认可达；Chromium 检查 flag 与
toolkit-accessibility 顺序；第三方 Electron 按 capabilities.md 附录 B 加 flag）→
L2（网页类必走）→ L3 兜底（grim 看 + kb-inject 键盘；指针不可靠）。
仍打不开的类型：纯 X11 应用（xterm 类，无树，L3 是终点）、Java（需 JAB，路径见
capabilities.md 附录 B）、合成器自身 UI 只能输入注入——详表见仓库 `docs/capabilities.md`。
