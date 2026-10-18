/**
 * palette.ts —— 色板单一模块：读色板 / hex 工具 / blend / 变体检测 / 双键映射 / 8 位色
 *
 * 收编自四个 shell 桥里重复的 python heredoc（theme-{noctalia,mako,fuzzel,ghostty}.sh
 * + theme-gtk.sh），逻辑逐条照搬、不自创行为：
 *   - pick()        ≡ 各桥的 `def c(key, fallback)`（# 开头才认，否则兜底）
 *   - blend()       ≡ theme-ghostty.sh 的线性逐通道插值
 *   - luma()        ≡ theme-ghostty.sh 的加权明度（0.299/0.587/0.114）
 *   - hlsLightness()≡ theme-gtk.sh 的 colorsys HLS L（(max+min)/2）
 *   - dualKeyMerge()≡ theme-noctalia.sh 的蛇形+驼峰双键合并（v4.7.1 只认 m 驼峰键）
 *   - toRgba8()     ≡ theme-fuzzel.sh 的 #RRGGBBAA（fuzzel 不收 6 位）
 */
import { readFile } from "node:fs/promises";

export type Palette = Record<string, string>;
export type Variant = "dark" | "light";

/** 色板缺失/损坏时各桥走内置兜底（lanrhyme 暗色实测值）——返回空对象 */
export async function loadPalette(path: string): Promise<Palette> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Palette;
  } catch {
    return {};
  }
}

export function pick(palette: Palette, key: string, fallback: string): string {
  const v = palette[key];
  return typeof v === "string" && v.startsWith("#") ? v : fallback;
}

/** python round() 的银行家舍入（half-to-even）——对拍旧脚本逐字节一致所必需 */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1; // 恰好 .5：取偶（python 语义，JS Math.round 会向上）
}

/** 线性逐通道插值（theme-ghostty.sh 同式）：blend(a,b,r) = a*(1-r)+b*r */
export function blend(a: string, b: string, r: number): string {
  const ca = a.replace("#", "");
  const cb = b.replace("#", "");
  let out = "";
  for (const i of [0, 2, 4]) {
    const va = parseInt(ca.slice(i, i + 2), 16);
    const vb = parseInt(cb.slice(i, i + 2), 16);
    out += pyRound(va * (1 - r) + vb * r)
      .toString(16)
      .padStart(2, "0");
  }
  return `#${out}`;
}

/** 加权明度（theme-ghostty.sh 的 lum()） */
export function luma(hex: string): number {
  const h = hex.replace("#", "");
  return (
    (0.299 * parseInt(h.slice(0, 2), 16) +
      0.587 * parseInt(h.slice(2, 4), 16) +
      0.114 * parseInt(h.slice(4, 6), 16)) /
    255
  );
}

/** HLS 明度（theme-gtk.sh 的 colorsys.rgb_to_hls(...)[1] = (max+min)/2） */
export function hlsLightness(hex: string): number {
  const h = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  if (rgb.length < 3) return 0;
  const max = Math.max(rgb[0]!, rgb[1]!, rgb[2]!);
  const min = Math.min(rgb[0]!, rgb[1]!, rgb[2]!);
  return (max + min) / 2;
}

/** ghostty 桥的变体检测：surface 加权明度 > 0.5 → 浅 */
export function isLightGhostty(palette: Palette): boolean {
  return luma(pick(palette, "surface", "#21201c")) > 0.5;
}

/** gtk 桥/编排器的变体检测：surface HLS L > 0.5 → 浅 */
export function isLightPalette(palette: Palette): boolean {
  return hlsLightness(pick(palette, "surface", "#21201c")) > 0.5;
}

/** fuzzel 只认 8 位 #RRGGBBAA */
export function toRgba8(hex: string, alpha = "ff"): string {
  return `#${hex.replace("#", "")}${alpha}`;
}

/**
 * Noctalia v4.7.1 双键映射（theme-noctalia.sh 逐键照搬）：
 * Color.qml JsonAdapter 只认 m 驼峰键（官方模板 Assets/Templates/noctalia.json），
 * LanRhyme 色板是 Material 蛇形键——两套键合并在同一个 colors.json，
 * 我们的消费方读蛇形键、Noctalia 读 m 驼峰键，互不干扰。
 * 键序保持 python dict 迭代序（蛇形全量在前，m 驼峰按映射表序追加）。
 */
export const M_CAMEL_MAP: Readonly<Record<string, readonly [string, string]>> = {
  mPrimary: ["primary", "#dad8ce"],
  mOnPrimary: ["on_primary", "#22211c"],
  mSecondary: ["secondary", "#d8d9cf"],
  mOnSecondary: ["on_secondary", "#22211c"],
  mTertiary: ["tertiary", "#d5d8d0"],
  mOnTertiary: ["on_tertiary", "#22211c"],
  mError: ["error", "#fd4663"],
  mOnError: ["on_error", "#22211c"],
  mSurface: ["surface", "#21201c"],
  mOnSurface: ["on_surface", "#f3f3f2"],
  mSurfaceVariant: ["surface_container", "#37362f"], // 模板：← container
  mOnSurfaceVariant: ["on_surface_variant", "#b5b4b0"],
  mOutline: ["outline_variant", "#6c6a61"], // 模板：← variant
  mShadow: ["shadow", "#21201c"],
  mHover: ["tertiary", "#d5d8d0"], // 模板：← tertiary
  mOnHover: ["on_tertiary", "#22211c"],
};

/** 蛇形全量 + m 驼峰 16 键合并（theme-noctalia.sh 的 merged 构造） */
export function dualKeyMerge(palette: Palette): Palette {
  const merged: Palette = { ...palette };
  for (const [mk, [sk, fb]] of Object.entries(M_CAMEL_MAP)) {
    merged[mk] = pick(palette, sk, fb);
  }
  return merged;
}
