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

# 变体检测（同 theme-gtk.sh：按 surface 明度）——极性必须随变体翻转，
# 否则浅色档的"亮色槽"（7/15）与浅色 container（本为背景色）在浅底上不可读
def lum(hexc):
    h = hexc.lstrip("#")
    return (0.299*int(h[0:2],16) + 0.587*int(h[2:4],16) + 0.114*int(h[4:6],16)) / 255
LIGHT = lum(SURFACE) > 0.5

if LIGHT:
    # 浅色档：背景压一档（surface_container 比纯 surface 深一点，久看不刺眼）；
    # ANSI 前景全部向深色（on_surface）调和——container 系原生是浅色背景色，直接用会看不清
    BG  = c("surface_container", "#f0efe8")
    FG  = ON
    SELBG = c("surface_container_highest", "#e5e4da")
    dark = lambda base, r=0.45: blend(base, ON, r)   # 向深字色调和出可读的深色 accent
    palette = [
        ("0", BG),          ("8", blend(BG, ON, 0.22)),           # 黑槽=底/深灰
        ("1", dark(ERR)),   ("9", dark(ERR, 0.60)),
        ("2", dark(SAGE)),  ("10", dark(SAGE, 0.60)),
        ("3", dark(OLIVE)), ("11", dark(OLIVE, 0.60)),
        ("4", dark(WARM)),  ("12", dark(WARM, 0.60)),
        ("5", dark(blend(ERR, TER, 0.45))), ("13", dark(blend(ERR, TER, 0.45), 0.60)),
        ("6", dark(TER)),   ("14", dark(TER, 0.60)),
        ("7", blend(ON, SURFACE, 0.30)), ("15", ON),              # 白槽=深灰/最深字色
    ]
else:
    BG, FG, SELBG = SURFACE, ON, HIGH
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
block.append(f"background = {BG}")
block.append(f"foreground = {FG}")
block.append(f"cursor-color = {PRIM if not LIGHT else c('on_surface', ON)}")
block.append(f"selection-background = {SELBG}")
block.append(f"selection-foreground = {FG}")
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
