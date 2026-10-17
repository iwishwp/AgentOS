#!/usr/bin/env bash
# =============================================================================
# scripts/build-image.sh —— AgentOS bootc 镜像构建入口（M5 Atomic PoC）
#
# 用法：
#   Mac 本机（无 podman）：直接跑，自动 rsync 仓库到 VM 再远程构建
#       ./scripts/build-image.sh [--smoke] [--clean] [--no-cache]
#   VM / 任意有 podman 的 Linux 上：同参数直接构建
#
# 参数：
#   --smoke     构建成功后容器内冒烟（niri/node/rpm 存在性）
#   --clean     冒烟后删除产物镜像与拉取的基础镜像（VM 磁盘 ~10G，勿囤积）
#   --no-cache  podman build --no-cache（调试层缓存问题时用）
#
# 环境变量：
#   AGENTOS_VM          Mac→VM 模式的 ssh 目标（默认 agentos-vm）
#   AGENTOS_BUILD_JOBS 传 1 可限制并发步骤（3.8G 内存的 VM 构建 OOM 时用）
#   GOOSE_INSTALL_MODE  设为 build 则透传给 Containerfile（构建期装 goose，
#                       需构建环境可达 github.com——CI 适用；默认 firstboot）
#   FEDORA_VERSION      基础镜像大版本（默认 44）
#
# x86_64 / CI 说明（本机无 docker/podman，无法交叉验证）：
#   本脚本在 aarch64 VM 上构建 aarch64 镜像（tag: agentos:dev-aarch64）。
#   x86_64 由 CI 承担——GitHub Actions matrix 双架构原生 runner：
#     amd64:  ubuntu-24.04（x86_64 runner，免 QEMU，bootc 镜像含内核，
#             交叉模拟构建 rpm transaction 不可靠，必须原生）
#     arm64:  ubuntu-24.04-arm
#   步骤即本脚本 Linux 分支：checkout → 本脚本 →（可选）bootc-image-builder
#   出可启动 ISO/QEMU 镜像。示例 workflow 见 docs/m5-atomic.md §CI。
#   本地脚本 tag 带架构后缀（dev-aarch64 / dev-x86_64），CI 推 registry 时
#   用 OCI multi-arch manifest（docker buildx 或 podman manifest）。
# =============================================================================
set -euo pipefail

FEDORA_VERSION="${FEDORA_VERSION:-44}"
BASE_IMAGE="quay.io/fedora/fedora-bootc:${FEDORA_VERSION}"
# 拉取韧性设计（实测 VM→quay 曾出现传输停滞：连接活着但 10s 只收 ~200B）：
#   * podman 自带 --retry 3 处理「快速失败」的 blob 错误；
#   * 外层 timeout 兜住「停滞不报错」的挂起（停滞不会触发重试，只会挂死），
#     超时即视为本次失败，进入下一次尝试——已完成的 blob 有本地缓存，续传很快；
#   * 硬阻断（DNS/TLS 立即失败）两次即停，遵守「不设置来路不明代理」纪律。
PULL_ATTEMPTS="${PULL_ATTEMPTS:-3}"
PULL_TIMEOUT="${PULL_TIMEOUT:-2400}"   # 单次 pull 的墙钟上限（秒）

# ---- Mac 分支：同步到 VM 远程执行（Mac 无 podman，构建必须在 VM）----
if [[ "$(uname -s)" == "Darwin" ]]; then
    VM="${AGENTOS_VM:-agentos-vm}"
    REMOTE_DIR="/tmp/agentos-bootc-build"
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    echo "== Mac 检测到：rsync 仓库 → ${VM}:${REMOTE_DIR} =="
    # 排除与 .containerignore 同源的大件；--delete 保证远端与本地一致
    rsync -az --delete \
        --exclude='.git' --exclude='node_modules' --exclude='dist' \
        --exclude='coverage' --exclude='.DS_Store' \
        "${REPO_ROOT}/" "${VM}:${REMOTE_DIR}/"
    echo "== ssh 远程构建（参数透传）=="
    exec ssh "$VM" "cd ${REMOTE_DIR} && ./scripts/build-image.sh $*"
fi

# ---- Linux 分支：真正构建 ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"
IMAGE_TAG="agentos:dev-${ARCH}"

SMOKE=0; CLEAN=0; EXTRA_FLAGS=()
for arg in "$@"; do
  case "$arg" in
    --smoke)    SMOKE=1 ;;
    --clean)    CLEAN=1 ;;
    --no-cache) EXTRA_FLAGS+=(--no-cache) ;;
    *) echo "未知参数: $arg（支持 --smoke / --clean / --no-cache）"; exit 1 ;;
  esac
done

command -v podman >/dev/null 2>&1 || { echo "错误: 未安装 podman"; exit 1; }

# 1) 预拉基础镜像（网络对 quay.io 的可达性提前暴露；停滞超时 → 重试，见顶部说明）
#    本地 store 已有该 tag 时跳过：oci-archive 灌入的镜像没有 registry digest
#    标注，podman pull 不认本地缓存会把整镜像重拉一遍（在本项目 VM 上必然
#    撞 quay 停滞）；podman build 本身会用本地 tag。要强制刷新基座先 rmi 它。
if podman image exists "$BASE_IMAGE" 2>/dev/null; then
    echo "== 本地已有 ${BASE_IMAGE}，跳过预拉（刷新请先 podman rmi）=="
else
    echo "== podman pull ${BASE_IMAGE}（最多 ${PULL_ATTEMPTS} 次，单次上限 ${PULL_TIMEOUT}s）=="
    pulled=0
    for i in $(seq 1 "$PULL_ATTEMPTS"); do
        if timeout "$PULL_TIMEOUT" podman pull --retry 3 "$BASE_IMAGE"; then
            pulled=1; break
        fi
        echo "pull 第 ${i} 次失败（错误或 ${PULL_TIMEOUT}s 停滞超时）$([[ $i -lt $PULL_ATTEMPTS ]] && echo '，15s 后重试（已完成 blob 有缓存）')"
        [[ $i -lt $PULL_ATTEMPTS ]] && sleep 15
    done
    if [[ $pulled -ne 1 ]]; then
        echo "错误: ${BASE_IMAGE} 拉取失败（已尝试 ${PULL_ATTEMPTS} 次）。"
        echo "      本 VM 到 quay.io 网络被阻断——按纪律停止构建，不设代理。"
        echo "      构建验证转交 CI / x86_64 环境（docs/m5-atomic.md §CI）。"
        exit 2
    fi
fi

# 2) 构建（层说明见 os/bootc/Containerfile；内存紧张时 AGENTOS_BUILD_JOBS=1）
echo "== podman build → ${IMAGE_TAG} =="
JOBS_FLAG=()
[[ -n "${AGENTOS_BUILD_JOBS:-}" ]] && JOBS_FLAG=(--jobs "${AGENTOS_BUILD_JOBS}")
podman build "${JOBS_FLAG[@]}" "${EXTRA_FLAGS[@]}" \
    -f os/bootc/Containerfile \
    -t "$IMAGE_TAG" \
    --build-arg "FEDORA_VERSION=${FEDORA_VERSION}" \
    ${GOOSE_INSTALL_MODE:+--build-arg "GOOSE_INSTALL_MODE=${GOOSE_INSTALL_MODE}"} \
    "$REPO_ROOT"

# 3) 产物报告：大小 + 层数（bootc 层 = 更新时的传输/回滚粒度）
echo "== 构建产物 =="
podman images "$IMAGE_TAG" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.Created}}"
LAYER_COUNT="$(podman inspect "$IMAGE_TAG" --format '{{len .RootFS.Layers}}')"
echo "层数: ${LAYER_COUNT}"

# 4) 冒烟（--smoke）：镜像里的关键件存在性——只查版本，不启动会话
if [[ $SMOKE -eq 1 ]]; then
    echo "== 冒烟测试 =="
    podman run --rm "$IMAGE_TAG" sh -c '
        echo "niri:      $(niri --version 2>&1)";
        echo "node:      $(node --version)";
        echo "npm:       $(npm --version)";
        echo "gsr:       $(rpm -q gpu-screen-recorder)";
        echo "sddm:      $(rpm -q sddm)";
        echo "greenboot: $(rpm -q greenboot)";
        echo "canvas:    $(node --check /usr/share/agentos/packages/canvas/dist/index.js && echo syntax-ok)";
        echo "defaults:  $(ls /usr/share/agentos/defaults/niri/)";
        echo "user-units:$(ls /usr/lib/systemd/user/ | grep agentos | tr "\n" " ")";
        echo "gb-checks: $(ls /usr/lib/greenboot/check/required.d/ | tr "\n" " ")";
        # greenboot 检查脚本在容器内直接跑一遍（此时 wants 链接已随 enable 落盘，
        # 两个脚本都应返回 0；真实启动编排属磁盘引导验证，容器内无法覆盖）
        for s in /usr/lib/greenboot/check/required.d/*.sh; do
            "$s" && echo "gb-run:    $s -> 0" || echo "gb-run:    $s -> FAILED($?)";
        done
    '
fi

# 5) 清理（--clean）：VM 磁盘 ~10G，构建验证完即释放
if [[ $CLEAN -eq 1 ]]; then
    echo "== 清理中间镜像 =="
    podman rmi "$IMAGE_TAG" "$BASE_IMAGE" || true
    podman rmi -f "$(podman images -q --filter dangling=true)" 2>/dev/null || true
    echo "剩余镜像："; podman images
fi

echo "== 完成：${IMAGE_TAG} =="
