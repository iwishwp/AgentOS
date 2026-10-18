# 美化方案：参考 LanRhyme/dotfiles 的视觉体系

> 状态：v1（2026-10-17，分支 feat/theming-lanrhyme）
> 参考对象：[LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles)（CachyOS + niri + Noctalia，本项目最初选定的视觉基准）

## 1. 它的体系解剖（值得学的五层结构）

研究其仓库后，这套 dotfiles 的"好看"不是一堆配置的堆砌，而是一个**分层主题系统**：

| 层 | 组成 | 值得学的地方 |
|---|---|---|
| ① 壁纸取色 | Noctalia 桌面壳的 Material You 引擎，从壁纸提取 `colors.json` | 换壁纸 = 全系统换色的信号源 |
| ② 莫兰迪化 | `morandi-gen.py`：HSL 降饱和（0.3）+ 暖移 + 饱和度上限 45 | 把 Material You 的鲜亮色变成耐看的莫兰迪 |
| ③ 一次性分发 | 生成器同时写：niri `cfg/colors.kdl`、starship、fcitx5、fastfetch、alacritty、KDE 色板 | **一处改色，处处生效**——组件间色彩一致性的来源 |
| ④ niri 模块化 | `config.kdl` 只有 89 行，`include` 拆出 8 个 `cfg/*.kdl`（键位/布局/动画/颜色/自启…） | 配置可维护性；我们已采纳（主配置 + aesthetics.kdl） |
| ⑤ 细节质感 | 临界阻尼 spring 动画（damping 1.0 = 无回弹的"丝滑"）、窗口关闭掉落着色器、CJK 字体回退、Bibata 光标 + Tela 圆形图标 | "高级感"实际来自这些参数选择 |

## 2. 版权策略（重要）

该仓库**没有 LICENSE 文件**——默认版权全保留。因此：

- ✅ 学思路、学参数取向（gap 数值、spring 参数、字体回退策略这类"事实性配置"不受版权保护，且我们自写）
- ✅ niri 窗口关闭着色器用官方 wiki 文档的示例变体（注明出处）
- ❌ 不拷贝其任何代码文件（morandi-gen.py 等需我们重写）
- ❌ 不搬运其壁纸与任何资源文件（用户的壁纸自行放置，Noctalia 会自动取色）

## 3. 移植映射表

| LanRhyme 的东西 | 我们的处置 | 状态 |
|---|---|---|
| niri gaps 8 / 居中策略 / 透明背景 | `os/configs/theming/niri/aesthetics.kdl`（自写，含注释） | ✅ 本分支 |
| 临界阻尼 spring 动画参数 + 关闭着色器 | 同上（着色器为 niri wiki 官方示例变体） | ✅ 本分支 |
| CJK 字体回退（西文字体定向补 Noto CJK） | `fontconfig/01-agentos-cjk.conf`（重写精简版） | ✅ 本分支 |
| GTK 暗色 + Bibata 光标 + Tela 图标 + Noto CJK | `gtk-3.0/4.0/settings.ini`（取向参考，内容自写） | ✅ 本分支 |
| niri 配置模块化（cfg/*.kdl + include） | 主配置 include aesthetics.kdl，后续按需继续拆 | ✅ 本分支（轻量版） |
| Noctalia 桌面壳（壁纸/取色/通知/bar） | P1 实装：niri 的 `background-color "transparent"` 已为它留位 | ⬜ 下一步 |
| morandi-gen.py 动态色板生成器 | P2 重写：从 Noctalia colors.json 生成 niri 色板（去 KDE/fastfetch 等我们暂无的组件） | ⬜ |
| 壁纸 | 不搬运；用户自放（Material You 自动取色） | — |
| fish/kando/btop/cava/fastfetch | 与 AgentOS 核心体验无关，暂不纳入（终端已切换为 ghostty：内置 Catppuccin Frappé + niri 侧毛玻璃，见 docs/ghostty.md；其配置随 os/configs/ghostty/ 分发） | — |
| REAPER/Blender 等个人应用配置 | 不相关 | — |

## 4. 依赖与安装来源（Fedora/dnf）

```bash
# 字体（官方仓库）
sudo dnf install google-noto-sans-cjk-fonts google-noto-sans-mono-cjk-fonts
# Noctalia（P1）：Fedora 无官方包，按其仓库 README 安装（QuickShell 系）
# Bibata 光标 / Tela-circle 图标：Fedora 官方仓库缺，需 COPR 或手动安装——
#   若嫌麻烦可先用 adw-gtk3-theme + 默认光标，视觉打折但不阻塞
```

## 5. 验收路径（VM 实测步骤）

1. 依赖包安装（上述 dnf 命令）；
2. 按 `os/configs/theming/README.md` 部署四组配置；
3. `niri validate` 通过；
4. 注销重登：窗口间距 8px、焦点环灰绿色、窗口关闭有掉落动画、GTK 应用暗色；
5. 中文渲染检查：alacritty 里跑 `fc-match "Arial"` 应返回 Noto Sans CJK SC（回退生效）；
6. 截图对比（before/after 存 `~/Agent/screenshots/`）。

## 6. 与里程碑的关系

美化属于 M5（发行打磨）的前置工作，不阻塞 M4（信任与安全）主线；
P1（Noctalia 实装）建议排在 M4 收尾后、与 M5 的默认配置打磨合并进行。

## 7. 视觉语言规范（雏形，2026-10-18 第一批实测归纳）

> 第一批统一对象：mako 通知（已达标）→ fuzzel 启动器 → Super+K 键位浮层。
> 以下档位全部经 VM 实拍像素级验证（色值实测与 colors.json 生成值一致）；
> 后续 orb 悬浮球、canvas 页面按此收口。

### 7.1 档位表

| 档位 | 值 | 来源依据 | 已应用 |
|---|---|---|---|
| 卡片圆角 | **12px**（内嵌元素如 fuzzel 选中行 8px） | mako border-radius=12（首批验收基线） | mako ✅ / fuzzel ✅ / 键位浮层 ✅ |
| 卡片描边 | **2px**，色 = `outline_variant`（#6c6a61） | mako border-size=2 | 同上 |
| 卡片底色 | `surface_container`（#37362f），**不透明度 93±1%**（透一点壁纸） | 键位浮层 0.93 / fuzzel 0.94 实拍同感 | 同上 |
| 选中/高亮底 | `surface_container_highest`（#3d3b34） | fuzzel 选中行 | fuzzel ✅ |
| 强调色 | `primary`（#dad8ce 暖米白）：匹配高亮、箭头+说明列、critical 描边 | Omarchy 行式结构（键列中性、说明点色） | fuzzel ✅ / 键位浮层 ✅ / mako(critical) ✅ |
| 正文/键列 | `on_surface`（#f3f3f2），键列用等宽 + DemiBold | Omarchy bold mono 键名 | 键位浮层 ✅ |
| 次级文字 | `on_surface_variant`（#b5b4b0），低透明度 0.7–0.8 用于标题/提示 | 弱化层级 | 全部 ✅ |
| 字体 | 正文 Noto Sans CJK SC；键名/代码 等宽 | 系统字体（bar 同源） | 全部 ✅ |
| 悬浮形态 | **顶部居中**（状态栏 37px 下留 16–27px 间距），宽度克制（启动器 ~40% 屏宽 / 键位卡片 ≤50% 且 ≤680px），四周见壁纸 | Omarchy 参考（用户裁定：非全屏） | fuzzel ✅ / 键位浮层 ✅ |
| 背景压暗 | 模态浮层下 15% 黑 | Omarchy 模态语感 | 键位浮层 ✅ |

### 7.2 色相一致性实测（同族判据）

卡片族在 HSV 空间收敛：底色 H=50–60°、S≤15%、V≈22%；描边 H≈49°；文字/强调
H=40–60°、S≤7%。三张卡片（mako / fuzzel / 浮层）实测底色 #37362f / #373631 /
#353530——同色相同明度族（差异来自各自透明度叠不同壁纸区域，属预期）。
状态栏底为近不透明深底（叠深色壁纸后 #0b0b23，冷调来自壁纸透出），卡片暖调
为 morandi 色板正色——卡片族内部一致即"同族"，不向状态栏的壁纸透出色对齐。

### 7.3 组件接入清单（后续收口）

- orb 悬浮球：底/描边/圆角按上表；未做。
- canvas 页面（/keys 等）：CSS 变量从 colors.json 生成；未做。
- mako：已达标本表（作为档位基线来源）。

### 主题同步原则（2026-10-18 用户提出）

一切**第一方可主题界面**读同一份规范色板，**暗/浅双变体**（Material 蛇形键）：

- 暗色规范源：`~/.config/noctalia/lanrhyme-palette.json`（仓 `os/configs/noctalia/lanrhyme/colors.json`）
- 浅色规范源：`~/.config/noctalia/lanrhyme-palette-light.json`（仓 `colors-light.json`，由
  `scripts/gen-palette-variant.py` 从暗色板规则推导：surface 系→暖白米灰 #f5f4f0 系、
  on_*→深暖文字、主色深一档保对比度、container→浅 tint、饱和度全程压住；输出同构 72 键）

**统一调度器 `scripts/theme-apply-all.sh`**：读 settings.json 的 `colorSchemes.darkMode`
选变体（`--dark/--light` 可强制），`export AGENTOS_COLORS_JSON=<变体>` 后依次跑全部桥，
末尾打印结果一览；缺浅色板回落暗档。Noctalia 三个钩子
（darkModeChange/wallpaperChange/colorGeneration）全部挂调度器——切档/换壁纸时
Noctalia 先覆写 colors.json，钩子按最新 darkMode 把**对应变体**重落到全部界面。
换壁纸重生成色板后全系统跟随。当前消费方与桥接脚本：

| 界面 | 桥接 | 状态 |
|---|---|---|
| 状态栏 Noctalia | theme-noctalia.sh（m 驼峰转换，v4.7.1 键名陷阱见 docs/noctalia.md） | ✅ 双变体 |
| mako 通知 | theme-mako.sh（makoctl reload 即时生效） | ✅ 双变体 |
| fuzzel 启动器 | theme-fuzzel.sh | ✅ 双变体 |
| 键位浮层 / 悬浮球 | QML 直读（兜底内置同值；浮层 spawn 时读色，运行中不热重载） | ✅ 跟随 |
| ghostty 终端 | theme-ghostty.sh（16 色；新窗口生效） | ✅ 双变体 |
| **GTK3/4 全应用** | **theme-gtk.sh**（@define-color 覆盖 libadwaita 命名色 35 项 + GTK3 旧色名 22 项；与 settings.ini 共存，仅单行翻转 gtk-application-prefer-dark-theme；新窗口生效） | ✅ 双变体 |
| canvas 三页 | CSS 变量直读 colors.json | ✅ |
| Qt/Kvantum、编辑器类（VSCode 等） | 未做（Qt 侧可后续走 Kvantum 生成，编辑器主题另议） | ⬜ |

2026-10-18 晚实测（VM 像素采样）：暗档计算器对照组（无 css）#3e3e41 冷调 vs 套色后
#414039 暖调，surface_container/surface/primary/on_surface 四键精确命中；浅档计算器
container #f0efe8、primary #76725c（=键）精确命中、prefer-dark 自动翻 false；状态栏/
mako/fuzzel/浮层两档均实测同族跟随。

### 切换主题后各界面如何生效（2026-10-18 实测）

| 界面 | 生效方式 | 时延 |
|---|---|---|
| 状态栏/面板（Noctalia） | watchChanges 热重载 colors.json | 即时 |
| mako 通知 | theme-mako.sh 内置 makoctl reload | 即时 |
| fuzzel 启动器 | 每次唤起读配置 | 下次打开 |
| ghostty 终端 | **新开窗口生效**；已开窗口不跟随——实测两条路（配置文件变更监视 + 手动 ctrl+shift+, 重载）已开表面均不换色，palette 属 surface 级配置（ghostty 上游已知行为） | 新窗口 |
| GTK 应用 | 暗/亮跟随 gsettings 即时（libadwaita 内建）；**命名色覆盖（gtk.css）只对新进程生效**，已开应用不重读 | 暗/亮即时、调色板重启 |
| canvas 三页 | 刷新页面（F5） | 手动 |
| 键位浮层/悬浮球 | 按键时起进程读色板，重开即新配色 | 下次触发 |

ghostty 浅色可读性（2026-10-18 修复）：16 色极性随变体翻转——浅色档 ANSI 前景全部
向 on_surface（深字色）调和，container 系（原生是背景色）不再直接用作前景；
背景用 surface_container（比纯 surface 深一档）避免过亮。
