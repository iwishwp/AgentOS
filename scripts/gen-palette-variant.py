#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-palette-variant.py —— 从暗色规范色板推导浅色变体（保持莫兰迪低饱和气质）

设计目标（docs/theming.md §7 主题同步原则）：
  - surface 系 → 暖白/米灰（#f3f2ec 系），色相继承暗色板、饱和度压住
  - on_*    → 深暖文字（Material 浅色语义：on_primary 这类随主色变白，因为主色已加深）
  - primary/secondary/tertiary → 深一档（对比度），色相不变
  - *_container → 浅色 tint；outline 系 → 中暖灰
  - inverse_* / 终端 16 色 / *_fixed 按 Material 语义换算
  - 输出与输入同构（键集合一致、顺序保留），source_color 不变

推导是**规则驱动**（按暗色值逐键换算），不是硬编码色值——换壁纸重新生成暗色板后
再跑本脚本，浅色板自动跟随同一套规则。

用法：
  gen-palette-variant.py [DARK.json] [LIGHT.json]        # 默认仓内色板 → colors-light.json
"""
import colorsys
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DARK_DEFAULT = REPO / "os/configs/noctalia/lanrhyme/colors.json"
LIGHT_DEFAULT = REPO / "os/configs/noctalia/lanrhyme/colors-light.json"


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def hex_to_hls(s):
    s = s.lstrip("#")
    r, g, b = (int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)  # (H, L, S)，注意 HLS 序


def hls_to_hex(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, clamp(l, 0, 1), clamp(s, 0, 1))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def shift(hexcolor, l=None, s=None, h=None):
    """换算单个颜色：缺省维度继承原值。"""
    H, L, S = hex_to_hls(hexcolor)
    return hls_to_hex(h if h is not None else H,
                      l if l is not None else L,
                      s if s is not None else S)


def blend(a, b, r):
    a, b = a.lstrip("#"), b.lstrip("#")
    m = "".join(f"{round(int(a[i:i+2], 16) * (1 - r) + int(b[i:i+2], 16) * r):02x}"
                for i in (0, 2, 4))
    return f"#{m}"


def derive(dark: dict) -> dict:
    def c(key, fallback):
        v = dark.get(key)
        return v if isinstance(v, str) and v.startswith("#") and len(v) == 7 else fallback

    surface_h = hex_to_hls(c("surface", "#21201c"))[0]     # 暖色相锚点（≈48°）
    out = dict(dark)                                        # 同构：键集合与顺序保留

    # ---- 1) surface 阶梯 → 暖白/米灰（L 阶梯标准 Material 浅色序，S 放大补偿高明度下的视觉衰减）----
    SURFACE_L = {
        "surface": 0.950, "background": 0.950,
        "surface_dim": 0.870, "surface_bright": 0.975,
        "surface_container_lowest": 0.985, "surface_container_low": 0.960,
        "surface_container": 0.925, "surface_container_high": 0.905,
        "surface_container_highest": 0.885,
        "surface_variant": 0.935,
    }
    for k, L in SURFACE_L.items():
        if k in out:
            H, _, S = hex_to_hls(c(k, "#21201c"))
            out[k] = hls_to_hex(H, L, clamp(S * 2.5, 0.14, 0.26))

    # ---- 2) 主文字系 → 深暖 ----
    for k in ("on_surface", "on_background"):
        if k in out:
            H, _, S = hex_to_hls(c(k, "#f3f3f2"))
            out[k] = hls_to_hex(H, 0.145, clamp(S * 1.5, 0.08, 0.18))
    if "on_surface_variant" in out:
        H, _, S = hex_to_hls(c("on_surface_variant", "#b5b4b0"))
        out["on_surface_variant"] = hls_to_hex(H, 0.320, clamp(S * 1.2, 0.08, 0.20))

    # ---- 3) 主色三兄弟 → 深一档（浅底对比度），色相不动、饱和度压 0.9 ----
    for k in ("primary", "secondary", "tertiary"):
        if k in out:
            H, L, S = hex_to_hls(c(k, "#dad8ce"))
            out[k] = hls_to_hex(H, clamp(L - 0.42, 0.36, 0.46), clamp(S * 0.9, 0.12, 0.30))
    out["surface_tint"] = out["primary"]

    # ---- 4) on_<主色> → 近白（主色已加深，Material 浅色语义）----
    for k, fb in (("on_primary", "#22211c"), ("on_secondary", "#22211c"),
                  ("on_tertiary", "#22211c"), ("on_error", "#22211c")):
        if k in out:
            H, _, S = hex_to_hls(c(k, fb))
            out[k] = hls_to_hex(H, 0.980, clamp(S * 0.5, 0.04, 0.15))

    # ---- 5) container 系 → 浅 tint + 深字 ----
    for k in ("primary_container", "secondary_container", "tertiary_container"):
        if k in out:
            H, _, S = hex_to_hls(c(k, "#8d8768"))
            out[k] = hls_to_hex(H, 0.885, clamp(S * 1.6, 0.16, 0.32))
        ok = "on_" + k
        if ok in out:
            H, _, S = hex_to_hls(c(ok, "#000000"))
            out[ok] = hls_to_hex(H, 0.155, clamp(S * 1.4 if S > 0.02 else 0.18, 0.12, 0.30))

    # ---- 6) error 系 → 莫兰迪红（压饱和）----
    H, L, S = hex_to_hls(c("error", "#fd4663"))
    out["error"] = hls_to_hex(H, clamp(L - 0.18, 0.38, 0.50), clamp(S * 0.62, 0.40, 0.70))
    if "on_error" in out:
        out["on_error"] = hls_to_hex(H, 0.98, 0.10)
    if "error_container" in out:
        out["error_container"] = hls_to_hex(H, 0.895, clamp(S * 0.45, 0.28, 0.55))
    if "on_error_container" in out:
        out["on_error_container"] = hls_to_hex(H, 0.16, clamp(S * 0.5, 0.25, 0.50))

    # ---- 7) outline 系 → 中暖灰（描边在浅底上要深于底色）----
    for k, L, fb in (("outline", 0.44, "#6b6a63"), ("outline_variant", 0.63, "#6c6a61")):
        if k in out:
            H, _, S = hex_to_hls(c(k, fb))
            out[k] = hls_to_hex(H, L, clamp(S * 1.2, 0.08, 0.18))

    # ---- 8) inverse 系：浅色板的 inverse = 暗色板对应正色（Material 对偶）----
    if "inverse_surface" in out:
        out["inverse_surface"] = c("surface_variant", "#2c2b26")
    if "inverse_on_surface" in out:
        out["inverse_on_surface"] = c("on_surface", "#f3f3f2")
    if "inverse_primary" in out:
        out["inverse_primary"] = c("primary", "#dad8ce")
    # shadow/scrim 浅色板下仍为深色（投影语义），source_color 不变，*_fixed Material 定义两档共用

    # ---- 9) 终端 16 色：浅底上的中低调（ghostty 桥不读这组，为同构与未来消费者而设）----
    if "terminal_foreground" in out:
        out["terminal_foreground"] = out["on_surface"]
        out["terminal_background"] = out["surface"]
        out["terminal_cursor"] = out["primary"]
        out["terminal_cursor_text"] = out["on_primary"]
        out["terminal_selection_fg"] = out["on_surface"]
        out["terminal_selection_bg"] = out["secondary_container"]
        black = hls_to_hex(surface_h, 0.25, 0.10)
        bright_black = hls_to_hex(surface_h, 0.45, 0.10)
        normal = {
            "black": black, "red": out["error"], "green": out["primary"],
            "yellow": out["secondary"], "blue": shift(c("tertiary_container", "#7f8c69"), l=0.48),
            "magenta": shift(c("primary_fixed_dim", "#c8c5b6"), l=0.45),
            "cyan": out["tertiary"], "white": hls_to_hex(surface_h, 0.93, 0.08),
        }
        bright = {k: (blend(v, "#ffffff", 0.18) if k not in ("black", "white") else v)
                  for k, v in normal.items()}
        bright["black"], bright["white"] = bright_black, hls_to_hex(surface_h, 0.97, 0.05)
        for name, colors in (("normal", normal), ("bright", bright)):
            for cname, val in colors.items():
                out[f"terminal_{name}_{cname}"] = val

    return out


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DARK_DEFAULT
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else LIGHT_DEFAULT
    dark = json.loads(src.read_text())
    light = derive(dark)
    assert set(light) == set(dark), "输出键集合必须与输入同构"
    dst.write_text(json.dumps(light, indent=2, ensure_ascii=False) + "\n")
    print(f"已生成浅色变体 {dst}（{len(light)} 键，同构 ✓）")
    for k in ("surface", "on_surface", "surface_container", "primary", "primary_container",
              "error", "outline_variant"):
        print(f"  {k:26s} {dark.get(k)} → {light[k]}")


if __name__ == "__main__":
    main()
