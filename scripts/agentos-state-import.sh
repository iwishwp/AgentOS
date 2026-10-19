#!/usr/bin/env bash
# AgentOS 状态导入（多机器迁移下半程）：解包 agentos-state-export.sh 的产物并落位。
#
# 语义（与导出脚本配对，见 docs/migration.md）：
#   only-if-absent——目标文件已存在一律**不覆盖**，只进差异报告：
#     内容相同 → "已存在且相同"（无需动作）
#     内容不同 → "已存在且不同"（保留本机版本 + 给出 diff 摘要；要覆盖请手动对比后自己来）
#   缺失的文件 → 安装（保留包内权限，goose.env 600）。
#
# 用法:
#   scripts/agentos-state-import.sh <agentos-state-*.tar.gz> [--apply]
#       默认 dry-run：只打印差异报告，不动任何文件
#       --apply      真正执行（仍只写"缺失"文件，已有的照旧不碰）
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  agentos-state-import.sh <agentos-state-*.tar.gz> [--apply]
      默认 dry-run：只出差异报告，不写任何文件
      --apply      执行导入（only-if-absent：已存在文件一律不覆盖）
导入后建议:
      systemctl --user restart agentos-settings   # 主题状态/色板变了的话
      ~/.config/agentos/goose.env 需手动填入明文（导出包默认只带键名模板）
EOF
  exit "${1:-0}"
}

die() { echo "错误: $*" >&2; exit 1; }

ARCHIVE=""
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help|help) usage ;;
    *) [ -z "$ARCHIVE" ] && ARCHIVE="$1" || die "一次只导一个包（'$1' 多余）" ;;
  esac
  shift
done
[ -n "$ARCHIVE" ] || usage 2
[ -f "$ARCHIVE" ] || die "找不到 $ARCHIVE"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
PKG="$STAGE/agentos-state"
[ -d "$PKG" ] || PKG="$STAGE"   # 兼容不带顶层目录的包

MODE="[dry-run]"
[ "$APPLY" -eq 1 ] && MODE="[apply]"

# 读包内 MANIFEST 的密钥模式，导入明文时再警告一次
SECRETS_NOTE=""
if [ -f "$PKG/MANIFEST.txt" ]; then
  if grep -q "密钥模式 : cleartext" "$PKG/MANIFEST.txt"; then
    SECRETS_NOTE="（注意：包内含 goose.env 明文密钥，导入后建议尽快改用目标机自己的密钥）"
  fi
fi

INSTALLED=0; KEPT_SAME=0; KEPT_DIFF=0

import_one() {  # <包内文件> <home 相对路径>
  local f="$1" rel="$2" target="$HOME/$2"
  if [ -e "$target" ]; then
    if cmp -s "$f" "$target"; then
      KEPT_SAME=$((KEPT_SAME+1))
      echo "  = $rel 已存在且相同（跳过）"
    else
      KEPT_DIFF=$((KEPT_DIFF+1))
      echo "  ≠ $rel 已存在且不同（保留本机版本，不覆盖）差异摘要:"
      diff -u "$target" "$f" 2>/dev/null | sed 's/^/      /' | head -n 14 | sed 's/^      /    /'
    fi
  else
    if [ "$APPLY" -eq 1 ]; then
      mkdir -p "$(dirname "$target")"
      cp -p "$f" "$target"        # -p 保留包内权限（goose.env 为 600）
    fi
    INSTALLED=$((INSTALLED+1))
    echo "  + $rel ← 安装$([ "$APPLY" -eq 0 ] && echo '（dry-run，实际未写）')"
  fi
}

echo "AgentOS 状态导入 $MODE  ← ${ARCHIVE##*/} $SECRETS_NOTE"
while IFS= read -r -d '' f; do
  rel="${f#"$PKG"/}"
  [ "$rel" = "MANIFEST.txt" ] && continue   # 清单是给人看的，不落位
  import_one "$f" "$rel"
done < <(find "$PKG" -type f ! -name '.*' -print0 | sort -z)

echo
if [ "$APPLY" -eq 1 ]; then
  echo "完成：安装 $INSTALLED · 保留(相同) $KEPT_SAME · 保留(不同) $KEPT_DIFF"
  [ "$INSTALLED" -gt 0 ] && echo "提示: 若导入了 settings-state/色板，跑 systemctl --user restart agentos-settings 让 daemon 重读。"
  echo "提示: goose.env 若为 <REDACTED> 模板，记得手动填入明文（chmod 600）。"
else
  echo "dry-run：将安装 $INSTALLED · 已存在(相同) $KEPT_SAME · 已存在(不同) $KEPT_DIFF"
  echo "确认无误后加 --apply 执行。"
fi
