#!/usr/bin/env bash
# =============================================================================
# scripts/theme-ghostty.sh —— 终端（Ghostty）莫兰迪配色，与系统色板同源
#
# 原则（docs/theming.md §7）：一切第一方可主题界面读同一份 Material 蛇形色板
# （colors.json，换壁纸重生成后全系统跟随）；第三方应用尽力而为。
# 替换 Ghostty 原 Catppuccin Frappé（保留注释可回切），写入 BEGIN/END 标记块，
# 重复执行幂等（先删旧块再写新块）。
# =============================================================================
set -euo pipefail

SRC="${AGENTOS_COLORS_JSON:-$HOME/.config/noctalia/lanrhyme-palette.json}"
OUT="${GHOSTTY_CONFIG:-$HOME/.config/ghostty/config}"

python3 - "$SRC" "$OUT" <<'PY'
import sys, re, pathlib

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src)) if (json := __import__("json")) else {}
def c(k, fb):
    v = d.get(k)
    return v if isinstance(v, str) and v.startswith("#") else fb

def blend(a, b, r):
    a = a.lstrip("#"); b = b.lstrip("#")
    m = "".join(f"{round(int(a[i:i+2],16)*(1-r)+int(b[i:i+2],16)*r):02x}" for i in (0,2,4))
    return f"#{m}"

# 基准（LanRhyme 莫兰迪实测值兜底）
SURFACE = c("surface", "#21201c")
ON      = c("on_surface", "#f3f3f2")
HIGH    = c("surface_container_highest", "#3d3b34")
ERR     = c("error", "#fd4663")
SAGE    = c("tertiary_container", "#7f8c69")
OLIVE   = c("secondary_container", "#898d68")
WARM    = c("primary_container", "#8d8768")
PRIM    = c("primary", "#dad8ce")
TER     = c("tertiary", "#d5d8d0")
SEC     = c("secondary", "#d8d9cf")
OUTL    = c("outline_variant", "#6c6a61")

palette = [
    ("0", SURFACE), ("8", HIGH),                          # 黑/亮黑
    ("1", ERR),     ("9", blend(ERR, ON, 0.30)),          # 红
    ("2", SAGE),    ("10", blend(SAGE, ON, 0.30)),        # 绿
    ("3", OLIVE),   ("11", blend(OLIVE, ON, 0.30)),       # 黄
    ("4", WARM),    ("12", blend(WARM, ON, 0.30)),        # 蓝(暖灰调)
    ("5", blend(ERR, TER, 0.45)), ("13", blend(blend(ERR, TER, 0.45), ON, 0.30)),  # 品红
    ("6", TER),     ("14", blend(TER, ON, 0.30)),         # 青(灰绿)
    ("7", SEC),     ("15", ON),                           # 白/亮白
]

block = ["# ===== BEGIN agentos-morandi（scripts/theme-ghostty.sh 生成，勿手改） ====="]
block.append(f"background = {SURFACE}")
block.append(f"foreground = {ON}")
block.append(f"cursor-color = {PRIM}")
block.append(f"selection-background = {HIGH}")
block.append(f"selection-foreground = {ON}")
for n, col in palette:
    block.append(f"palette = {n}={col}")
block.append("# ===== END agentos-morandi =====")

p = pathlib.Path(out)
text = p.read_text() if p.exists() else ""
# 幂等：去掉旧标记块
text = re.sub(r"# ===== BEGIN agentos-morandi.*?# ===== END agentos-morandi =====\n?", "", text, flags=re.S)
# 注释掉内置主题行（避免与显式 palette 冲突的可读性困惑）
text = re.sub(r"^(theme\s*=.*)$", r"# [agentos-morandi 已接管] \1", text, flags=re.M)
text = text.rstrip("\n") + "\n\n" + "\n".join(block) + "\n"
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(text)
print(f"已写 {out}（16 色莫兰迪 + 背景/前景/光标/选区）")
PY
echo "对已开的 ghostty 窗口不生效，新开窗口即用新配色"
