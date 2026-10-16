# snapper — 系统快照与回滚（M4 "撤销 agent 的操作"）

> 状态：已在测试 VM（Fedora 44 aarch64，btrfs）配置并实测（2026-10-17）。
> 配套脚本：`scripts/snapshot.sh`（create/list/delete/rollback）。

## 1. 策略

**agent 做任何系统级变更之前，必须先创建一个 `agentos-pre-*` 快照。**

- "系统级变更" = dnf 安装/卸载、改 `/etc`、systemd 系统级单元、内核/驱动操作；
- 用户级内容（`~` 下的工作区、配置）不在快照范围——`/home` 是独立子卷，回滚系统不动用户数据，
  这本身就是一条安全边界：**撤销 agent 的操作 ≠ 撤销用户的工作**；
- 快照为**只读**（审计价值：事后可精确查看"变更前系统长什么样"）；
- **不做自动定时快照**（timeline/boot 定时器全部禁用）：快照只在 agent 变更前或用户手动触发，
  避免无意义快照吃满磁盘，也让"哪些变更前打了快照"成为可审计的行为。

## 2. 测试 VM 上的实际配置（Fedora 44 布局记录）

磁盘布局（`findmnt` / `btrfs subvolume list /`）：

```text
/dev/nvme0n1p3  btrfs（compress=zstd:1）
├── subvol root → /            （ID 256，顶级子卷）
│   └── var/lib/machines       （ID 258）
├── subvol home → /home        （ID 257，独立子卷）
└── .snapshots                 （snapper 创建，ID 259）
```

配置步骤（等价命令，已在 VM 逐条执行）：

```bash
sudo dnf install -y snapper                 # 0.13.0-3.fc44
sudo snapper create-config -f btrfs /       # 生成 /etc/snapper/configs/root + /.snapshots 子卷
sudo systemctl disable --now snapper-timeline.timer   # 装完默认 enabled，必须关（自动快照源头）
sudo systemctl disable --now snapper-cleanup.timer    # 默认已 disabled，双保险
sudo systemctl disable --now snapper-boot.timer       # 默认已 disabled，双保险
sudo sed -i 's/^TIMELINE_CREATE=.*/TIMELINE_CREATE="no"/' /etc/snapper/configs/root
```

关键取舍：

| 决定 | 原因 |
|---|---|
| 只配 root（`/`），不配 /home | 策略见上：回滚系统不碰用户数据 |
| `TIMELINE_CREATE=no` + 三个 timer 全 disable | 任务要求"仅手动/钩子触发"；即使 timer 被误开，配置层也不产生 timeline 快照 |
| 快照只读（`--read-only`） | 不可变审计记录；回滚流程里再按需转可写 |
| `NUMBER_LIMIT=50` 保留默认 | 手动触发模式下到不了这个量级；后续接 cleanup 钩子再调 |

## 3. 用法与实测（VM，2026-10-17）

```text
$ scripts/snapshot.sh create test
已创建快照 #1（agentos-pre-test）
$ scripts/snapshot.sh list
1 │ single │ 2026-10-16 21:33:28 │ root │ │ agentos-pre-test
$ scripts/snapshot.sh list --desc
1|2026-10-16 21:33:28|agentos-pre-test
$ scripts/snapshot.sh rollback 1        # 只打印步骤，不执行（见 §4）
$ scripts/snapshot.sh delete 1
已删除快照 #1                            # list 只剩 current；/.snapshots/ 无残留
```

实测结论：

- create → list → delete 全链路通过，`btrfs subvolume list /` 确认快照子卷随 delete 完全清理；
- 快照目录权限 `dr-xr-xr-x`（只读属性生效）；
- rollback 子命令按设计**只打印人工步骤**，不执行任何破坏性操作；
- 注意：sudo 无 tty（如裸 SSH）时 snapper 需要的权限拿不到——agent 场景经带凭证的通道执行，
  或配置 polkit 规则放行 `snapper` 的 dbus 调用（与权限分级 v1 衔接，见 docs/permissions.md）。

## 4. 回滚流程（Fedora 经典布局的特别说明）

snapper 官方的 `snapper rollback` 依赖 `btrfs subvolume set-default`，但**本布局不生效**：
fstab 明确写了 `subvol=root`，引导时强制挂载该子卷，default 标志被绕过。因此
`snapshot.sh rollback <N>` 打印的是针对本布局验证过的手动流程（脚本内有完整版）：

1. （保底）`snapshot.sh create rollback-fallback`；
2. 只读快照转可写：`btrfs property set -ts /.snapshots/N/snapshot ro false`；
3. 重启进 GRUB 编辑内核行，`rootflags=subvol=root` 改 `rootflags=subvol=/.snapshots/N/snapshot`
   ——临时以快照为根启动验证；
4. 确认后永久化：挂顶级子卷 → 删旧 root → 快照提升为新 root → 重启（fstab 不用改）。

`/home` 全程不受影响。

## 5. 与 agent 的集成（后续）

- system-mcp 将增加"包变更前自动打快照"的封装（create → dnf → 失败时提示 rollback 编号）；
- 权限分级 v1 落地后，"强确认档"的系统变更（如 dnf install）批准路径里串联 snapshot create
  （见 docs/permissions.md §polkit）；
- 快照编号与审计日志（policy audit.jsonl）对齐：变更事件的 detail 里记录快照号。
