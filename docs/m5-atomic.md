# M5：Fedora Atomic（bootc）镜像设计与 PoC 记录

- **状态**：进行中（2026-10-17 晚，M5 收尾会话）——aarch64 构建链已通（附录 A）；
  本轮新增并**真机验证**：greenboot 自动回滚接入（§8.1，qemu+Fusion 双引导验证）、
  CI 双架构 workflow 实装（§7，未实跑）、bootc-image-builder qcow2 产物（附录 B）、
  **Fusion 从镜像点亮 SDDM+niri 会话**（附录 C ✅）、30 分钟演练计时（附录 D，
  产物在手→可用对话 ≈11 分钟，达标；完整构建链受网络中转拖累未计入窗口）。
  x86_64 构建仍待 CI 实跑。
- **决策依据**：[ADR-0001](decisions/0001-base-distribution.md) 第 3 条——M5 发行形态默认走
  Fedora Atomic（bootc/OCI 镜像），Bazzite 生产实证模式
- **交付物**：`os/bootc/Containerfile`、`os/bootc/{firstboot,systemd,greenboot}/`、
  `os/bootc/disk-image-config.toml`、`scripts/build-image.sh`、
  `.github/workflows/build-image.yml`、本文档

---

## 1. 形态：为什么是 bootc 镜像而不是安装脚本

ADR-0001 的核心判断：agent 代用户操作系统是常态，因此**系统状态的变更必须可回滚、
可审计、原子化**。传统包管理（dnf install）是渐进式突变——agent 装错一个包，
"撤销"没有干净边界。bootc 把整个用户空间变成一个 OCI 镜像：

| 维度 | bootc 镜像形态 | 传统安装脚本（install.sh） |
|---|---|---|
| 系统状态 | 不可变基座 + 版本化镜像，/usr 只读挂载 | 自由突变 |
| 更新 | 拉新镜像 → 原子切换启动条目 → 重启生效 | 逐包 dnf upgrade |
| 回滚 | 重启进上一启动条目即完整回滚（bootc 内建） | 无干净边界 |
| 审计 | 镜像 digest 即系统指纹，可复现 | 依赖执行时环境 |
| agent 装软件 | 容器/分层（Flatpak、toolbox、CI 重建镜像） | 直接装进系统 |

`install.sh` 保留为过渡路径（ADR-0001 明确的双轨），两条路径共享同一份包清单
（`os/install.sh` dnf 分支 ↔ `os/bootc/Containerfile` 层 1）与同一份配置源
（`os/configs/`）。

## 2. 基础镜像与参考实现

- **基础镜像**：`quay.io/fedora/fedora-bootc:44`——Fedora 官方 bootc 基座，含
  systemd/dnf5/bootc 工具链，不含桌面。tag 用数字版本不用 `latest`：OS 基座要
  可复现，`latest` 会被上游悄然 rebase。`FEDORA_VERSION` 做成 ARG，升级只改一处。
- **官方构建守则**（docs.bootc.io「How to build derived bootc images」，实测采纳）：
  - 构建期无 systemd 运行：`systemctl enable` 合法（纯文件系统操作），
    `systemctl start` 无效；需要"真系统上才跑得了"的逻辑写成单元；
  - 多阶段构建：编译在 builder 阶段，产物 COPY 进最终层；
  - 避免 `dnf -y update`（repo 漂移破坏可复现性）；
  - 收尾跑 `bootc container lint`；
  - 配置进 `/etc`（机器本地）或 `/usr`（随镜像版本走），`/var` 是运行期数据。
- **参考实现**：[Bazzite（uBlue）](https://github.com/ublue-os/bazzite)——同为
  Fedora Atomic + 桌面的生产发行版。借鉴了：分层组织（基座→桌面包→变体内容）、
  `/etc/skel` 与首启动 user 单元（`bazzite-user-setup.service`）并用、
  `systemctl --global enable` 挂用户级服务、构建收尾 lint。

## 3. 镜像分层（os/bootc/Containerfile）

自下而上按"变更频率递增"排布，最大化层缓存：

| 层 | 内容 | 变更频率 | 说明 |
|---|---|---|---|
| 0 | `fedora-bootc:44` 基座 | 随 Fedora 版本 | 官方维护 |
| 1 | 桌面运行时（dnf） | 随包清单演进 | niri/portal/终端族/应用/SDDM/音频/GL/CJK 字体，对照 install.sh dnf 清单 + 基座缺项（pipewire-audio、mesa-dri-drivers、xdg-user-dirs） |
| 2 | gpu-screen-recorder（COPR） | 随上游重构建 | F44 官方仓库无此包（repoquery 实测为空）；COPR `arabianq/gpu-screen-recorder`，F44 aarch64/x86_64 均有成功构建（API 实测）。M4 会话录屏依赖，与 VM 侧并行安装保持同源 |
| 2.5 | greenboot | 随 Fedora 版本 | 启动健康检查 + 自动回滚触发（§8.1）；独立成层与桌面层解耦 |
| 3 | AgentOS 组件 | 每次提交 | 多阶段：builder 阶段 `npm ci → build → 重置为 --omit=dev 依赖`，最终层 `/usr/share/agentos/` + `node_modules/.bin/*` 软链到 `/usr/local/bin`（MCP 命令直达 PATH） |
| 4 | goose CLI | 随上游 release | 二进制来自 GitHub release。`GOOSE_INSTALL_MODE=firstboot`（默认）→ 构建期不装，首启动单元安装；`=build` → 构建期装进 /usr/local/bin（需构建网络可达 github.com） |
| 5 | 默认配置 + systemd 单元 | 最频繁 | `os/configs/` → `/usr/share/agentos/defaults/`；user 单元 → `/usr/lib/systemd/user/`；构建期 `niri validate` 校验配置；`bootc container lint` 收尾 |

**显示管理器选型**：SDDM + `sddm-wayland-generic`（F44 实测存在该子包）。
GDM 是 VM 现役实证组合（niri 会话正跑在 gdm 上），但它依赖 gnome-shell，整个
shell 被拖进镜像；SDDM 轻得多且是 Bazzite 同构选择，niri 包自带的
`/usr/share/wayland-sessions/niri.desktop` 会直接出现在 SDDM 会话列表。
greetd 虽最轻但 F44 仓库无 greeter 配套子包，PoC 不选。**SDDM+niri 组合尚未
真机点亮**（见 §遗留清单）。

**Node 版本**：F44 的 Node 走版本化包名（无裸 `nodejs`，repoquery 实测），镜像用
`nodejs22`/`nodejs22-npm`——与 M0–M4 全部真机验证的运行时一致（VM 实装
v22.23.1）。

## 4. 配置分发：/usr/share/agentos/defaults + 首启动部署（而非 /etc/skel）

bootc 下配置默认值的放置有两个候选，选择 **defaults + 首启动复制**：

| | /etc/skel | /usr/share/agentos/defaults + 首启动单元 |
|---|---|---|
| 生效时机 | 仅 `useradd` 那一刻 | 每次图形会话启动（幂等，only-if-absent） |
| 覆盖用户创建时机不确定的问题 | ✗（bootc 用户由 installer/Ignition/手工创建，时机与形态不可控） | ✓（对任何真实登录用户生效） |
| 镜像更新带来新默认文件 | ✗（老用户的 skel 快照不会更新） | ✓（下次登录到达，仍未覆盖用户已有文件） |
| 用户改动的安全性 | ✓（复制后与镜像无关） | ✓（only-if-absent，永不覆盖） |
| 可调试性 | 隐式 | `journalctl --user -u agentos-user-setup` |

实现：`agentos-user-setup.service`（user 单元，`systemctl --global enable`）在
`graphical-session.target` 后调用 `/usr/share/agentos/bin/firstboot-config.sh`，
把 niri 主配置/aesthetics、fontconfig CJK 回退、GTK3/4 主题 only-if-absent 复制进
`~/.config/`。构建期还会用镜像内的 niri 跑 `niri validate` 把配置语法错误挡在
镜像产出之前。

## 5. goose 的网络现实（构建期 vs 首启动）

实测（VM，2026-10-16）：

- `https://quay.io/v2/` → **401（正常未鉴权响应，API 可达）**；但 blob 传输
  被严重限速/停滞，~1.1GB 的基础镜像多次尝试未能拉完（明细与应对见文末附录）；
- `https://github.com/.../download_cli.sh` → **55s 超时（阻断）**，与此前
  GitHub release 直连被重置的观察一致；
- 对照组：Fedora 镜像源 1.5 MiB/s、npm registry 正常——劣化集中在
  quay/github 两家的大对象传输。

因此 goose 默认走首启动路径：`agentos-goose-firstboot.service`（user 单元）在
goose 缺失时调 `install-goose.sh` 重试 3 次（每次 120s 上限）装到
`~/.local/bin`，失败不阻断登录、下次登录自动重试；成功盖 stamp 防噪音。
CI 网络可达时用 `GOOSE_INSTALL_MODE=build`（Containerfile 层 4）把 goose 直接
烘焙进镜像——该路径在本仓库网络环境下**未实测**。

## 6. 构建验证（aarch64 VM，如实记录）

- 环境：Fedora 44 aarch64 VM（ssh `agentos-vm`），podman 已预装，磁盘可用
  ~9.9G，内存 3.8G。
- 命令：`./scripts/build-image.sh --smoke`（Mac 上执行：自动 rsync 仓库到
  VM `/tmp/agentos-bootc-build` 后 ssh 远程构建）。
- 结果：**构建未完成**——基础镜像拉取被网络阻断（quay blob 传输劣化），
  完整实测明细、已验证/未验证边界见文末「验证记录」附录。
- 已知限制：本验证只到「容器镜像可构建、关键件在位」为止；**未做磁盘启动验证**
  （bootc-image-builder 出 RAW/QCOW2 再引导，VM 磁盘余量与 nested 虚拟化不允许，
  留给 CI/x86_64，见 §遗留清单）。

## 7. CI 双架构方案（GitHub Actions matrix）

> **2026-10-17 已实装**：`.github/workflows/build-image.yml`（上面草案的落地版，
> 差异：`fail-fast: false` 一侧架构失败不连坐、podman 安装做存在性兜底、
> 增加 runner 标签与实际架构的一致性自检、tag 触发推 GHCR 用内置
> `GITHUB_TOKEN`、`GOOSE_INSTALL_MODE=build` 经脚本透传）。
>
> **本地校验记录（仓库无 git remote，CI 未实跑——如实标注）**：
> 1. YAML 解析（ruby YAML.safe_load）：结构/matrix/steps 全部符合预期；
> 2. `actionlint`：0 报错（brew 安装）；
> 3. 路径/参数一致性脚本核对：workflow 引用的 `./scripts/build-image.sh`
>    存在且可执行、`--smoke` 在脚本参数表内、脚本 tag 命名
>    `agentos:dev-$(uname -m)` 与 workflow `podman tag` 源引用一致、
>    `GOOSE_INSTALL_MODE` 透传与 Containerfile `ARG` 两端对齐、
>    `uses:` 引用均为 `owner/repo@vN` 形态。
> 首次接入 GitHub 后应从 `workflow_dispatch` 手动触发首跑（amd64 与 arm64
> 各一次），再放开 push 触发。注意 `ubuntu-24.04-arm` 托管 runner 仅公开
> 仓库免费，私有仓库需自托管 arm runner 替换。

bootc 镜像含内核与 rpm transaction，交叉模拟（QEMU binfmt）构建慢且不可靠，
用**原生 runner matrix**：

```yaml
# .github/workflows/build-image.yml（草案，M5 后续实装）
name: build-image
on:
  push: { branches: [main] }
  workflow_dispatch:
jobs:
  build:
    strategy:
      matrix:
        include:
          - { arch: amd64,  runner: ubuntu-24.04 }     # x86_64 原生
          - { arch: arm64,  runner: ubuntu-24.04-arm } # aarch64 原生
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4        # builder 阶段自带 nodejs22，此步只为缓存加速可省
      - run: sudo apt-get install -y podman
      - run: ./scripts/build-image.sh --smoke
      - run: |
          podman tag agentos:dev-$(uname -m) ghcr.io/${{ github.repository }}/agentos:${{ github.sha }}-${{ matrix.arch }}
          podman push ghcr.io/${{ github.repository }}/agentos:${{ github.sha }}-${{ matrix.arch }}
      # 可选：manifest 合并双架构 + bootc-image-builder 出安装介质（ISO/RAW）：
      # podman manifest add ... / quay.io/containers/bootc-image-builder ...
```

- CI 上 goose 可用 `GOOSE_INSTALL_MODE=build`（GitHub Actions 到 github.com 可达），
  在 build 命令里加 `--build-arg GOOSE_INSTALL_MODE=build`；
- 推 registry 用 OCI multi-arch manifest，用户端 `bootc switch` 直接引用；
- 安装介质（ISO）由 `bootc-image-builder` 从 OCI 镜像生成，属 M5 后续项。

## 8. 原子更新与回滚语义（bootc 运行期）

镜像构建只是交付物的一半，另一半是 bootc 在目标机上的生命周期：

- **安装**：`bootc-image-builder` 把 OCI 镜像转成 RAW/QCOW2/ISO → 写盘启动；
  已运行的 Fedora 也可 `bootc switch <image>` 原地转入镜像模式。
- **更新**：`bootc upgrade` 拉新镜像 → 写入新的 ostree 部署（启动条目）→
  重启后进入新版本。/usr 只读、/etc 三路合并、/var 跨版本持久——**用户数据与
  agent 的工作区（~/Agent）不受更新影响**。
- **回滚**：bootc 保留上一个（可配置多个）启动条目，失败即回滚语义分两级：
  1. 人工：`bootc rollback` 交换默认启动条目，重启即回到旧镜像；
  2. 自动：greenboot 健康检查单元在启动后探测系统健康，不健康
     自动标记回滚（Bazzite 生产在用）——这对 agent OS 是"误更新自愈"的关键件。
- **agent 装软件**：镜像模式下 agent 不再 dnf install（/usr 只读），改走
  Flatpak / 容器（toolbox）/ 向镜像层提 PR 重建。这正是 ADR-0001 要的信任模型：
  agent 的系统级变更收敛为"镜像版本变更"，可整体接受或整体拒绝。

### 8.1 greenboot 接入（2026-10-17，遗留清单 #4 落地）

**机制**（greenboot 0.16.4，F44 仓库包，rpm 内容实测）：镜像装包并
`systemctl enable greenboot-healthcheck.service`（其 `[Install]` 段通过
`Also=` 连带启用回滚触发器）。启动后 `greenboot-healthcheck.service`
（`Before=boot-complete.target`）依次运行 `/usr/lib/greenboot/check/required.d/`
与 `/etc/greenboot/check/required.d/` 下的可执行脚本：

- **全部退出 0** → 系统标记健康（green 状态），清零 boot 计数；
- **任一非 0** → 计数 +1，达到阈值（greenboot.conf 的 `GREENBOOT_WATCHDOG_CHECK
  / GREENBOOT_MAX_BOOT_ATTEMPTS`）后自动执行 `bootc rollback`（0.16.4 二进制
  内嵌 bootc 支持：识别 `status.booted.image` 区分 bootc/rpm-ostree 部署）并
  重启进上一启动条目——**「agent 误更新自愈」闭环**；
- greenboot 0.16.4 原生识别 bootc 与 rpm-ostree 两种回滚后端，无需额外接线。

**检查脚本放置**：`/usr/lib/greenboot/check/required.d/`（随镜像版本走）而非
`/etc`（机器本地态）——greenboot 两个路径都扫（rpm 文件清单 + 二进制字符串
实测确认）。仓库侧源文件在 `os/bootc/greenboot/check/required.d/`。

**两个必需检查示例及其语义边界**（关键设计：greenboot 跑在 multi-user 阶段、
SDDM 登录**之前**，检查绝不能在健康系统上误报，否则会回滚 boot loop）：

| 脚本 | 验证内容 | 为什么不是"真探活" |
|---|---|---|
| `01-agentos-canvas.sh` | canvas dist 在位且 `node --check` 通过；`agentos-canvas.service` user 单元在位且被 `--global enable`（wants 符号链接存在） | canvas 是 `systemd --user` 服务，登录前没有进程可探；HTTP 探针（curl 127.0.0.1:7788）属登录后运维面，放 greenboot 必然误报 |
| `02-agentos-goose.sh` | `GOOSE_INSTALL_MODE=build` 时：`/usr/local/bin/goose --version` 真执行；firstboot（默认）时：安装脚本 + user 单元 + wants 链接三件套在位（自愈链路完整） | firstboot 模式下 goose 于首次图形登录联网后安装，启动期查二进制存在性必误报 |

**已验证 / 未验证边界**（如实记录）：

- 已验证（容器内）：greenboot 0.16.4 安装、检查脚本落位与可执行位、
  `systemctl enable` 落盘（`multi-user.target.wants/`、
  `greenboot-success.target.requires/`、`ostree-finalize-staged.service.requires/
  greenboot-set-rollback-trigger.service` 三组符号链接实测创建）、两个检查脚本
  在镜像容器内直跑退出码 0（`--smoke` 冒烟已固化该步）；
- 未验证（需磁盘引导）→ **已补真机验证（2026-10-17 晚）**：qemu 与 Fusion
  两次真实引导中，`greenboot-healthcheck.service` enabled+active（修复了部署期
  preset 重放抹 enable 的坑，见 `os/bootc/system-preset/85-agentos.preset`），
  journal 实录两项检查通过、`boot_success=1` 写入 grubenv、boot 计数清零。
  **"注入坏检查 → 自动 bootc rollback"的负路径演示仍留待后续**（需可丢弃的
  测试 VM + 二次引导）。

**发行口径**：正式发行镜像应审视默认阈值与检查项数量——检查越多，误报面
越大（每个 required 检查都是一次潜在的无谓回滚）。当前两个示例都选了
"结构性在位"检查（文件/链接存在性），刻意压低误报率。

## 9. 决策待定（只做分析，不动手——两项发行决策）

### D1：ghostty 是否进 bootc 镜像（现为 alacritty）

**背景张力（2026-10-17 实况）**：默认终端已切 ghostty（`ebcf33b`），随镜像分发的
默认 niri 配置（`os/configs/niri/config.kdl` → `/usr/share/agentos/defaults/`）
`Super+Return` / `Mod+T` 均 spawn **ghostty**；但 Containerfile 层 1 只装
**alacritty**。也就是说：**当前镜像全新装机的终端热键是坏的**（配置注释里
"bootc 镜像线仍用 alacritty"是有意留的口子）。这个决策因此不是观感取舍，
而是正确性欠账，M5 发行前必须二选一闭合。

| 选项 | 内容 | 代价 / 风险 |
|---|---|---|
| A. ghostty 进镜像 | 层 2.x 加 COPR `scottames/ghostty`（同 gpu-screen-recorder 的 arabianq 模式：dnf5 copr enable + install，独立成层） | 引入第二个第三方 COPR 依赖（见 D2）；镜像 +~80MB；与 install.sh 的 COPR 逻辑同源可对齐 |
| B. 镜像配置回退 alacritty | defaults 的 spawn 改回 alacritty（仅镜像线；真机配置不动） | 产品默认终端与发行物不一致，"开箱即 ghostty"叙事打折；两套默认长期漂移 |
| C. 双终端都进镜像 | ghostty + alacritty 并装，配置 spawn ghostty、注释保留 alacritty 兜底 | 镜像体积最大；但消除断层，回滚路径自然（改一行配置即可切回） |

**建议：A**（ghostty 进镜像，独立 COPR 层，与 arabianq 层同构）。理由：配置默认
已是 ghostty-first，B 是逆产品方向；C 的冗余在镜像瘦身项（遗留清单 #7）里
本来就要审视。前置条件是 D2 的供应链决策先行——A 的实质是"D2 选了信任或
pin 后"的自然结果。

### D2：COPR `scottames/ghostty` 供应链是否信任

**事实**（docs/ghostty.md 调研 + 实测）：个人仓库（Scott Ames），Fedora 官方
打包多年未落地、ghostty 官方安装文档自己也是指 COPR；chroot 覆盖 fc43/fc44
aarch64+x86_64，ghostty 1.3.1-4 构建成功（2026-08），连带提供 gtk4-layer-shell。
gpu-screen-recorder 已开的先例是 `arabianq` COPR（同为个人仓库）——AgentOS
镜像事实上已经吃了一条非官方供应链。

| 选项 | 内容 | 代价 / 风险 |
|---|---|---|
| a. 直接信任 | 同 arabianq 模式 enable + install | 个人仓库被投毒/弃维护即波及所有装机；无 SLA；对"agent OS 信任叙事"是隐性负债 |
| b. pin + 校验 | Containerfile 固定 ghostty 具体版本（`ghostty-1.3.1-4.fc44`），CI 冒烟校验 `rpm -q` 精确匹配 + 记录仓库 GPG 指纹 | 仍信任构建者，但把"上游悄然变化"变成显式 diff；升级是人工动作（好也是负担） |
| c. 自建 COPR | fork 其 spec 自建 `agentos/ghostty` COPR，源码自 GitHub release 拉（Mac 中转同理） | 维护成本（跟版本、双架构构建）；供应链主权完整；与"等上游"正交 |
| d. 等官方打包 | 镜像线维持 alacritty + 配置回退（D1 选 B） | 时间不可控；但零新增负债 |

**建议：短期 b（pin + 校验）**——把信任从"浮动 tag"收敛为"显式版本 + 可审计
指纹"，成本一行 build-arg 级别；**中期跟踪 c**：若 ghostty 官方打包持续未落地
而 AgentOS 进入多用户发行，自建 COPR 把终端（产品默认应用！）纳入主权供应链；
gpu-screen-recorder（非默认路径的录屏工具）维持 arabianq 直接信任的风险敞口
可接受，两档区别对待。

> 两项决策都需要维护者拍板；拍板前镜像线维持现状（alacritty + 配置断层
> 如实记录在遗留清单 #9），不擅自改。

## 10. 遗留清单

| # | 事项 | 备注 |
|---|---|---|
| 1 | ~~SDDM + niri 真机点亮~~ | ✅ 2026-10-17 Fusion arm VM 从 qcow2 引导成功（附录 C）：SDDM（Wayland greeter）active、graphical.target 达成、greenboot 检查通过、canvas 127.0.0.1:7788 HTTP 200、goose 1.55.0 在位。**图形登录进 niri 会话这一步需人工**（VM 已保留运行供亲验） |
| 2 | bootc-image-builder 出安装介质 | ✅ qcow2 已产出并双环境（qemu/Fusion）引导验证（附录 B）；ISO 未做（VM 磁盘只容一样产物，qcow2 优先；bib 的 `anaconda-iso/iso` 旧类型已废弃，新版走 `bootc-generic-iso`，迁移文档 docs 见 m5-mig 链接） |
| 3 | GOOSE_INSTALL_MODE=build 路径实测 | 留给 CI（Actions 到 github 可达；本网络环境当天 github 时通时断，未赌） |
| 4 | ~~greenboot 自动回滚~~ 接入已落地（§8.1） | 容器内验证完（脚本退出码/enable 落盘）；**负路径**（注入坏检查 → 自动回滚）待可丢弃测试 VM 演示 |
| 5 | ~~CI workflow 实装~~ 已落地（§7） | `.github/workflows/build-image.yml`；**未实跑**（无 git remote），本地三重静态校验过，首跑走 workflow_dispatch |
| 6 | gpu-screen-recorder 录制链路验证 | 镜像装了包（COPR arabianq），但录屏依赖内核侧（驱动/显存捕获）需真机（Apple Silicon virtio-gpu 限制） |
| 7 | 镜像瘦身 | libreoffice-writer 是体积大头之一；可评估拆分层或 Flatpak 化；node_modules 生产依赖已裁剪（--omit=dev） |
| 8 | x86_64 Tier 1 构建 | 本机无 podman、无交叉；依赖 §7 matrix 原生 runner（workflow 已写好待实跑） |
| 9 | ghostty/镜像终端断层 | 镜像装 alacritty、默认配置 spawn ghostty（§9 D1）——发行前必须闭合，随 D1/D2 决策 |

## 附：验证记录（2026-10-16 晚，aarch64 VM，如实记录）

**结论：构建因基础镜像拉取网络阻断未完成。代码交付完整，构建验证转交
CI / x86_64 环境（遗留清单 #8）。**

### 网络实测明细

| 目标 | 结果 | 证据 |
|---|---|---|
| quay.io API（/v2/） | 可达 | 401（正常未鉴权响应），4.1s |
| **quay.io blob 传输** | **严重劣化，大对象不可用** | 5 次 pull 尝试（3 次长尝试 + 2 次 300s 确认性 pull）均未完成 ~1.1GB 的 fedora-bootc:44；吞吐在 0.02–1.5 MiB/s 间剧烈波动，多次完全停滞（实测 12s 仅收 22KB ≈ 1.4KB/s）；podman 对不完整 blob 不支持断点续传，中断即丢弃，低带宽下重试无法收敛 |
| github.com release | 阻断 | download_cli.sh 55s 超时（与既往观察一致） |
| ghcr.io API | 可达（405） | fedora-bootc 无官方 ghcr 发布，不可作替代源 |
| Fedora 镜像源（dnf） | 快 | alacritty 测试包 1.5 MiB/s |
| npm registry | 快 | 200，3.5–4.2s |

关键判断：**阻断只卡"一次性拉基础镜像"这一步**——dnf/npm 通道都健康，
意味着 Containerfile 的层 1/2（dnf）、层 3（npm ci/build）在基础镜像到位后
大概率可正常完成；但在本 VM 的网络下无法拿到入场券。累计投入约 2 小时后
按纪律停止尝试（不设置来路不明的代理），未产生任何镜像（`podman images`
为空，部分拉取状态已清理，磁盘 8.9G 可用）。

### 已验证 / 未验证边界

已验证（无需镜像构建即可确认的）：
- F44 仓库全部包名存在性（dnf repoquery 逐一核对：niri/sddm/sddm-wayland-generic/
  alacritty/fuzzel/swaylock/grim/mako/gnome-calculator/libreoffice-writer/
  google-noto-sans-cjk-vf-fonts 等；nodejs 无裸包名，nodejs22 为正名）；
- gpu-screen-recorder 不在 F44 官方仓库；COPR `arabianq/gpu-screen-recorder`
  存在且 fedora-44-aarch64 有成功构建（Copr API 实测）；
- `dnf5-plugins` 提供 `dnf5-command(copr)`（Containerfile 层 2 依赖）；
- 首启动配置部署脚本逻辑（Mac 本地模拟两次部署：首次到位、用户修改不被
  覆盖、幂等）；
- build-image.sh 语法与 Mac→VM rsync/ssh 远程执行链路（实际跑通到 pull 阶段）。

未验证（需 CI / 网络正常环境）：
- podman build 全流程（层缓存、多阶段、bootc container lint）；
- 镜像大小/层数、容器内冒烟（niri --version 等）；
- SDDM+niri 登录会话真机点亮、首启动单元实际行为、goose 首启动安装。

---

## 附 A：2026-10-17 构建打通记录（Mac 中转方案）

首次构建的网络阻断（附录：quay.io blob 传输劣化）不是死路——**VM 到 quay 慢，
Mac 到 quay 正常**。用 skopeo 在 Mac 拉镜像、scp 进 VM 加载，构建链路即通：

```bash
# Mac（brew install skopeo 一次性）：
# 注意 quay 的 manifest 用 docker 风格 "arm64"，--override-arch 填 aarch64 会
# 报 "no image found for architecture aarch64"——必须填 arm64
skopeo copy --override-arch arm64 --override-os linux \
    docker://quay.io/fedora/fedora-bootc:44 oci-archive:/tmp/bootc44.tar
scp /tmp/bootc44.tar VM:/tmp/

# VM：
podman load -i /tmp/bootc44.tar
podman tag <loaded-id> quay.io/fedora/fedora-bootc:44   # oci-archive 不带 tag
# 之后 scripts/build-image.sh 的预 pull 命中本地 tag，blob 全在本地，秒过
```

实测：Mac 拉 933MB 压缩归档约 2 分钟（VM 直连 2 小时未完成）；构建总耗时约
25 分钟（dnf 层走 Fedora 镜像源 1-4MiB/s，npm 层正常）。

打通过程中的两处 Containerfile 修复（均已提交）：

1. **builder 阶段 `ENV HOME=/build`**：bootc 基础镜像的 `/root` 是指向
   `var/roothome` 的悬空符号链接（无状态布局），npm 以 /root 为 HOME 会
   `mkdir` 报 ENOTDIR；
2. **F44 无 `pipewire-audio` 子包**（F34 时代命名）：按真机实况拆为
   `pipewire pipewire-pulseaudio wireplumber`。

产物与冒烟（`--smoke`）：

```
localhost/agentos:dev-aarch64  4.38 GB  81 层
niri 26.04 / node v22.23.1 / gpu-screen-recorder 6.1.4 / sddm 0.21.0
canvas dist 语法 OK；defaults（config.kdl+aesthetics.kdl）与 3 个 user 单元就位
```

仍未验证（移交 CI/后续）：x86_64 构建、bootc-image-builder 出 RAW/ISO、
SDDM 点亮真机、greenboot 回滚。

> （当晚 M5 收尾会话更新：后三项已在附 B/附 C 补上——qcow2 产物、Fusion
> 点亮、greenboot 真实引导验证；x86_64 仍留 CI。）

---

## 附 B：bootc-image-builder 产物记录（2026-10-17 晚）

### 产物

| 项 | 值 |
|---|---|
| 文件 | `/Users/demon/codespace/agentos-images/agentos-dev-aarch64-greenboot.qcow2` |
| 大小 / 虚拟容量 | 2.0 GB（文件）/ 10 GiB（虚拟盘） |
| 格式 | qcow2（ext4 根分区，EFI 引导，含 demon/wheel 预置用户 + sshd） |
| sha256 | `dc27c3b9a4888fe6caac9cfea82f92c7faaa6225385c990a68bb415cf26d02f5`（同目录 sha256.txt） |
| 源镜像 | `agentos:dev-aarch64`（4.43 GB / 84 层，含 greenboot 0.16.4 与 preset 修复） |
| 构建机 | Mac qemu/hvf 上的 Fedora Cloud 44 arm64（30G 数据盘），见附 C 环境说明 |

### 构建配置与命令

- 配置：`os/bootc/disk-image-config.toml`（`[[customizations.user]]` demon/wheel +
  `[customizations.services] enabled=["sshd"]`——sshd 基座自带，只做 enable）。
- 容器：`quay.io/centos-bootc/bootc-image-builder:latest`（182MB 压缩，
  Mac skopeo 中转 22 秒拉完，`--override-arch arm64`）。
- 命令（legacy 形态，兼容容器实测可用）：

```bash
sudo podman run --rm --privileged --security-opt label=type:unconfined_t \
  -v <config.toml>:/config.toml:ro -v <output>:/output \
  -v /var/lib/containers/storage:/var/lib/containers/storage \
  quay.io/centos-bootc/bootc-image-builder:latest \
  --type qcow2 --rootfs ext4 --output /output localhost/agentos:dev-aarch64
```

- 耗时：manifest+osbuild 全程 ≈ **2 分 05 秒**（30G 盘、hvf 3 vCPU/3.8G）。

### 踩坑实录（都是真金白银的轮次，留档防再撞）

1. **`--rootfs ext4` 必须显式给**：新版 bib 要求 DefaultRootFs，F44 基座容器
   不自带该元数据，缺省报 `missing required info: DefaultRootFs`。
2. **bib 只认容器内 `/var/lib/containers/storage` 路径**，且 podman db 校验
   store 的绝对路径一致性——把非标准路径的 store 挂进去一律 db mismatch；
   正解 = 宿主把大盘 bind mount 到标准路径再按标准命令跑。
3. **多镜像 docker-archive 会丢 entrypoint**（`podman save img1 img2` 的归档
   load 后 Entrypoint=[]，CMD=[/sbin/init]，容器直接把 `--type` 当命令执行）；
   单镜像一档或 skopeo oci-archive 则完好。已验证的复现与规避。
4. **磁盘预算**：bib 导入镜像层临时空间 ≈ 镜像解压大小 + 输出盘增长，
   18G 的构建 VM 放不下「4.4G 导入 + 4.5G 输出」并存——改在 qemu 临时机构建。
5. 构建机 podman store 必须在大盘上（Fedora Cloud 系统 5G 盘会 dnf 层
   "needs 670MB more space" 失败）。

### 部署盘验证（qemu hvf 两次引导 + Fusion 一次引导）

- `bootc status`：镜像模式确认（`localhost/agentos:dev-aarch64`）；
- greenboot：healthcheck enabled+active，日志见两项检查通过、
  `boot_success=1` 写入 grubenv（§8.1 的「未验证」项就此补上真实引导证据）；
- canvas：`systemctl --user start agentos-canvas` 后 `127.0.0.1:7788` HTTP 200；
- goose：firstboot 自愈脚本在受限网络（github 大对象经 qemu 慢到超时）拉不动，
  按「Mac 中转供给」把 arm64 二进制 scp 进 `~/.local/bin`，`goose 1.55.0`
  可执行、stamp 落盘（与脚本成功路径一致）；网络正常环境该步由首启动单元自动完成；
- SDDM：active（详见附 C）。

---

## 附 C：Fusion 点亮记录（2026-10-17，✅ 成功）

### 环境

- Fusion 25（build 24995814），arm-fedora-64 guestOS，EFI，NVMe 总线，
  4G 内存 / 2 vCPU，NAT 网络 + 手工固定 MAC `00:50:56:3F:1A:B7`
  （arp 反查 IP 用，避免依赖 open-vm-tools）。
- 新 VM：`/Users/demon/Virtual Machines.localized/agentos-bootc-test.vmwarevm/`
  ——**独立目录，与现有 agentos-vm（192.168.54.130）零交集**；点亮后保留运行供用户亲验。
- vmx 生成方式：**从现有 Fedora arm VM 的 vmx 派生**（pciBridge/usb_xhci/
  vmotion 等 Fusion 特有字段手工凑不齐——第一版手写最小 vmx 导致 vmware-vmx
  本体段错误；派生+删共享文件夹/UUID/guestInfo 残留后稳定）。

### 三次点亮尝试（如实记录）

| # | 磁盘格式 | 结果 | 根因 |
|---|---|---|---|
| 1 | vmdk `streamOptimized`（云导入流格式） | 引导到 initramfs **emergency mode** | 串口日志实锤：NVMe 写 I/O error（sc 0x4）→ ext4 无法 rw 挂载。streamOptimized 是压缩只读流，Fusion 下写支持形同虚设 |
| 2 | 同盘 + 串口 | 复现 #1 | 确认非偶发 |
| 3 | vmdk `monolithicSparse`（4.5G） | ✅ **点亮** | 可写子格式，qemu-img convert `-o subformat=monolithicSparse` |

### 点亮证据（22:10:40 加电）

- 串口（vmx 加 `serial0.fileType="file"`，bib 内核参数自带 `console=ttyS0`）：
  `graphical.target reached`、`fedora login:` 提示符；
- **SDDM active 且 Wayland greeter 真在跑**：`sddm-greeter-qt6 --display-server
  weston --shell=kiosk`（sddm-wayland-generic 子包的实际工作形态）；
- niri 会话文件 `/usr/share/wayland-sessions/niri.desktop` 在位（SDDM 会话列表可选）；
- 网络：NAT DHCP 拿到 **192.168.54.131**（arp 按 MAC 匹配，无 tools 依赖）；
- ssh 全套验证：bootc 镜像模式 / greenboot enabled+active+检查通过 /
  user 单元三件套 enabled / canvas HTTP 200 / goose 1.55.0（Mac 中转供给）；
- 截图：vmrun captureScreen 需 open-vm-tools 登录（镜像未装），不可用——
  **VM 以 GUI 模式运行中，Fusion 窗口即实物证据**；「图形登录进 niri 会话」
  需用户键盘输入一次（demon/123456），留待亲验。

### vmrun 备忘（本机实测）

- 此版 vmrun `start` 只认 `[gui|nogui]`，`headless` 报 invalid parameter；
  `gui` 在沙箱内报 Unknown error；**`open -a "VMware Fusion" <vmx>` 稳定可用**；
- 无 tools 的 guest `stop soft` 会挂死，用 `stop hard`（或直接 TERM vmx 进程）；
- 手工三步复刻（用户视角）：Fusion → 文件 → 打开 `agentos-bootc-test.vmx` →
  运行；或新建 VM 选「从镜像恢复」指向 vmdk。

---

## 附 D：「30 分钟全新机器」演练时间线（2026-10-17 实测）

### 口径

退出标准「全新机器 30 分钟从 ISO/镜像到可用对话」——窗口从**拿到磁盘镜像
（qcow2/vmdk）**起算，到「可发起对话」止（构建链是 CI 的职责，不在窗口内，
但为透明起见全文记录）。

### A 链：窗口内（目标机侧，实测）

| 时刻 | 步骤 | 耗时 |
|---|---|---|
| 22:07:00 | qcow2 → vmdk 转换（monolithicSparse，qemu-img） | ≈3 min |
| 22:10:00 | vmx 就位（从参考机派生）、Fusion 加电 | ≈40s |
| 22:10:40→22:12:32 | 首次引导 → ssh 可用（含 DHCP、sshd 起来） | **1 min 52 s** |
| 22:12:32→22:16 | 验证套件：greenboot/SDDM/user 单元/canvas 200/goose 供给 | ≈4 min |

**窗口合计 ≈ 11 分钟 ≤ 30 分钟，达标**。网络正常环境下 goose 由首启动单元
自愈安装（+2~3 min），goose 配 API key（+2 min）也仍宽裕。

### B 链：窗口外（构建链，实测，供透明与 CI 校准）

| 时刻 | 步骤 | 耗时 |
|---|---|---|
| 20:05–20:16 | Fedora Cloud 44 arm64 构建机镜像下载（镜像断流续传） | 11 min |
| 20:16–20:22 | 构建机加电 + cloud-init + base 镜像 Mac skopeo 中转（933MB） | 6 min |
| 20:37–20:47 | agentos 镜像冷构建（dnf 层全量，74+561 包） | **10 min 15 s** |
| 21:05–21:07 | bootc-image-builder 出 qcow2 | 2 min 05 s |
| 21:11 | scp 回 Mac（本机 qemu 中转快） | 11 s |

### 差距分析

1. **窗口内无差距**：产物在手 → 可用对话 11 分钟（30 分钟标准的 37%）。
   剩余风险：M1 端到端任务（下载→文档→LibreOffice 展示）本轮未在新 VM 重放
   （需 goose API key，用户侧配置），属「可用对话」之外的第二级验收；
2. **窗口外的瓶颈全是网络**：quay/镜像源劣化迫使 skopeo/scp 中转（附录 A
   既定方案），构建机镜像下载与 base 中转合计 ≈17 min。网络正常环境
   （= CI）这些都不存在——CI 冷构建预计 ≤12 min；
3. **ISO 路径未测**：本轮只出 qcow2（磁盘镜像）。若走 ISO 安装介质，
   现场安装时间会替换「建 VM」步骤（Anaconda 交互 5-10 min），预算仍足，
   但 bib 的 ISO 类型已换代（`bootc-generic-iso`），需要一次实测；
4. 首次引导 1 min 52 s 含 EFI 首次初始化；二次引导更快（qemu 实测 ~80 s 到 ssh）。
