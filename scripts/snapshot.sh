#!/usr/bin/env bash
# AgentOS 系统快照钩子：agent 做系统级变更（dnf 安装、改系统配置……）前先 create 一个
# btrfs 快照，出问题可回滚——"撤销 agent 的操作"。底层是 snapper（root 配置，手动触发，无定时）。
#
# 用法:
#   scripts/snapshot.sh create <描述>        # 创建只读快照，描述自动加前缀 agentos-pre-
#   scripts/snapshot.sh create               # 描述缺省为 manual
#   scripts/snapshot.sh list                 # 列出快照（root 配置）
#   scripts/snapshot.sh delete <编号>        # 删除指定快照
#   scripts/snapshot.sh rollback <编号>      # 打印回滚步骤（不直接执行，需重启）
#
# 策略见 os/snapper/README.md：agent 系统级变更前必须先 create。
set -euo pipefail

CONFIG="${SNAPPER_CONFIG:-root}"

usage() {
  cat <<'EOF'
用法:
  snapshot.sh create [描述]     创建只读快照（描述自动加前缀 agentos-pre-，缺省 manual）
  snapshot.sh list [--desc]     列出快照；--desc 只看 agentos-pre-* 条目
  snapshot.sh delete <编号>     删除指定快照
  snapshot.sh rollback <编号>   打印回滚步骤（不直接执行，含重启说明）
环境变量: SNAPPER_CONFIG（默认 root）
EOF
  exit "${1:-0}"
}
die() { echo "错误: $*" >&2; exit 1; }

# snapper 对 root 配置需要 root 权限（经 snapperd/dbus）；非交互环境由调用方保证 sudo 可用
SN="sudo snapper -c $CONFIG"

# 输出 snapper list 的 JSON（失败则报错退出，不让空输入流进 python）
snap_json() {
  local out
  if ! out=$(sudo snapper --jsonout -c "$CONFIG" list 2>/dev/null) || [ -z "$out" ]; then
    die "无法读取快照列表（sudo 权限或 snapper 配置 $CONFIG 的问题）"
  fi
  printf '%s' "$out"
}

# 公共解析: JSON 顶层是 {配置名: [快照...]}
read_snapshots() {  # stdin=json → stdout=每行 "编号|日期|描述"
  CONFIG_NAME="$CONFIG" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
snaps = d.get(os.environ["CONFIG_NAME"]) if isinstance(d, dict) else d
for s in snaps or []:
    print(s["number"], s.get("date",""), s.get("description",""), sep="|")'
}

case "${1:-help}" in
  create)
    DESC="${2:-manual}"
    shift $(( $# > 1 ? 2 : 1 ))
    [ $# -eq 0 ] || die "create 只接受一个描述参数"
    NUM=$($SN create --read-only -p -d "agentos-pre-${DESC}") \
      || die "快照创建失败（snapper 配置 $CONFIG 存在吗？见 os/snapper/README.md）"
    echo "已创建快照 #${NUM}（agentos-pre-${DESC}）"
    echo "回滚参考: $0 rollback $NUM"
    ;;

  list)
    shift
    if [ $# -gt 0 ]; then
      case "$1" in
        --desc) snap_json | read_snapshots | grep "agentos-pre-" || echo "（暂无 agentos-pre-* 快照）" ;;
        *) die "list 可选参数: --desc（只看 agentos 快照）" ;;
      esac
    else
      $SN list
    fi
    ;;

  delete)
    N="${2:?用法: $0 delete <编号>}"
    $SN delete "$N" && echo "已删除快照 #$N"
    ;;

  rollback)
    N="${2:-}"; [ -n "$N" ] || die "用法: $0 rollback <编号>"
    # 读取该快照的描述与时间做核对（read_snapshots 输出为 "编号|日期|描述"）
    INFO=$(snap_json | read_snapshots | awk -F"|" -v n="$N" '$1 == n {print $2, $3}')
    [ -n "$INFO" ] || die "快照 #$N 不存在（$0 list 查看）"
    SNAP_PATH="/.snapshots/$N/snapshot"
    cat <<EOF
回滚目标: 快照 #${N}（${INFO}）

本机布局: / 挂载 subvol=root（fstab 明确指定），snapper 的 set-default 式回滚不生效，
需按以下步骤手动执行（含重启，/home 子卷不受影响，用户数据不动）:

  0. 保底: 先创建当前状态快照（在出问题前留退路）:
       $0 create rollback-fallback
  1. 若快照为只读（本脚本创建的都是只读），先转可写:
       sudo btrfs property set -ts $SNAP_PATH ro false
  2. 重启进入 GRUB → 选中内核条目按 e → 在 linux 行把
       rootflags=subvol=root
     改为
       rootflags=subvol=$SNAP_PATH
     Ctrl+X 启动——系统即以该快照为根运行（此时是回滚态的临时验证）。
  3. 验证无误后永久化（在快照系统中执行）:
       sudo mount -o subvolid=5 /dev/nvme0n1p3 /mnt   # 挂 btrfs 顶级（设备名按实际）
       sudo btrfs subvolume delete /mnt/root           # 删除旧 root 子卷
       sudo btrfs subvolume snapshot /mnt$SNAP_PATH /mnt/root   # 快照提升为新 root
       sudo umount /mnt && sudo reboot
     fstab 仍写 subvol=root，无需改动——指向的子卷已是快照内容。

提示: 第 2 步即可当作"临时回滚验证"使用；不执行第 3 步则重启后仍回旧状态。
EOF
    ;;

  help|-h|--help) usage ;;

  *) die "未知子命令 '${1:-}'（可用: create/list/delete/rollback）" ;;
esac
