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
| fish/starship/ghostty/kando/btop/cava/fastfetch | 与 AgentOS 核心体验无关，暂不纳入（终端保持 alacritty） | — |
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
