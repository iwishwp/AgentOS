# Noctalia v4.7.1 补丁集（按 quickshell 版本二选一）

针对上游 tag `v4.7.1`（legacy-v4 分支）。上游仓库：
<https://github.com/noctalia-dev/noctalia>（分支 `legacy-v4`）。

**补丁集随 quickshell 版本变化（2026-10-17 起 VM 走 quickshell 0.3.2）：**

| quickshell 版本 | 应用补丁 | 安装方式 |
|---|---|---|
| 0.2.1（Fedora F44 官方包） | 0001 + 0002 + 0003 + 0004 | `install-noctalia.sh`（默认目录全量） |
| **≥ 0.3（COPR errornointernet/quickshell，实测 0.3.2）** | **0001 + 0002 + 0005** | `install-noctalia.sh --patches <含 0001/0002/0005 的目录>` |

差异原因：0.3.2 已提供 `Quickshell.WindowManager` 与 `BackgroundEffect`
（撤 0003/0004，毛玻璃回归），但仍无 `Quickshell.DWL` 与 `PwAudioSpectrum`
（留 0001/0002）；同时 0.2→0.3 把 `Region` 的角布尔属性（`topLeftCorner` 等）
改成了每角半径整数（`topLeftRadius` 等）并删除 `CornerState` 枚举——0005 做等价
映射（state≥0 视为圆角 Style.radiusL，-1 直角 0）。

## 应用方法

```bash
# 在解压好的 noctalia v4.7.1 源码树根目录（含 shell.qml），按编号顺序：
git apply 0001-spectrum-PwAudioSpectrum-quickshell-0.2.1.patch
git apply 0002-compositor-Mango-Quickshell.DWL.patch
# quickshell ≥0.3 时接着：
git apply 0005-region-corners-quickshell-0.3.patch
# quickshell =0.2.1 时则是 0003/0004（毛玻璃牺牲）
```

每个补丁都带 `AGENTOS-PATCH(noctalia-v4.7.1/NN)` 标记，`grep -rn AGENTOS-PATCH` 可定位全部改动点。

## 补丁清单

| # | 文件 | 原因 | 影响 |
|---|---|---|---|
| 0001 | `Services/Media/SpectrumService.qml` | `PwAudioSpectrum` 类型缺失（0.2.1 与 0.3.2 均无） | 音频频谱视觉化静止（values 恒空），其余功能不受影响 |
| 0002 | `Services/Compositor/CompositorService.qml` | MangoService 依赖的 `Quickshell.DWL` 模块未随 Fedora/COPR 包编译（两版皆缺） | 移除 MangoWC 合成器后端。AgentOS 只跑 niri，不影响 |
| 0003 | `Services/Compositor/CompositorService.qml` | LabwcService 依赖 `Quickshell.WindowManager`（仅 0.2.1 缺） | 移除 LabWC 后端。**qs≥0.3 不应用** |
| 0004 | `Modules/MainScreen/MainScreen.qml` 等 | `BackgroundEffect`/`Region.*Corner` 缺失（仅 0.2.1） | 无毛玻璃。**qs≥0.3 不应用（毛玻璃回归）** |
| 0005 | `Modules/MainScreen/MainScreen.qml`、`Modules/Panels/Launcher/LauncherOverlayWindow.qml` | 0.2→0.3 API 变更：`Region` 角布尔 → 每角半径；`CornerState` 枚举被删 | 把 16 处角布尔映射为 `*Radius: state>=0 ? Style.radiusL : 0`；`CornerState.Normal` → `-1`。**仅 qs≥0.3 需要** |

## 回滚

quickshell 降级/出问题时：VM 有 snapper 快照 `agentos-pre-quickshell-0.3`
（2026-10-17，升级 0.3.2 前打的只读快照），可整体回滚。
