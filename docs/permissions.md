# 权限分级 v1（M4）

> 状态：设计文档（2026-10-17）。定义三档权限如何映射到现有 `@agentos/policy`（allow/deny）
> 与未来的 portal 确认流；给出全部现有扩展的逐档建议与 polkit/portal 集成方案。
> 本文只定方案与示例配置，不含实现代码。

## 1. 三档定义

| 档 | 名称 | 语义 | 用户感知 |
|---|---|---|---|
| **T0** | 免批准 | 直接执行，仅审计 | 无（后台完成） |
| **T1** | 确认后执行 | 弹一次确认（通知按钮/对话框），批准即执行 | 一条可点"允许/拒绝"的确认请求 |
| **T2** | 强确认 | 需输入密码/指纹（polkit 级认证）+ 变更前自动打快照 | 系统级认证弹窗 |

判档三问（按序）：

1. **可逆吗？** 不可逆或影响系统全局的 → 至少 T1；系统级（dnf/`/etc`/内核）→ T2；
2. **动的是谁的领地？** agent 自己的水族馆/工作区内 → 放宽一档；用户桌面/剪贴板/主会话 → 收紧一档；
3. **有没有兜底？** 已有回收站（files）、白名单（cred broker）、只读（system-mcp）等机制兜底的 → 放宽一档。

## 2. 映射到 @agentos/policy（现状与演进）

`packages/policy/src/policy.ts` 现状：decision 只有 `allow` / `deny`，查找顺序
`rules[extension][tool] → rules[extension]["*"] → defaults.decision`，每次调用写 JSONL 审计。

| 档 | 现在（policy v0） | portal 就绪后（policy v1） |
|---|---|---|
| T0 | `allow`（现状即此） | `allow` |
| T1 | `allow` + 审计 `detail` 标注 `tier:t1-pending`（全量走审计，事后可查） | 新增 decision `confirm`：server 发确认请求，批准后执行并把结果记入审计 |
| T2 | `deny`（带 reason 指引人工路径），系统级工具本身不存在 | `confirm` + `auth: admin`：走 polkit 强认证（§4.2），批准链里自动插 snapshot create |

要点：

- **v0 的 T1 只能"信任 + 审计"，不能"拦截"**——这是诚实的中间态：M1–M3 的用户可见动作
  （开窗/移动窗口/通知）本就是用户对话里点名要求的，等价于"口头批准"；
- `defaults.decision` 引入敏感动作后应改 `deny`（policy.ts 注释里已预告）；
- confirm 的"记住"粒度：`allow-once`（默认）/ `allow-session`（本次会话不再问）/
  `deny-once` / `always-deny`（写入 policy.yaml）——与"每次/仅此一次/永不"对应；
- 审计条目扩字段：`tier`、`confirm: {asked, result, by}`、`snapshot: <编号>`（若触发）。

## 3. policy.yaml 分级示例（现有扩展逐档建议）

现有 **12 个扩展** = 8 个自研 MCP server（niri/desktop/system/files/session/atspi/browser/cred，
共 43 工具）+ goose 内建扩展（developer/docs 等约 4 个）。逐档建议：

| 扩展.工具 | 档 | 依据 |
|---|---|---|
| niri.list_windows / list_workspaces / list_outputs | T0 | 只读 |
| niri.focus_window / focus_workspace / move_window_to_workspace | T1 | 改**用户主会话**的窗口布局 |
| niri.close_window / open_app | T1 | 影响用户会话（关窗口不可逆其状态） |
| desktop.notify | T0 | 通知是确认通道本身 |
| desktop.open | T1 | 在用户桌面拉起可见窗口（app 参数可白名单后降 T0） |
| desktop.clipboard_read | T1 | 读用户剪贴板（可能含密码） |
| desktop.clipboard_write | T1 | 覆写用户剪贴板 |
| system.*（7 个只读工具） | T0 | system-mcp 设计即只读；包/服务/日志查询无副作用 |
| files.list_dir / read_file / create_dir / write_file / move / find_by_name | T0 | 沙箱工作区内（~/Agent），越界防护在 workspace 层 |
| files.delete | T0 | 回收站语义（.trash/ 可恢复） |
| files.download | T1 | 发起网络请求（写工作区，但出网行为值得留痕确认；URL 白名单后可降 T0） |
| session.agent_session_start / stop / status / list_windows / screenshot | T0 | 水族馆是 agent 自己的领地；screenshot 只截水族馆内部 |
| session.agent_open_app | T0 | 应用开在水族馆内，不碰用户焦点 |
| atspi.a11y_list_apps / dump_tree / read_texts | T0 | 读无障碍树（水族馆会话范围内） |
| atspi.a11y_click / a11y_set_text | T0 | 点击/输入发生在水族馆内的应用（会话隔离即边界） |
| browser.browser_open / browser_eval / browser_screenshot | T0 | agent 会话内浏览器（Chromium 无头，沙箱） |
| cred.cred_list | T0 | 只列引用与标签，无明文 |
| cred.cred_exec | T1 | 凭据白名单代执行（注册时已逐条 exec_allow 批准过 = 预批准），输出打码；新增凭据/扩白名单 = T2 |
| （goose 内建）developer / docs / tutorial | T0 | 仓库内文件操作与文档 |
| （goose 内建）computer controller / 外接扩展 | **T2 或禁用** | 直接控制真实桌面/键鼠，与水族馆隔离原则冲突，默认不启用 |
| （未来）system 包管理 / `/etc` 写 / snapper rollback | T2 | 系统级、需快照 + 强认证 |

`~/.config/agentos/policy.yaml` 示例（**v0 引擎现在就能加载**——`confirm`/`deny+tier`
在 policy.ts 里未识别时落为 allow，注释即演进说明；`# t2` 行当下实际生效为拒绝需人工）：

```yaml
version: 1
defaults:
  decision: deny        # 引入敏感动作后白名单化（policy v1 起生效）
rules:
  # ---- T0 免批准：只读 + agent 自己的领地 ----
  niri:      { list_windows: allow, list_workspaces: allow, list_outputs: allow }
  system:    { "*": allow }                    # 只读面整体放行
  session:   { "*": allow }                    # 水族馆生命周期全放行
  atspi:     { "*": allow }                    # 水族馆内无障碍操作
  browser:   { "*": allow }                    # agent 会话内浏览器
  files:
    "*": allow                              # 工作区沙箱（delete 有回收站）
    download: allow                         # v1 起改 confirm   # t1
  cred:      { cred_list: allow }

  # ---- T1 确认后执行：动用户桌面/剪贴板 ----
  desktop:   { "*": confirm }                # v0 引擎读作 allow+审计
  niri:
    focus_window: confirm
    focus_workspace: confirm
    move_window_to_workspace: confirm
    close_window: confirm
    open_app: confirm
  cred:      { cred_exec: confirm }

  # ---- T2 强确认：系统级（工具面出现时启用） ----
  # system:  { package_install: deny        # t2: 走 §4.2 的 pkexec 通道
  #            service_write: deny }        # t2
```

> 注意：YAML 里同一键出现两次（上面 `niri`、`cred` 为排版分档写了两次）在真实文件中须合并；
> policy.ts 的 `rules` 是扁平 `{extension: {tool: decision}}`，不支持层级档位字段。

## 4. portal / polkit 集成方案

### 4.1 T1 的确认流（portal 式）

v1 不强求进 xdg-desktop-portal 官方树，先做一个**用户级 D-Bus 确认服务**（portal 的同构前身）：

```text
D-Bus: org.agentos.Confirm1 /org/agentos/confirm
  Request(s: agent, s: tool, s: summary_redacted, s: tier) → (u: req_id)
  Respond(u: req_id, s: choice)      # allow_once | allow_session | deny_once | always_deny
  信号: Confirmed(u: req_id, s: choice, s: by)
```

- 通知载体：mako 动作通知（"允许 / 本次会话允许 / 拒绝 / 永不"），30 秒超时 = `deny_once`；
- MCP server 侧：policy.decide 返回 `confirm` → 调 `Request` → 阻塞等待信号 →
  批准则执行，`allow_session` 记入内存表，`always_deny` 写回 policy.yaml；
- 全程审计（含用户按了什么、几秒响应）；
- 迁移路径：接口对齐 xdg-desktop-portal 的 Request/Response 模式，未来可平移为
  自定义 portal backend，与 ScreenCast/FileChooser 同列。

### 4.2 T2 的强确认（polkit：dnf 装包确认的实现路径）

dnf 不走 polkit，agent 也不该直接 sudo。推荐路径 **pkexec + 专用 helper**：

1. agent 调 `system.package_install`（新工具，policy 里 `deny` 常规通道）；
2. server 先 `snapshot.sh create dnf-<包名>`（§快照策略，T2 的硬性前置）；
3. server 执行 `pkexec /usr/libexec/agentos/pkg-install <包...>`：
   - helper 是只做参数校验 + `dnf install -y "$@"` 的最小脚本（无 shell、无通配）；
   - polkit action 定为 `auth_admin`（输密码/指纹），弹的是系统级认证窗而非应用确认；
4. 结果（含退出码与快照编号）写审计；失败时在回复里给出 `snapshot rollback <N>` 指引。

polkit 配置（`/usr/share/polkit-1/actions/org.agentos.pkg-install.policy` + rules）：

```xml
<!-- action 定义：默认 auth_admin，仅限本用户会话 -->
<action id="org.agentos.pkg-install">
  <description>AgentOS: 安装软件包（agent 发起，用户强确认）</description>
  <defaults><allow_any>no</allow_any><allow_inactive>no</allow_inactive><allow_active>auth_admin</allow_active></defaults>
</action>
```

```javascript
// /etc/polkit-1/rules.d/49-agentos.rules —— helper 只能是白名单路径，其余 pkexec 一律拒绝
polkit.addRule(function (action, subject) {
  if (action.id == "org.freedesktop.policykit.exec") {
    var program = action.lookup("program");
    if (program == "/usr/libexec/agentos/pkg-install" && subject.local && subject.active)
      return polkit.Result.AUTH_ADMIN;      // 密码确认，不记住（每次都问）
  }
});
```

备选路径（同一 T2 语义的两种载体）：

- **PackageKit D-Bus**：`org.freedesktop.packagekit.package-install` 自带 polkit 确认
  （gnome-software 同款体验），不写 helper；缺点是确认粒度/超时不可定制，且与快照钩子串联要绕；
- **sudo 白名单（NOPASSWD 单命令）**：实现最省，但没有认证弹窗、"永不确认"的风险面大，
  仅作过渡，不推荐。

### 4.3 与快照/录屏的闭环

T2 批准链 = `snapshot create → pkexec 确认 → 执行 → 审计(含快照号)`；
回放链 = 审计时间轴 + 当时的水族馆录像（docs/session-recording.md §1）。
一次误操作从"发现 → 看回放定位 → 快照回滚"全程有据可查——这就是 M4 退出标准
"演示一次误操作的回滚与回放"的拼图。

## 5. 落地顺序建议

1. policy v1：decision 增加 `confirm` + 审计扩字段（改动集中在 policy.ts，全部 server 免改——
   拒绝/放行逻辑不变，confirm 由 server.ts 的统一包装层处理）；
2. org.agentos.Confirm1 D-Bus 服务 + mako 动作通知（T1 可用）；
3. T0/T1 全量工具按 §3 表迁移 defaults；
4. pkg-install helper + polkit action/rules + snapshot 串联（T2 可用，M4 演示项）；
5. xdg-desktop-portal backend 化（对外标准化，M5 前不急）。
