# settings-daemon —— 主题/设置编排守护进程

> 包：`packages/settings-daemon`（TypeScript，与 packages/MCP 同语言栈）·
> bin：`agentos-settings` · systemd 用户单元：`os/systemd/agentos-settings.service`
> 决策记录：[ADR-0002](../decisions/0002-settings-daemon-ts.md)（为什么 TS、长期方向 Rust 全量切换）

## 1. 为什么收编

缝合桌面阶段，主题联动是一条**钩子链**：Noctalia 三个钩子
（darkModeChange/wallpaperChange/colorGeneration）→ `theme-apply-all.sh` → 五个 shell 桥
（`scripts/theme-{noctalia,mako,fuzzel,ghostty,gtk}.sh`，内嵌 python heredoc，色板读取逻辑重复四份）。
问题：只在钩子触发时收敛（错过事件=漂移）、无状态可查、无外部 API、每桥起一个 python 进程。

settings-daemon 把这条链收编为一个**常驻进程**：事件驱动（watcher）、单一状态快照、
D-Bus API、单进程内共享一个 palette 模块。Noctalia 三个钩子已清空（`enabled` 保留），
编排职责完全移交 watcher。

## 2. 架构

```
              ┌─────────────────────────── agentos-settings daemon ───────────────────────────┐
              │                                                                              │
 ~/.config/noctalia/            ~/.config/agentos/                     org.agentos.Settings
 ┌───────────────────────┐      ┌──────────────────────┐         /org/agentos/settings
 │ colors.json ──────────┼──►   │                      │  D-Bus  │ 属性 darkMode(b)          │
 │  （Noctalia 覆写=事件源）│ w    │   WatchHub           │ ◄─────► │      paletteVariant(s)    │
 │ settings.json ────────┼── a  │  防抖+sha256 去重     │         │ 方法 Apply(s)→b Reload()→b│
 │  （只认 darkMode 变化） │  t   │  +自写回声环保护      │         │ 信号 Changed(s)           │
 │ lanrhyme-palette.json ┼── c  │        │             │         └───────────────────────────┘
 │ lanrhyme-palette-     │  h  │        ▼             │  降级    ┌ $XDG_RUNTIME_DIR/
 │       light.json ─────┼──┘  │   applyTheme 编排器    │ ◄─────► │   agentos-settings.sock    │
 └───────────────────────┘     │  （theme-apply-all    │         │ （unix socket JSON API）   │
        ▲  真相（v1 不另立）     │   语义照搬）           │         └───────────────────────────┘
        │                      │   ┌── palette（共享模块：读板/blend/变体检测/双键映射/8位色）
        │                      │   ▼
 ~/.config/agentos/            │  bridges/ noctalia → mako → fuzzel → ghostty → gtk
 settings-state.json ◄─────────┘            │            │        │         │
 （状态快照，不 watch）                makoctl reload  （新窗口）  wtype 注入  settings.ini 单行翻转
                                                                      ctrl+shift+,  + gsettings 尽力同向
```

- **state 模块**：`~/.config/agentos/settings-state.json` 是 daemon 的单一状态源
  （darkMode/paletteVariant/palettePath/lastAppliedAt/bridges），**但 v1 真相仍来自现有文件**——
  noctalia settings.json 的 `colorSchemes.darkMode` + 两个色板文件。daemon 读取映射，
  不另立竞争真相（手改 state 文件不会反过来改主题）。
- **watchers**（hub.ts）三路事件源：
  (a) `colors.json`——Noctalia 暗/亮切换会**覆写**它（浅色默认顶掉我们的色板），
  这本身就是最强的事件信号；(b) `settings.json`——只在 `colorSchemes.darkMode` 真值变化时触发；
  (c) 两个色板文件——换壁纸重生成后自动跟随。
- **bridges**：每桥一个模块、暴露 `apply(ctx)`，全部从共享 palette 模块取色
  （apply-all 时代的 `AGENTOS_COLORS_JSON` 语义），逻辑与旧 shell 桥**字节级对拍**（见测试）。
- **D-Bus**：纯 JS 的 dbus-next（无原生依赖；成员经 `configureMembers` 非装饰器注册，
  免 babel/tsc 实验装饰器）。session bus 起不来时如实降级为 unix socket JSON API
  （`agentos-settings ipc Get` 可验证），transport 记录在 daemon 日志与 `status` 输出。

## 3. 环保护（本任务最大的坑）

daemon 的 noctalia 桥**自己写 colors.json**，而 colors.json 同时是**事件源**——
不加保护就是自我触发死循环（写→watch→apply→写→…）。三道闸：

1. **幂等写**（fsutil.writeIfChanged）：期望内容与磁盘一致时根本不写
   （不触发 inotify、不动 mtime）。CLI 与 daemon 并发 apply 也靠它收敛。
2. **防抖 + 内容哈希**：同一目标的连续事件合并（250ms）后读文件算 sha256——
   与"已见哈希"相同（内容没变）不上行；与"自写哈希"相同（`recordSelfWrite` 在桥写入后登记）
   即自写回声，不上行。
3. **监听目录而非文件**：`fs.watch(dirname)` + basename 过滤，文件被 rename 原子替换
   （Noctalia 常见写法）事件不丢；目录缺失时轮询重挂。

误吞分析：只有"内容完全等于我们写的/已见过的"才被吞——外部覆写内容必然不同，
照常上行。单测覆盖四态：外部变更上行 / 同内容去重 / 自写回声吞 / 吞后真覆写仍上行。

## 4. 使用

```bash
agentos-settings daemon                # 前台跑（systemd 单元即它）
agentos-settings apply [--dark|--light|--auto]   # 手动一次性应用（默认读 settings.json）
agentos-settings status                # 状态快照 + 真相映射 + daemon 存活
agentos-settings ipc Get               # unix socket JSON 通道调试

# D-Bus：
busctl --user call org.agentos.Settings /org/agentos/settings org.freedesktop.DBus.Properties \
  Get ss org.agentos.Settings darkMode
busctl --user call org.agentos.Settings /org/agentos/settings org.agentos.Settings Apply s dark
dbus-monitor "type='signal',interface='org.agentos.Settings'"   # 看 Changed
```

旧入口 `scripts/theme-apply-all.sh [--dark|--light|--auto]` 保留为薄壳转发 CLI；
`scripts/theme-*.sh` 五桥保留、头部已标注"已收编，遗留兼容/单桥排查"。

## 5. 测试

`packages/settings-daemon/test`（vitest，与 monorepo 一致）：

- `palette.test.ts`：双键映射（蛇形 72+m 驼峰 16、键序、兜底）、blend（python 银行家舍入
  对拍）、变体检测（暗/浅两板、两种明度口径一致）、8 位色。
- `bridges.test.ts`：每桥 tmp 目录写文件断言（fuzzel 全 8 位/[border] 小节、ghostty 幂等块/
  浅档极性翻转、gtk 35+22 项/shade rgba/ini 单行翻转/gsettings 同向）；**字节级对拍**——
  同一色板分别跑旧 shell 桥与 TS 桥，输出必须一致（暗/浅双档，"逻辑照搬、不自创行为"的
  机器证明）；旧脚本标记块能被新桥清掉（迁移期防双块）。
- `hub.test.ts`：环保护四态 + 端到端拓扑（colors.json 覆写 → apply → 桥写回 → 无二次事件）。
- `apply.test.ts`：auto/强制/浅板缺失回落/全缺失报错/状态快照映射；state 往返与 darkMode 兜底。
- `ipc.test.ts`：socket Get/Apply/Reload 往返、D-Bus 不可用时降级 socket-only、常量即规格。

## 6. 部署（VM/真机）

```bash
npm run build -w packages/settings-daemon          # 产物 dist/（dbus-next 纯 JS 随 node_modules）
cp os/systemd/agentos-settings.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now agentos-settings
# Noctalia 钩子清空（一次性，职责移交）：
#   settings.json 的 hooks.darkModeChange/wallpaperChange/colorGeneration 置 ""，enabled 保留
journalctl --user -u agentos-settings -f           # 观察环保护：应无"自写回声上行"
```

## 7. UI（canvas /settings 页，2026-10-19 接入）

AgentOS 自己的系统设置页落在 canvas：`/settings`（外观/凭据/系统/迁移四分区，
详见 [settings-ui.md](settings-ui.md)）。与本 daemon 的边界：

- **读**：页面后端直接读 `settings-state.json` 状态快照 + socket `Get` 存活探测
  （与 CLI `ipc` 同一行协议）；
- **写**：切换按钮 = 翻真相（noctalia settings.json 的 `colorSchemes.darkMode`）+
  起本包 CLI `apply`（auto）收敛——不直接调 D-Bus `Apply(--dark)` 强制变体，
  那会被 watcher 按真相立即回滚（实测教训，见 settings-ui.md §2）。

## 8. 遗留与后续

- ~~canvas 设置页接入~~（✅ 2026-10-19，`/settings` 页实测；页面配色仍 CSS 变量直读
  colors.json，状态/操作走上述通道）。
- **更多状态源**：壁纸、键位等设置项可挂进同一 daemon（state 模块按源映射，不抢真相）。
- **Rust 长期方向**：见 ADR-0002——本轮 TS 复用 monorepo 语言栈与 @agentos/proc 基建，
  全项目 Rust 化时此包是第一批迁移对象（watcher/桥/D-Bus（zbus）语义已在测试里钉死）。
