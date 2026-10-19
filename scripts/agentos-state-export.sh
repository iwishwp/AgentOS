#!/usr/bin/env bash
# AgentOS 状态导出（多机器迁移上半程）：把散在 ~ 下的 AgentOS 配置打包成一个 tar.gz。
# 配对脚本：agentos-state-import.sh（only-if-absent 导入，绝不覆盖目标机已有文件）。
#
# 用法:
#   scripts/agentos-state-export.sh                    # 导出 ~/Agent/agentos-state-<主机名>-<时间戳>.tar.gz
#   scripts/agentos-state-export.sh --with-secrets     # goose.env 明文密钥一并打包（见下）
#   scripts/agentos-state-export.sh -o /path/to.tar.gz # 指定产物路径
#
# 明文密钥约定（docs/migration.md）：
#   默认**排除** goose.env 明文——包里只有键名模板（值替换为 <REDACTED...>），在新机器上
#   需手动填回。--with-secrets 才携带明文（包内权限 600，包文件本身也 600），只应经加密
#   通道传输；keyring 里的凭据（Secret Service）永不入包——它们按引用寻址，靠目标机
#   重新注册（scripts/cred-store.sh），这正是"引用而非明文"设计的目的。
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  agentos-state-export.sh [--with-secrets] [-o <输出.tar.gz>]
      --with-secrets    goose.env 明文密钥入包（默认只导键名模板，值脱敏）
      -o, --output      产物路径（默认 ~/Agent/agentos-state-<主机名>-<时间戳>.tar.gz）
打包内容（存在的才收，缺失的记入 MANIFEST 的 missing 段）:
      ~/.config/agentos/settings-state.json   主题状态快照
      ~/.config/agentos/policy.yaml           工具权限策略
      ~/.config/agentos/credentials.yaml      凭据策略（只有引用与白名单，无值）
      ~/.config/agentos/goose.env[.example]   模型密钥（默认脱敏模板）
      ~/.config/niri/config.kdl               窗口管理器配置
      ~/.config/noctalia/lanrhyme-palette*.json  色板（暗/浅）
      ~/.config/goose/config.yaml             goose 扩展配置
EOF
  exit "${1:-0}"
}

WITH_SECRETS=0
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-secrets) WITH_SECRETS=1 ;;
    -o|--output) OUT="${2:?-o 需要路径参数}"; shift ;;
    -h|--help|help) usage ;;
    *) echo "未知参数: $1" >&2; usage 2 ;;
  esac
  shift
done

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/agentos-state"
mkdir -p "$PKG"

INCLUDED=()
MISSING=()

collect() {  # collect <home 相对路径>
  local rel="$1"
  if [ -f "$HOME/$rel" ]; then
    mkdir -p "$PKG/$(dirname "$rel")"
    cp -p "$HOME/$rel" "$PKG/$rel"
    INCLUDED+=("$rel")
  else
    MISSING+=("$rel")
  fi
}

collect .config/agentos/settings-state.json
collect .config/agentos/policy.yaml
collect .config/agentos/credentials.yaml
collect .config/niri/config.kdl
collect .config/noctalia/lanrhyme-palette.json
collect .config/noctalia/lanrhyme-palette-light.json
collect .config/goose/config.yaml

# goose.env：默认只导键名模板；--with-secrets 才带明文（600）
SECRETS_MODE="absent"
GOOSE_ENV="$HOME/.config/agentos/goose.env"
if [ -f "$GOOSE_ENV" ]; then
  mkdir -p "$PKG/.config/agentos"
  if [ "$WITH_SECRETS" -eq 1 ]; then
    cp -p "$GOOSE_ENV" "$PKG/.config/agentos/goose.env"
    chmod 600 "$PKG/.config/agentos/goose.env"
    SECRETS_MODE="cleartext"
    INCLUDED+=(".config/agentos/goose.env (明文)")
  else
    sed -E 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1=<REDACTED: 明文未导出，请在新机器手动填入>/' \
      "$GOOSE_ENV" > "$PKG/.config/agentos/goose.env"
    chmod 600 "$PKG/.config/agentos/goose.env"
    SECRETS_MODE="redacted"
    INCLUDED+=(".config/agentos/goose.env (脱敏模板)")
  fi
else
  MISSING+=(".config/agentos/goose.env")
fi

HOST_S=$(hostname -s 2>/dev/null || echo host)
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="${OUT:-$HOME/Agent/agentos-state-${HOST_S}-${STAMP}.tar.gz}"
mkdir -p "$(dirname "$OUT")"

{
  echo "AgentOS 状态包 ${OUT##*/}"
  echo "  导出时间 : $(date '+%Y-%m-%d %H:%M:%S%z')"
  echo "  来源主机 : $(hostname)（用户 $(whoami)）"
  echo "  密钥模式 : ${SECRETS_MODE}（cleartext=含 goose.env 明文 / redacted=仅键名模板 / absent=无该文件）"
  echo
  echo "[included]"
  printf '  %s\n' "${INCLUDED[@]}"
  if [ ${#MISSING[@]} -gt 0 ]; then
    echo "[missing]（本机没有，导入时跳过）"
    printf '  %s\n' "${MISSING[@]}"
  fi
  echo
  echo "导入（目标机，only-if-absent，绝不覆盖已有文件）:"
  echo "  ~/AgentOS/scripts/agentos-state-import.sh $OUT"
  echo "说明: keyring 凭据不随包走——用 scripts/cred-store.sh 按引用重新注册（明文永不出本机 keyring）。"
} > "$PKG/MANIFEST.txt"

tar -czf "$OUT" -C "$STAGE" agentos-state
chmod 600 "$OUT"

echo "已打包 ${#INCLUDED[@]} 个文件 → $OUT"
[ "$SECRETS_MODE" = "cleartext" ] && echo "警告: 包内含 goose.env 明文密钥（--with-secrets），请经加密通道传输并在导入后删除。" >&2
# 机器可读行（canvas /api/settings/migrate/export 解析）
echo "EXPORTED_PATH=$OUT"
