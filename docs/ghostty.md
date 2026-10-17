# Ghostty 默认终端切换：调研与真机实证

> 2026-10-17 · 调研+PoC · VM：Fedora 44 aarch64（VMware）+ niri 26.04 + ghostty 1.3.1
> 分支 `feat/ghostty-terminal`。结论先行：**建议切换（条件切）**——见 §7。

目标形态：**Catppuccin Frappé 主题 + 毛玻璃（半透明 + 背景模糊）**。

---

## 0. 结论速览

| 项 | 结论 | 证据 |
|---|---|---|
| ghostty 在 Fedora 44 aarch64 可用 | ✅ 1.3.1，经 COPR `scottames/ghostty`（**不在官方仓库**） | §1 |
| Catppuccin Frappé 主题 | ✅ 内置，但主题名带空格：`Catppuccin Frappe` | §2 |
| CJK 中英混排 | ✅ Noto Sans Mono CJK SC，无豆腐块，粗/斜体正确 | §3 |
| ghostty 自带 background-blur 在 niri | ❌ **不生效**（只走 KDE 私有协议，niri 未实现） | §4 |
| niri 26.04 窗口规则 background-effect 模糊 | ✅ **真毛玻璃生效**（组合器侧，A/B 截图实证） | §4 |
| 最终形态（Frappé + 半透明 + 模糊） | ✅ ghostty opacity 0.85 + niri blur 规则，真机达成 | §4 |

---

## 1. 可用性：版本与来源

**前提纠偏**：任务原假设"F41+ 官方仓库应有 ghostty"——**实测不成立**。
`dnf info ghostty` / `dnf repoquery ghostty` 在 fc44 官方+updates 均无匹配；
ghostty 官方安装文档也明确 Fedora 走 COPR（官方打包审查多年未落地）。

COPR 选型（2026-10 时点）：

| COPR | 状态 | 备注 |
|---|---|---|
| `pgdev/ghostty` | ❌ 已不存在 | API 返回 "Project does not exist"（社区曾长期推荐，已删除） |
| `scottames/ghostty` | ✅ 采用 | chroot 覆盖 fc43/fc44 aarch64+x86_64；ghostty 1.3.1-4 构建成功（2026-08 附近），依赖 gtk4-layer-shell 一并提供 |
| `Quintiliano/ghostty` | 未测 | 备选 |

安装（VM 实测）：

```bash
sudo dnf copr enable -y scottames/ghostty
sudo dnf install -y ghostty     # 110.6 MiB，含 gtk4-layer-shell；磁盘充足（余 5.7G）
```

`ghostty +version` 关键信息：GTK 4.22（build）/4.22.1（runtime）、libadwaita 1.9、
OpenGL 渲染器、fontconfig/freetype 字体引擎、io_uring。Wayland app-id 为
**`com.mitchellh.ghostty`**（niri 窗口规则匹配用）。

安装来源已固化进 `os/install.sh`（dnf 分支：检测 `command -v ghostty` 幂等安装；
pacman 分支：ghostty 在 Arch 官方 extra 仓库直接进清单）。

## 2. 主题：Catppuccin Frappé

`ghostty +list-themes` 内置四个 Catppuccin 变体（Frappe/Latte/Macchiato/Mocha），
**无需手写色板**。

⚠️ **踩坑记录**：主题文件名带空格（`/usr/share/ghostty/themes/Catppuccin Frappe`），
配置写 `theme = catppuccin-frappe` 会报 "theme not found" 并弹"配置错误"窗（真机踩过）；
正确写法是 `theme = Catppuccin Frappe`。最终配置已按此入库（`os/configs/ghostty/config`）。

## 3. 字体与 CJK 渲染

- VM 已装 `google-noto-sans-mono-cjk-vf-fonts`（可变字体 ttc），配置
  `font-family = Noto Sans Mono CJK SC`。
- ghostty 日志确认 regular/bold/italic/bold_italic 全部解析到同族（Bold 变体正确）。
- 真机截图（Test B）视觉判定：中文字形完整（"中英混排 Mixed CJK 渲染测试/毛玻璃
  blur 实证"等均正常）、无豆腐块、彩色文字（红绿黄蓝紫青）可辨。

## 4. 毛玻璃实证（本任务核心）

### 4.1 协议分析：为什么 ghostty 自带 blur 在 niri 无效

三层证据：

1. **ghostty 1.3.1 源码**（`src/apprt/gtk/winproto/wayland.zig`）：Wayland 后端的
   `syncBlur()` 第一行 `const manager = self.app_context.kde_blur_manager orelse return;`
   ——模糊只通过 **KDE 私有协议 `org_kde_kwin_blur_manager`** 请求，合成器不广播该
   global 就静默放弃。全文件无 ext-background-effect 引用。
2. **ghostty 文档**（`+show-config --default --docs`）："KDE Plasma (Wayland and X11)…
   All other Linux desktop environments are as of now unsupported."
3. **niri 26.04 实机**（`wayland-info`）：广播的全局接口里只有
   `ext_background_effect_manager_v1`，**没有** `org_kde_kwin_blur_manager`。

结论：两侧协议**零重叠** → ghostty 的 `background-blur = true` 在 niri 下是 no-op。

### 4.2 A/B 实证（同窗口同位置，唯一变量为 niri 规则）

测试方法：ghostty 浮窗固定在屏幕下半部（1280x800 屏，窗口 700x280 @ y≈510，
避开同机另一测试的顶部区域），压在 kita 壁纸花朵/人物发丝上，`grim` 截图后
视觉模型判定（截图留存 VM `/tmp/ghostty-testA.png`、`/tmp/ghostty-testB.png`）。

| | ghostty 侧 `background-blur` | niri 窗口规则 `background-effect { blur true }` | 视觉判定 |
|---|---|---|---|
| Test A | true | 无 | **仅半透明**：壁纸细节被暗色罩住但形态可辨，无柔化晕开（模型明确排除毛玻璃，与"半透明叠加"特征一致） |
| Test B | true（同 A） | 有 | **真毛玻璃**：窗口内花朵/发丝高斯柔化成色斑，窗口外同源区域锐利；中文渲染正常；置信度 95% |

### 4.3 达成路径（已入库）

毛玻璃 = 两侧配合：

- **ghostty 侧**（`os/configs/ghostty/config`）：`background-opacity = 0.85`（ghostty
  自渲染，任何合成器有效）；`background-blur = true` 保留——niri 下静默无害，
  KDE 上或上游落地新协议后直接生效。
- **niri 侧**（`os/configs/niri/config.kdl` 末尾 window-rule）：

  ```kdl
  window-rule {
      match app-id="^com.mitchellh.ghostty$"
      background-effect {
          blur true
      }
  }
  ```

  niri 26.04 的 `background-effect` 是**组合器侧**规则（对应 ext-background-effect-v1
  的能力面），不要求客户端请求。注意（niri Window Effects 文档）：窗口必须半透明
  （opacity 由 ghostty 出）；规则式模糊跟随 geometry-corner-radius；非 xray 模糊
  官方标注 experimental（本机实测正常，异常时删规则块即退回纯半透明）。

## 5. 配置说明与部署

| 仓库文件 | 部署到 | 说明 |
|---|---|---|
| `os/configs/ghostty/config` | `~/.config/ghostty/config` | 主题/字体/opacity/关窗确认/无标题栏/单实例关/padding，逐项中文注释 |
| `os/configs/niri/config.kdl` | `~/.config/niri/config.kdl` | Super+Return 与 Mod+T 别名 → ghostty；末尾 blur window-rule |
| `os/install.sh` | — | pacman 清单加 ghostty；dnf 分支幂等启用 COPR 并安装 |

其余配置取舍（见配置文件注释）：`confirm-close-surface = false`（agent 批量开关
终端不弹确认）、`gtk-single-instance = false`（外部 `ghostty -e cmd` 拉起行为可预期）、
`gtk-titlebar = false`（平铺 WM 省一行，标题由状态栏展示）。

fuzzel：仓库无 fuzzel 配置（VM 侧默认无 terminal 动作），无需改动。

## 6. 与 LanRhyme 观感对齐

LanRhyme 个人终端即 ghostty。本切换后 AgentOS 默认终端与其同源，差异收敛到
主题：LanRhyme 走莫兰迪动态色板（`os/configs/noctalia/lanrhyme/`，flavours 生成
含 ghostty 目标），AgentOS 默认走 Catppuccin Frappé 内置主题。两者不冲突：
lanrhyme 主题应用脚本会覆盖 `~/.config/ghostty` 或以 flavours 侧写入，默认配置
作为无 lanrhyme 时的基底。

## 7. 建议：切 / 不切 / 条件切

**建议：切（条件切）**，条件与理由：

1. **切的理由**：形态达成（Frappé+毛玻璃真机实证）；内置主题开箱即用；CJK 渲染
   良好；`-e` 场景行为清晰；与 LanRhyme 生态对齐；alacritty 无主题/模糊等观感
   能力且上游沉寂。
2. **条件（遗留，按风险排序）**：
   - **第三方 COPR 供应链**：`scottames/ghostty` 是个人仓库，AgentOS 若作为发行物
     依赖它需在发布评审时决策（等待 Fedora 官方打包 / 自建 COPR / pin 版本+校验）。
   - **模糊依赖 niri ≥ 26.04 且 experimental**：低版本 niri 下退化为纯半透明（可用），
     需在发行说明标注最低 niri 版本。
   - **bootc 镜像线未跟**（有意遗留）：`os/bootc/` Containerfile 的 alacritty 行
     不改（另一条线刚定稿）；合并后 bootc 线补 ghostty 时需同步 COPR 逻辑。
   - **Arch/pacman 路径未实测**（无 Arch 真机）；extra/ghostty 存在性按社区共识写入，
     x86_64 主线装机时验证。
   - **上游跟进点**：ghostty 实现 ext-background-effect-v1（discussions #13378/#12559）
     后，可删 niri 侧规则、由 `background-blur` 单键达成。

## 8. 遗留清单

- [ ] Fedora 官方 ghostty 打包落地后，install.sh 去 COPR 化（跟踪 ghostty docs/install）。
- [ ] ghostty 上游 ext-background-effect-v1（#13378）落地后简化 blur 链路。
- [ ] bootc 线（os/bootc Containerfile）择期切换终端并补 COPR；当前标注 alacritty
      为镜像线默认终端。
- [ ] pacman 路径真机验证（x86_64 主线）。
- [ ] 观感回归：opacity 0.85/blur 组合在浅色壁纸下的可读性抽样（当前仅 kita 暗调壁纸实证）。

## 9. 证据索引

- VM 截图：`/tmp/ghostty-testA.png`（无规则，仅半透明）、`/tmp/ghostty-testB.png`
  （blur 规则，真毛玻璃+中英混排）——视觉模型判定结论分别"半透明叠加，非毛玻璃"、
  "高斯柔化生效，置信 95%"。如需长期留存，复制进本仓库 docs/assets/。
- ghostty 源码：ghostty 1.3.1 `src/apprt/gtk/winproto/wayland.zig`（syncBlur 仅 KDE 协议）。
- niri 全局接口：VM `wayland-info` 输出（仅 ext_background_effect_manager_v1）。
- ghostty 运行日志：VM `/tmp/ghostty-test.log`（字体解析/OpenGL/GTK 版本）。
- 参考：[ghostty 安装文档（Fedora=COPR）](https://ghostty.org/docs/install/binary)、
  [niri Window Effects](https://niri-wm.github.io/niri/Window-Effects.html)、
  [niri v26.04 发布讨论](https://github.com/niri-wm/niri/discussions/3899)、
  [ghostty #13378 ext-background-effect-v1 请求](https://github.com/ghostty-org/ghostty/discussions/13378)、
  [#12559](https://github.com/ghostty-org/ghostty/discussions/12559)、
  [#8197](https://github.com/ghostty-org/ghostty/discussions/8197)。
