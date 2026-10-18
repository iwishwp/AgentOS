# 开发日志（DEVLOG）

> 按日期倒序记录每次落地的工作与决策；**待办清单在本文末尾**。
> 项目说明见 [README.md](README.md)；里程碑定义与逐项完成记录见
> [docs/milestones.md](docs/milestones.md)（本日志不重复其内容，只记"今天落了什么"）。

---

## 2026-10-18（深夜追加二：系统主题联动三件套——调度器/GTK 桥/双变体）

worktree `feat/theme-sync`。目标：换壁纸或切暗亮时，状态栏/通知/启动器/终端/全部
GTK 应用/自研 UI 一起跟随莫兰迪色板。

- **浅色变体生成器 `scripts/gen-palette-variant.py`**：规则驱动从暗色规范板推导
  （surface 系→暖白米灰 #f5f4f0 系、on_*→深暖文字、主色深一档保对比度 #76725c、
  container→浅 tint、饱和度全程压住），输出同构 72 键入仓 `colors-light.json`。
  非硬编码——换壁纸重生成暗色板后可重跑跟随。
- **GTK 桥 `scripts/theme-gtk.sh`**：覆盖面最大的桥。gtk-4.0/gtk.css 用
  `@define-color` 覆盖 libadwaita 命名色 35 项（accent/window/view/headerbar/
  popover/card/dialog/sidebar/borders/语义色），gtk-3.0/gtk.css 用旧色名 theme_*
  单独映射 22 项；BEGIN/END 标记块幂等。与 settings.ini 共存（光标/图标/字体行
  不动），仅按变体**单行翻转** gtk-application-prefer-dark-theme——浅色板配
  libadwaita 暗色样式会出斑，必须联动。变体由 surface 明度自动识别。
  坑：`pkill -x` 有 15 字符上限（gnome-calculator 关不掉），`pkill -f` bracket
  技巧在**同脚本里既有 spawn 字面量又有 pkill** 时会误杀自 shell（255）——
  spawn 与 pkill 分开调用。
- **统一调度器 `scripts/theme-apply-all.sh`**：读 settings.json
  colorSchemes.darkMode 选变体（--dark/--light 强制），export
  AGENTOS_COLORS_JSON 后依次跑五桥，末尾结果一览；单桥失败不中断；缺浅板回落
  暗档。apply-lanrhyme-theme.sh 部署双变体并改跑调度器；Noctalia 三钩子
  （darkModeChange/wallpaperChange/colorGeneration）全部改指调度器——切档时
  Noctalia 先覆写 colors.json，钩子按最新 darkMode 重落对应变体。
- **VM 实测全过（像素采样）**：
  - 暗档：状态栏 #dad8ce（胶囊主色精确）；计算器对照组无 css #3e3e41 冷调
    （R−B=−3）vs 套色 #414039 暖调（R−B=+8），且 surface_container #37362f
    （标题栏）×3576、surface #21201c ×1078、primary #dad8ce（=键）×386、
    on_surface #f3f3f2 ×35 精确命中；fuzzel 底 #35342e（#37362f@94%）+ 选中行
    #3d3b34 精确；ghostty 新窗 #33342e 暖族（0.85 透明+模糊下的 #21201c）；
    mako critical 底 #3d3b34 精确 + #dad8ce 描边 ×453。
  - 切浅（`qs -c noctalia ipc call darkMode toggle` +4s）：colors.json 已是浅变体
    （surface #f5f4f0、mPrimary #76725c、88 键蛇形+m 驼峰双保留）；计算器
    container #f0efe8 ×3171 + surface #f5f4f0 ×933 + primary #76725c ×386 +
    on_surface #282822 精确命中，两套 settings.ini prefer-dark 自动翻 false；
    状态栏 #76725c 精确；mako #f0efe8 精确；Super+K 浮层 #e9e8e1 暖浅族。
  - 切回暗：colors.json 回 #21201c；浮层重开后 #3d3c36 暖深族 ✓（浮层 spawn 时
    读 colors.json，运行中不热重载，重开即跟随——预期行为）。
- **遗留**：Qt/Kvantum 未做；编辑器类（VSCode 等）主题未接；浮层/ orb 热重载
  （需 FileWatcher，低优）。


---

## 2026-10-18（深夜追加：Noctalia"面板打不开"事故排查 + 0006 加固）

worktree `fix/noctalia-panel`。用户午报"设置/启动面板打不开，重启不复位"。

- **排查结论（证据链完整，见 docs/noctalia.md §11）**：故障窗口锁定在 10:01 起的
  长驻实例（by-id `nlt1pxy2nt`，11:47:34 被杀）。**11:47 重启后用户自己的四张排障
  截图（11:56/12:05/12:06/12:11）里设置面板全都开着**——"重启不能复位"不成立；
  唯一有实锤的失败是 11:58 launcher 一次走了 fuzzel 兜底（单次 IPC 非 rc0 抖动，
  后续 5 连测不复现）。故障实例 stderr 被 `/dev/null` 吞（Noctalia Logger WARN/ERROR
  只走 stderr），app 级证据全灭，单一根因不可考。排除项：desktop 文件、niri 改绑
  （无 layer-rule）、colors.json m 驼峰键、quickshell 0.3 API 遗留（全树 grep 干净）。
- **0006 补丁**（上游两个可精确复现该症状类别的脆弱点，双基线通用）：
  ① SmartPanel open 看门狗从 `onLoaded` 末尾提前到 `open()` + onLoaded 链 try/catch
  强制可见 + Loader Error 告警——修"面板卡已打开不可见（键盘独占+压暗）直到重启"；
  ② CurrentScreenDetector 800ms 超时恢复——修"多屏检测挂起后所有面板 open IPC 被
  静默丢弃"。已部署 agentos-vm。
- **可观测性**：新增 `scripts/noctalia-restart.sh`（bracket pkill + stderr 带时间戳
  追加到 `~/.cache/noctalia/shell-stderr.log`）——qslog 只有引擎级日志，下次面板
  问题有 stderr 可查。
- **全套验证过**（layers 独占随开合翻转 + 截图）：settings open/首次、settings
  toggle×5、agentos-launcher×5（零 fuzzel 兜底）、launcher clipboard 模式、bar 右键
  菜单、铃铛/ControlCenter widget 点击、ydotool 真键盘 Esc 关闭、收尾桌面干净。

## 2026-10-18（晚追加：视觉语言统一第一批——fuzzel + Super+K 浮层）

worktree `feat/visual-unify`。两交付，全部 VM 实拍像素级验证：

- **fuzzel 启动器主题化 ✅**（`scripts/theme-fuzzel.sh`，模式同 theme-mako.sh：colors.json
  取色、AGENTOS_COLORS_JSON 可覆盖、lanrhyme 同值兜底）：奶油白默认配色 → 莫兰迪卡片
  （底 #37362f 94%、选中 #3d3b34、匹配高亮 primary、描边 #6c6a61、圆角 12、anchor=top
  顶部居中悬浮）。**两个 fuzzel 1.14 的坑**：圆角/描边在独立 `[border]` 小节（[main]
  里写 border-radius 会报 not a valid option 且疑似中断后续解析）；颜色**只认 8 位
  #RRGGBBAA**，6 位静默回落默认色（第 1 轮描边一直渲染 #002b36 定位了半天才明）。
- **Super+K 浮层重做 ✅**（`os/configs/hotkeys/shell.qml`）：近全屏面板（用户否决态）
  → **顶部居中悬浮卡片**：宽 min(50%, 680)、高 min(68%, 余量)、topMargin 64（状态栏
  37px 下留 27px）、圆角 12 / 描边 2px / 底 93% surface_container——与 mako/fuzzel 同
  档位。行式保留"键列 + 固定起点箭头说明列"，配色结构对齐 Omarchy（键列中性白 DemiBold
  mono，箭头+说明 primary）。**交互坑**：翻页键原先挂在 ListView 的 Keys 上，但它没有
  焦点（焦点在全屏 Item）→ PageDown 失效；合并到焦点 Item 统一操作 contentY 即好。
  另：ydotool 发 Super+K 的 K 是 **37**（45 是 X），发错键会误判"浮层秒退"。
- **视觉语言规范雏形**写入 docs/theming.md §7（圆角/描边/底色/强调四档位），为后续
  mako（已达标）/orb/canvas 收口做底。
- 测试：229 基线不动全绿（只动 QML/shell 脚本/docs）。

## 2026-10-18（下午追加：goose 端到端 + 能力矩阵 + 通用 skill）

worktree `feat/goose-e2e-skill`（测试 229 基线不动，全绿）。三件事：

- **真 goose 无头会话端到端 ✅**（`goose run -t` + GLM glm-5.3-flash，全程审计留证，
  VM 证据目录 `~/e2e/`）：
  - **任务 1 系统操作链两跑**：首跑无代答——读操作全通，open_app/move/close 弹 T1 横幅
    30s 无人应答→超时 deny，桌面零变动（安全语义的天然实证）；重跑用
    `org.agentos.Confirm1.Respond` 编程应答（permissions.md §4.1 明示的测试通道）作
    用户代答：7 步全通——开 ghostty→移工作区 2（轮询时间线 ws_id 5→6 独立核验，
    模型还自行用 list_workspaces 核对 idx↔id 映射）→关闭→notify 汇报；
  - **任务 2 GUI 计算链**：水族馆开 gnome-calculator→dump 树→按名点 C/4/2/×/1/0/=→
    读文本得 **420**。四个诚实发现：①同名实例寻址歧义（桌面+水族馆两个 calculator，
    桥解析到先注册者，模型靠读状态自行判别后关旧实例）；②水族馆初始热键浮层遮挡截图，
    模型自主定位其不在 a11y 总线、借 `open_app` 在真实桌面 env 注入 Esc 关闭（agent
    沙箱连不上 root 600 的 ydotoold socket）；③T2 装包无头必 300s 超时（polkit 须人在），
    且残留认证框会抢水族馆键盘；④goose 内建 shell/developer 扩展不经 AgentOS 策略网关
    （策略面只覆盖 MCP 扩展——后续可考虑收紧 goose 配置）；
  - **任务 3 文档链**：files 读 inbox 三文件→写 `reports/weekly-report.fodt`（合计 118
    算对）→`open` 带 `app:"libreoffice"`→list_windows 实证 soffice 窗口→notify low+
    open_path 动作。视觉复核 Writer 渲染正常；顺带实证 "Document Recovery" 窗口现象。
  - **代答纪律**（与主会话用户复核撞车后确立）：代答器必须白名单——只放行
    niri.open_app/desktop.open 这类操作型确认；`desktop.confirm` 是 agent→用户提问通道，
    绝不代答。审计天然区分证据：by=respond（编程）/by=notify-action（真人，用户复核
    10:35:31 已成功留证）/by=timeout（无人）。
- **docs/capabilities.md ✅**：按 L0-L3 四层回答"agent 能否操作任何打开的应用"——
  结论"分层可预期而非任何"：L0/L2 全 ✅；L1 GTK3/4 ✅、Qt ⚠️（env 开关注册可达已实证、
  有窗树未验证——附录 A）、Chromium/Electron ⚠️（需 flag）、Java/X11/合成器 UI ❌；
  L3 grim/键盘 ✅、指针 ⚠️。含"哪类打不开"清单与补齐优先级。
- **skills/agentos-desktop/SKILL.md ✅**：自包含可移植版（YAML frontmatter + 挂载
  （goose/mcpServers 双格式）+ 45 工具速查表 + 行为约定 + 11 条实测坑 + L0→L3 升级
  路径），任何能挂 stdio MCP 的框架可用；README 文档区已挂链接；goose-system.md 注明
  "skill=对外可移植版 / goose-system=goose 专属版"关系（未删改）。

## 2026-10-18

- **M2 呈现层 ✅ 关账**（worktree `feat/m2-finish`，测试 194 → **229 全绿**）：最后两项
  落地并 VM 实测（详录 real-machine.md 当日条目）——
  - **artifacts 全类型统一索引**（`ec896ea`）：canvas 新增 `/api/artifacts`（扫描整个
    工作区，与 files-mcp 同一 AGENTOS_WORKSPACE 约定）+ `/artifacts` 索引页（莫兰迪、
    按目录分组、类型徽章、过滤框，/keys 同款骨架）；呈现通道按类型分：网页/图片在线看、
    文档提示由 agent `desktop__open` 打开、数据/影音可下载（`/api/artifacts/file` 带
    realpath 沙箱与 .trash 排除）；首页加三页互通导航。VM 实测 24 个真实产物六类全命中，
    截图经视觉模型复核无渲染异常；
  - **动作型通知"查看产物"**（`a00a64f`/`4b5c779`）：`desktop__notify` 增加可选
    `action`（open_url/open_path），内联 python3 D-Bus shim 发带 default+open 动作的
    通知并监听 ActionInvoked（agentos-confirm.py 同模式）；点击后 chromium --app /
    soffice（office 白名单）打开产物并写审计 `notify_action`；通道不可用自动降级为
    正文带地址+「对我说打开」约定。通知三档契约（完成=low+动作/失败=critical/需确认
    走 confirm）入档 goose-system.md。VM 全链路两轮实证（open_path→soffice 窗口、
    open_url→chromium 拉起，审计行留证）；
  - **两个实测新知**：① mako 1.11 的 `makoctl invoke` 在本机是静默空转（任意 id/动作
    rc=0 无信号）——编程触发必须走 mako 私有接口 `fr.emersion.Mako.InvokeAction`
    （default 与具名动作均可触发 ActionInvoked，gdbus monitor 留证；M4 记录据此修正）；
    ② mako 真实点击无法以合成输入证实：ydotool 1.0.4 `-a` 绝对定位受指针加速度影响
    落点漂移（help 自警），uinput 真 ABS 指针/单点触摸屏 niri 不消费——输入层限制，
    非 mako 结论，与 M4 横幅点选同批留待用户在场复核；
  - **工程教训**：跨语言 shim 的参数键名要统一（Node camelCase → python snake_case
    不一致曾让 watchdog 注册即崩：通知显示正常但点击永远无人应答，最狡猾的失败形态）；
    soffice 单实例锁会在无显示环境首启时被占死，后续调用全部转发不开窗，ssh 驱动
    GUI 验证必须带 WAYLAND_DISPLAY。

## 2026-10-17

单日四线并行（主线 + 3 个后台子代理 worktree），测试 129 → **194 全绿**。

- **M4 信任与安全 ✅ 关账**（`3d29d6f`）：权限分级 v1（`org.agentos.Confirm1`
  D-Bus + mako 四横幅载体 + policy `confirm` 决策 + 六 server 策略网关）、
  凭据三通道齐装（A 自动填充/B 代执行/C 短期注入 TTL 收割）、T2 装包链
  （快照→pkexec/polkit→审计）、canvas `/api/audit` + `/replay` 回放时间轴。
  退出标准双演示通过：185 行审计零明文；误操作（装 sl）→回放定位→`snapper
  rollback` 回滚态实证。
- **LanRhyme 观感落地**（`6d3a262`）：莫兰迪色板（源色 `#eee6ba`，`useWallpaperColors`
  防 colors.json 被覆写是关键机制）+ kita 壁纸 + 顶部横栏（用户偏好，LanRhyme 本人用左侧）。
- **毛玻璃回归**（`07bb61b`）：quickshell 0.2.1→0.3.2（COPR `errornointernet/quickshell`），
  niri 26.04 `ext-background-effect-v1` 原生支持；补丁集改为双版本矩阵，新增 0005
  （Region 角布尔→每角半径的 0.2→0.3 API 适配）。视觉模型验证栏后真高斯模糊。
- **M5 aarch64 镜像构建打通**（`0bf7df4`/`1c7dad6`/`e94be4c`/`a0f1359`）：
  quay 拉取走 Mac skopeo 中转（933MB/2min vs VM 直连 2h 失败）；修 bootc 基镜像
  `/root` 悬空符号链接与 F44 pipewire 包名；产出 `agentos:dev-aarch64` 4.38GB/81 层，
  容器冒烟全过。
- **M5 收尾五连（晚，worktree `feat/m5-final`）**：greenboot 接入（0.16.4 原生
  bootc 回滚支持，检查脚本语义按「greenboot 跑在登录前」设计防误报回滚）；
  CI 双架构 workflow 实装（原生 runner matrix，本地三重校验、未实跑如实标注）；
  bootc-image-builder 出 qcow2 2.0GB（预置 demon/wheel+sshd；五个坑入档：
  DefaultRootFs 必须显式、bib 只认标准 store 路径、多镜像 tar 丢 entrypoint、
  磁盘预算、构建机 store 位置）；**Fusion 点亮成功**（streamOptimized 只读坑
  定位→monolithicSparse；SDDM Wayland greeter 实跑、graphical.target 达成、
  canvas 200、goose 1.55.0；VM agentos-bootc-test 保留运行供亲验）；
  30 分钟演练：产物在手→可用对话 **11 分钟**（达标）。关键新知：bootc 部署期
  对系统单元重放 preset，构建期 enable 会被 99-default-disable 抹掉——镜像须
  随附 system-preset（Bazzite 同款），user 单元不受影响。详录 m5-atomic.md
  附 B/C/D。
- **键位速查页**（`92f8f8d`）：Super+K → canvas `/keys`（可滚动+分组吸顶+过滤框；
  键位实时解析 niri 配置、配色实时读 colors.json，双零副本）；`Mod+Shift+Slash`
  保留 niri 内置兜底。
- **M5 镜像点亮用户亲验 ✅（2026-10-18）**：用户登录 agentos-bootc-test 成功——
  SDDM → niri 会话可进、终端可运行。镜像骨架链闭合；观感层（Noctalia/主题/ghostty）
  未进镜像为已知断层，用户决定暂不补齐（补齐方案已备，随 D1/D2 一起拍板）。
  另：vmrun captureScreen 被拒是 macOS 权限弹窗无人处理所致——今后遇到宿主权限类
  失败立即告知用户处理，不再静默绕行。
- **键位速查浮层**（`c111027` 后续）：Super+K 弃用 chromium `--app`（"像启动了个 app"），
  改 layer-shell 覆盖层 `qs -c agentos-hotkeys`（`os/configs/hotkeys/shell.qml`）——
  Omarchy/niri 心智：居中面板+压暗背景+一行一条，Esc/点按关闭。数据/配色双零副本
  （实时解析 niri 配置 62 条全量 + 读 Noctalia colors.json）。canvas `/keys` 网页版
  保留为 agent 演示通道。两个 quickshell 0.3.2 实测坑入档：`FileView.text` 是同步
  方法且需 `blockLoading: true`；面板尺寸必须绑 `screen` 而非 `parent`（创建瞬间
  未定型 → 负宽度 → 不渲染）。
- **默认终端 → Ghostty**（`ebcf33b`/`353180b`）：COPR `scottames/ghostty`（官方仓库无包），
  内置 `Catppuccin Frappe` 主题 + Noto CJK；**毛玻璃真相**：ghostty 自带 blur 只走
  KDE 协议、niri 只提供 ext-background-effect-v1，零重叠——真模糊由 niri 窗口规则
  `background-effect { blur true }` 合成器侧实现（A/B 截图对照证实）。报告见
  [docs/ghostty.md](docs/ghostty.md)。

---

## 2026-10-18（晚）
- **两处收尾**：设置条目更名"系统设置"（去括号说明）；Noctalia 暗亮切换会**覆写
  colors.json**（实测切浅色后 72 键莫兰迪被 437 字节浅色默认顶掉）——挂
  darkModeChange/wallpaperChange/colorGeneration 三钩子自动重落色板，darkMode 回暗档
  （莫兰迪浅色变体留待后续生成）。

- **启动器统一与设置入口修复**：Super+D/Space → `agentos-launcher`（Noctalia 启动面板
  IPC，fuzzel 兜底——换状态栏只改脚本一处，键位与习惯不变）；"设置"打不开的根因=
  gnome-control-center 拒绝非 GNOME 会话（实测原话 "only supported under GNOME and
  Unity"）——隐藏死条目 + 新 agentos-settings.desktop 经 IPC 开 Noctalia 设置面板
  （该面板实测可开，截图存证）。


- **状态栏莫兰迪"假阳性"更正与真修复**：像素采样实锤——状态栏此前一直是 Noctalia
  内置海军蓝（#090922 系），10-17 的"莫兰迪已生效"是把默认黄 #fff59b 误判的假阳性
  （用户直觉"不是一个主题"是对的）。根因：v4.7.1 只认 m 驼峰键（官方模板
  Assets/Templates/noctalia.json），LanRhyme 蛇形键对不上→静默回落默认。
  `scripts/theme-noctalia.sh` 生成双键格式合并文件；复测栏主色 #21201c ✓。
- **ghostty 终端莫兰迪化**：`scripts/theme-ghostty.sh`（16 色+背景/前景/光标/选区，
  从规范色板生成，注释保留原 Catppuccin 可回切）。
- **系统主题同步原则**（用户提出，写入 theming.md §7）：一切第一方可主题界面读同一
  份 Material 蛇形色板（colors.json），换壁纸全系统跟随；第三方应用尽力而为。

## 2026-10-18（下午）

- **通知样式对齐系统主题**：`scripts/theme-mako.sh`——从 Noctalia 色板（colors.json，
  换壁纸自动跟随）生成 mako 配置：莫兰迪底/描边/圆角 12，三档紧急度分级
  （low 淡、normal 标准、critical 醒目描边+不过期=确认横幅档）；VM 实测截图过。

## 待办

### 用户侧（等你在场 / 你操作）

1. **吊销 GLM 临时 API key**（`367f40b9…` 开头那个，多次提醒过）；
2. **T1 复核**：真人鼠标点一次确认横幅（虚拟指针等价路径已验证，产品语义需真人过一遍）；
3. **T2 复核**：真人输一次 polkit 密码（ydotool 键盘等价已验证）；
4. **Ghostty**：物理键盘 Super+Return 实按开终端（当时为避免与 M4 ydotool 测试冲突跳过）；
5. **worktree 清理确认**：`../AgentOS-theming`（你的美化分支，已合并）、
   `../AgentOS-pi-research`（研究分支）——确认不用即可删；
6. **M5 点亮亲验**：`agentos-bootc-test` VM 正在 Fusion 运行（192.168.54.131，
   demon/123456）——用键盘在 SDDM 登录一次进 niri 会话（这是自动化覆盖不到的
   最后一步），看完可自行关机；产物在 `~/codespace/agentos-images/`。

- **goose 悬浮球**（`55e2faa`）：`qs -c agentos-orb` 常驻右缘——idle/working（审计驱动，
  显示当前工具）/attention（Confirm1 待确认）三态 + 点击面板（最近活动/待确认/直达
  /replay 与 /artifacts）；Confirm1 增只读 ListPending。VM 三态+面板全链实测。
### 设计债（用户观察 2026-10-18）

1. **启动器重复**：状态栏火箭图标（Noctalia Launcher，点击开 Noctalia 启动面板）与
   Super+D / Super+Space（fuzzel）是两套并存的启动器。建议：agent 优先+键盘文化下
   fuzzel 为主，去掉栏上火箭组件（或反过来全押 Noctalia 启动器并让 Super+D 调它——
   但其无 CLI 入口，需查 Noctalia IPC）。待用户拍板。
2. **状态栏与系统主题的"同源异形"**：色源一致（bar/键位浮层/mako 通知/orb 都读同一
   colors.json 莫兰迪色板），但**形态语言**不同——Noctalia 自带设计系统（胶囊 capsule、
   tabler 图标集、0.93 透明度），我们的浮层/通知是另一种语法（无胶囊、描边卡片）。
   建议：立一份"系统视觉语言"规范（胶囊半径/描边宽度/透明度/图标集/圆角档位），
   把 keys 浮层、mako、orb、canvas 三页对齐到同一语法。待排期。

### 项目侧（下次开发）

- **M5 发行（收尾会话已推进大头，剩尾款）**：x86_64 CI 实跑（workflow 已写好，
  接 GitHub 后 workflow_dispatch 首跑）、ISO 安装介质（bib 换代 `bootc-generic-iso`
  需实测）、greenboot 负路径回滚演示、M1 端到端任务在 bootc 新 VM 重放（需 API
  key）、发行决策 D1/D2 拍板（ghostty 进镜像 + COPR 供应链，分析已入
  m5-atomic.md §9）、`os/install.sh` x86_64 真机验证（ADR-0001 挂账）；
- **M2 收尾两项**：artifacts 全类型统一索引（现覆盖 HTML 类）、动作型通知（“查看产物”按钮）；
- **发行决策（M5 §9 分析已备，待拍板）**：ghostty 是否进 bootc 镜像（现为
  alacritty，且默认配置已 spawn ghostty——存在开箱断层，发行前必须闭合）；
  COPR `scottames/ghostty` 供应链三选一（信任/pin+校验/自建）；
- **等上游**：音频频谱（quickshell 缺 `PwAudioSpectrum`）；换壁纸自动重生成配色
  （需 noctalia CLI/matugen，LanRhyme 的 morandi-gen.py 已入库待接线）；
- **真机方案差异**：测试 VM 的 GDM 自动登录必须去除；chromium 首启双窗口 quirk；
  快照回滚永久化方向指向 bootc（本机 fstab 钉死 `subvol=root`，`set-default` 不生效）。
