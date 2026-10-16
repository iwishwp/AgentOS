# Noctalia v4.7.1 补丁集（适配 Fedora quickshell 0.2.1^git20260209）

针对上游 tag `v4.7.1`（legacy-v4 分支）的 4 个补丁，按编号顺序应用。
上游仓库：<https://github.com/noctalia-dev/noctalia>（分支 `legacy-v4`）。

## 应用方法

```bash
# 在解压好的 noctalia v4.7.1 源码树根目录（含 shell.qml）：
git apply 0001-spectrum-PwAudioSpectrum-quickshell-0.2.1.patch
git apply 0002-compositor-Mango-Quickshell.DWL.patch
git apply 0003-compositor-Labwc-Quickshell.WindowManager.patch
git apply 0004-ui-BackgroundEffect-blur-Region-0.2.1-API.patch
# 或一把梭：for p in [0-9]*.patch; do git apply "$p"; done
```

每个补丁都带 `AGENTOS-PATCH(noctalia-v4.7.1/NN)` 标记，`grep -rn AGENTOS-PATCH` 可定位全部改动点。

## 补丁清单

| # | 文件 | 原因 | 影响 |
|---|---|---|---|
| 0001 | `Services/Media/SpectrumService.qml` | `PwAudioSpectrum` 类型在 quickshell 0.2.1 中不存在 | 音频频谱视觉化静止（values 恒空），其余功能不受影响 |
| 0002 | `Services/Compositor/CompositorService.qml` | MangoService 依赖的 `Quickshell.DWL` 模块未随 Fedora 包编译 | 移除 MangoWC 合成器后端（惰性组件+检测分支）。AgentOS 只跑 niri，不影响 |
| 0003 | `Services/Compositor/CompositorService.qml` | LabwcService 依赖的 `Quickshell.WindowManager` 模块未编译 | 移除 LabWC 后端，同上不影响 niri |
| 0004 | `Modules/MainScreen/MainScreen.qml`、`Modules/Panels/Launcher/LauncherOverlayWindow.qml`、`Modules/Dock/Dock.qml` | `BackgroundEffect`（blur attached property）与 `Region` 的 `*Corner` 圆角属性在 0.2.1 中不存在 | bar/launcher/dock 无背景模糊（毛玻璃）效果，纯装饰性损失 |

## 回滚

quickshell 升级到包含上述 API 的版本后（判据见 `docs/noctalia.md` 升级路径一节），
直接换装更新 tag 的原版源码即可，无需逐补丁回滚。
