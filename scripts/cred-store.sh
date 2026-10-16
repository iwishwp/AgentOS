#!/usr/bin/env bash
# 注册一条 AgentOS 凭据：从 stdin 读入明文，存入 Secret Service 并写入策略文件。
#
# 用法:
#   printf '我的密码' | scripts/cred-store.sh vault://组/名 "显示标签" curl git
#   # 参数: <引用> [标签] [允许的命令...]（至少一个，逗号也可）
set -euo pipefail

REF="${1:?用法: cred-store.sh <vault://组/名> [标签] [允许命令...]}"
LABEL="${2:-AgentOS credential}"
shift 2 2>/dev/null || shift $# # 至少保留引用

if [[ ! "$REF" =~ ^vault://[a-zA-Z0-9._/-]+$ ]]; then
  echo "引用格式应为 vault://组/名" >&2
  exit 1
fi
if [[ $# -eq 0 ]]; then
  echo "至少指定一个 exec_allow 命令（如 curl git）" >&2
  exit 1
fi

# 存入 Secret Service（键属性 agentos-ref=<引用>）
secret-tool store --label="$LABEL" agentos-ref "$REF"

# 追加策略条目（幂等：先删同引用行块不做了，v0 用追加，重复条目以首个为准时提示）
POLICY="$HOME/.config/agentos/credentials.yaml"
mkdir -p "$(dirname "$POLICY")"
touch "$POLICY"
if grep -q "^  ${REF}:" "$POLICY"; then
  echo "策略文件已存在 ${REF} 条目，未重复写入（如需修改请编辑 $POLICY）"
else
  ALLOW="$(printf '"%s", ' "$@")"; ALLOW="${ALLOW%, }"
  if ! grep -q "^credentials:" "$POLICY"; then
    echo "credentials:" >> "$POLICY"
  fi
  {
    echo "  ${REF}:"
    echo "    label: \"${LABEL}\""
    echo "    exec_allow: [${ALLOW}]"
  } >> "$POLICY"
fi

echo "已注册 ${REF}（exec_allow: $*；注入环境变量默认 AGENTOS_SECRET，可在 $POLICY 配置 env 字段）"
