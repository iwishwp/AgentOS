#!/usr/bin/env bash
# =============================================================================
# scripts/theme-noctalia.sh —— 状态栏（Noctalia v4.7.1）真正吃上系统莫兰迪色板
#
# 历史坑（2026-10-18 像素采样实锤）：Noctalia v4.7.1 的 Color.qml JsonAdapter 只认
# **m 驼峰键**（mPrimary/mSurfaceVariant…，见 Assets/Templates/noctalia.json），
# 而 LanRhyme 色板是 Material 蛇形键（primary/surface_container…，v5 格式）——
# 键名对不上 → 全部回落内置海军蓝默认（#070722 系）。此前"莫兰迪已生效"是
# 视觉模型把默认黄 #fff59b 误判成暖米色的假阳性。
#
# 本脚本：以蛇形 Material 色板为规范源，按官方模板映射生成 m 驼峰键，与蛇形键
# **合并在同一个 colors.json**（我们的 mako/fuzzel/hotkeys/orb 读蛇形键，
# Noctalia 读 m 驼峰键，互不干扰）。Noctalia 若自行重写该文件会丢蛇形键——
# 各读取方都有同值兜底，重跑本脚本即恢复。
#
# 键映射（对照 Assets/Templates/noctalia.json）：mSurfaceVariant←surface_container、
# mOutline←outline_variant、mHover←tertiary、mOnHover←on_tertiary、mShadow←shadow。
# =============================================================================
set -euo pipefail

SRC="${AGENTOS_COLORS_JSON:-$HOME/.config/noctalia/lanrhyme-palette.json}"
OUT="${AGENTOS_NOCTALIA_COLORS:-$HOME/.config/noctalia/colors.json}"

python3 - "$SRC" "$OUT" <<'PY'
import json, sys, pathlib

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))

def c(key, fallback):
    v = d.get(key)
    return v if isinstance(v, str) and v.startswith("#") else fallback

# 官方模板键 → Material 蛇形键（fallback 为实测过的莫兰迪同值）
M = {
    "mPrimary":        ("primary",                  "#dad8ce"),
    "mOnPrimary":      ("on_primary",               "#22211c"),
    "mSecondary":      ("secondary",                "#d8d9cf"),
    "mOnSecondary":    ("on_secondary",             "#22211c"),
    "mTertiary":       ("tertiary",                 "#d5d8d0"),
    "mOnTertiary":     ("on_tertiary",              "#22211c"),
    "mError":          ("error",                    "#fd4663"),
    "mOnError":        ("on_error",                 "#22211c"),
    "mSurface":        ("surface",                  "#21201c"),
    "mOnSurface":      ("on_surface",               "#f3f3f2"),
    "mSurfaceVariant": ("surface_container",        "#37362f"),   # 模板：← container
    "mOnSurfaceVariant": ("on_surface_variant",     "#b5b4b0"),
    "mOutline":        ("outline_variant",          "#6c6a61"),   # 模板：← variant
    "mShadow":         ("shadow",                   "#21201c"),
    "mHover":          ("tertiary",                 "#d5d8d0"),   # 模板：← tertiary
    "mOnHover":        ("on_tertiary",              "#22211c"),
}

merged = dict(d)  # 保留全部蛇形键（我们的消费方在读）
for mk, (sk, fb) in M.items():
    merged[mk] = c(sk, fb)

pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
json.dump(merged, open(out, "w"), indent=2, ensure_ascii=False)
print(f"已写 {out}（蛇形 {len(d)} 键 + m 驼峰 {len(M)} 键）")
PY
echo "重启 Noctalia 生效：pkill -f '[q]s -c noctalia' 后会话 env 重启"
