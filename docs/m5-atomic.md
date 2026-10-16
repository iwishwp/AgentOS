# M5：Fedora Atomic（bootc）镜像设计与 PoC 记录

- **状态**：PoC 代码交付完成；VM 构建验证因网络阻断未完成（§6 + 附录），
  转交 CI / x86_64 环境
- **决策依据**：[ADR-0001](decisions/0001-base-distribution.md) 第 3 条——M5 发行形态默认走
  Fedora Atomic（bootc/OCI 镜像），Bazzite 生产实证模式
- **交付物**：`os/bootc/Containerfile`、`os/bootc/{firstboot,systemd}/`、
  `scripts/build-image.sh`、本文档

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
  2. 自动（后续项）：greenboot 健康检查单元在启动后探测系统健康，不健康
     自动标记回滚（Bazzite 生产在用）——这对 agent OS 是"误更新自愈"的关键件。
- **agent 装软件**：镜像模式下 agent 不再 dnf install（/usr 只读），改走
  Flatpak / 容器（toolbox）/ 向镜像层提 PR 重建。这正是 ADR-0001 要的信任模型：
  agent 的系统级变更收敛为"镜像版本变更"，可整体接受或整体拒绝。

## 9. 遗留清单

| # | 事项 | 备注 |
|---|---|---|
| 1 | SDDM + niri 真机点亮 | 镜像里 DM 选了 SDDM（轻），但 VM 现役实证是 GDM；需要 bootc-image-builder 出盘引导验证登录→会话 |
| 2 | bootc-image-builder 出安装介质（ISO/RAW） | 磁盘启动验证（本轮未做，VM 磁盘/嵌套虚拟化受限）；含首启动单元、SDDM、goose 安装的端到端 |
| 3 | GOOSE_INSTALL_MODE=build 路径实测 | 本网络环境 github.com 阻断，留给 CI（Actions 到 github 可达） |
| 4 | greenboot 自动回滚 | "agent 误更新自愈"的最后一环，参照 Bazzite 配置 |
| 5 | CI workflow 实装 | §7 是草案；含 multi-arch manifest 合并与 GHCR 推送 |
| 6 | gpu-screen-recorder 录制链路验证 | 镜像装了包（COPR arabianq），但录屏依赖内核侧（驱动/显存捕获）需真机（Apple Silicon virtio-gpu 限制） |
| 7 | 镜像瘦身 | libreoffice-writer 是体积大头之一；可评估拆分层或 Flatpak 化；node_modules 生产依赖已裁剪（--omit=dev） |
| 8 | x86_64 Tier 1 构建 | 本机无 podman、无交叉；依赖 §7 matrix 原生 runner |

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
