# os/configs/theming/ — 美化配置样板

灵感来源 [LanRhyme/dotfiles](https://github.com/LanRhyme/dotfiles)（CachyOS + niri + Noctalia）。
**该仓库无 LICENSE，本目录所有文件均为参考思路后的重写，未拷贝任何原文/资源**；
完整移植方案见 `docs/theming.md`。

| 文件 | 作用 | 部署到 |
|---|---|---|
| `niri/aesthetics.kdl` | niri 布局美学（gaps 8/居中策略/焦点环莫兰迪色）+ 动画（临界阻尼 spring + 关闭掉落着色器） | `~/.config/niri/aesthetics.kdl`，主配置 include |
| `fontconfig/01-agentos-cjk.conf` | CJK 字体回退（西文字体补 Noto Sans CJK SC，避免全局字体污染） | `~/.config/fontconfig/conf.d/` |
| `gtk-3.0/settings.ini` | 暗色 + Bibata 光标 + Tela 圆形图标 + Noto CJK 字体 | `~/.config/gtk-3.0/settings.ini` |
| `gtk-4.0/settings.ini` | 同上（GTK4） | `~/.config/gtk-4.0/settings.ini` |

## 依赖包（dnf）

```bash
sudo dnf install google-noto-sans-cjk-fonts google-noto-sans-mono-cjk-fonts
# 光标与图标主题需 COPR 或手动安装（Bibata / Tela-circle），见 docs/theming.md §依赖
```

## 部署步骤

```bash
cd <repo>/os/configs/theming
cp niri/aesthetics.kdl ~/.config/niri/
# 主配置 config.kdl 顶部确保有：include "./aesthetics.kdl"
mkdir -p ~/.config/fontconfig/conf.d && cp fontconfig/01-agentos-cjk.conf ~/.config/fontconfig/conf.d/
cp gtk-3.0/settings.ini ~/.config/gtk-3.0/ 2>/dev/null || (mkdir -p ~/.config/gtk-3.0 && cp gtk-3.0/settings.ini ~/.config/gtk-3.0/)
cp gtk-4.0/settings.ini ~/.config/gtk-4.0/ 2>/dev/null || (mkdir -p ~/.config/gtk-4.0 && cp gtk-4.0/settings.ini ~/.config/gtk-4.0/)
niri validate   # 验证配置
# 注销重登生效
```

## 后续（P1/P2，见 docs/theming.md）

- P1：Noctalia 桌面壳实装（壁纸 + Material You 取色，niri 的 background-color "transparent" 已为它留好位置）
- P2：动态色板生成器（重写莫兰迪化逻辑：从 Noctalia colors.json 生成 niri 色板/alacritty 主题等）
