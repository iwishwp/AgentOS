# 开发日志（DEVLOG）

> 按日期倒序记录每次落地的工作与决策；**待办清单在本文末尾**。
> 项目说明见 [README.md](README.md)；里程碑定义与逐项完成记录见
> [docs/milestones.md](docs/milestones.md)（本日志不重复其内容，只记"今天落了什么"）。

---

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
- **键位速查页**（`92f8f8d`）：Super+K → canvas `/keys`（可滚动+分组吸顶+过滤框；
  键位实时解析 niri 配置、配色实时读 colors.json，双零副本）；`Mod+Shift+Slash`
  保留 niri 内置兜底。
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

## 待办

### 用户侧（等你在场 / 你操作）

1. **吊销 GLM 临时 API key**（`367f40b9…` 开头那个，多次提醒过）；
2. **T1 复核**：真人鼠标点一次确认横幅（虚拟指针等价路径已验证，产品语义需真人过一遍）；
3. **T2 复核**：真人输一次 polkit 密码（ydotool 键盘等价已验证）；
4. **Ghostty**：物理键盘 Super+Return 实按开终端（当时为避免与 M4 ydotool 测试冲突跳过）；
5. **worktree 清理确认**：`../AgentOS-theming`（你的美化分支，已合并）、
   `../AgentOS-pi-research`（研究分支）——确认不用即可删；
6. **M5 镜像点亮**：若子代理无法在 Fusion 全自动建新 VM 启动镜像，需要你建 VM/看屏幕做最终验收。

### 项目侧（下次开发）

- **M5 发行**（子代理已启动，进行中）：x86_64 CI 构建（Tier 1 从未跑过）、
  bootc-image-builder 出 RAW/ISO、从镜像点亮 SDDM+niri、greenboot 自动回滚、
  `os/install.sh` x86_64 真机验证（ADR-0001 挂账）、"30 分钟全新机器到可用对话"退出标准；
- **M2 收尾两项**：artifacts 全类型统一索引（现覆盖 HTML 类）、动作型通知（"查看产物"按钮）；
- **发行决策**：ghostty 是否进 bootc 镜像（现为 alacritty）；COPR `scottames/ghostty`
  供应链是否信任（个人仓库，等官方打包/自建/pin+校验三选一）；
- **等上游**：音频频谱（quickshell 缺 `PwAudioSpectrum`）；换壁纸自动重生成配色
  （需 noctalia CLI/matugen，LanRhyme 的 morandi-gen.py 已入库待接线）；
- **真机方案差异**：测试 VM 的 GDM 自动登录必须去除；chromium 首启双窗口 quirk；
  快照回滚永久化方向指向 bootc（本机 fstab 钉死 `subvol=root`，`set-default` 不生效）。
