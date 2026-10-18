import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  blend,
  dualKeyMerge,
  hlsLightness,
  isLightGhostty,
  isLightPalette,
  luma,
  M_CAMEL_MAP,
  pick,
  toRgba8,
  type Palette,
} from "../src/palette.js";

const REPO_DARK = fileURLToPath(new URL("../../../os/configs/noctalia/lanrhyme/colors.json", import.meta.url));
const REPO_LIGHT = fileURLToPath(new URL("../../../os/configs/noctalia/lanrhyme/colors-light.json", import.meta.url));
const dark = JSON.parse(readFileSync(REPO_DARK, "utf8")) as Palette;
const light = JSON.parse(readFileSync(REPO_LIGHT, "utf8")) as Palette;

describe("hex 工具", () => {
  it("blend 线性插值（与 python 同式 round(a*(1-r)+b*r)）", () => {
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080");
    // 手算对照：fd=253,46=70,63=99 × f3=243,f3=243,f2=242，r=0.3
    expect(blend("#fd4663", "#f3f3f2", 0.3)).toBe("#fa7a8e");
    expect(blend("#21201c", "#f3f3f2", 0.3)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("toRgba8 补 8 位（fuzzel 只认 #RRGGBBAA）", () => {
    expect(toRgba8("#37362f", "ee")).toBe("#37362fee");
    expect(toRgba8("#37362f")).toBe("#37362fff");
  });

  it("luma 与 hlsLightness 两种明度（桥内各自照搬）", () => {
    expect(luma("#ffffff")).toBeCloseTo(1);
    expect(luma("#000000")).toBe(0);
    expect(hlsLightness("#808080")).toBeCloseTo(0.5019607, 5);
  });
});

describe("变体检测", () => {
  it("暗板判暗、浅板判浅（两种口径一致）", () => {
    expect(isLightPalette(dark)).toBe(false);
    expect(isLightPalette(light)).toBe(true);
    expect(isLightGhostty(dark)).toBe(false);
    expect(isLightGhostty(light)).toBe(true);
  });

  it("缺键时按兜底暗色值判暗", () => {
    expect(isLightPalette({})).toBe(false);
    expect(isLightGhostty({})).toBe(false);
  });
});

describe("双键映射（Noctalia v4.7.1）", () => {
  it("m 驼峰 16 键 + 蛇形全量合并，键序：蛇形在前", () => {
    const merged = dualKeyMerge(dark);
    expect(Object.keys(merged)).toHaveLength(Object.keys(dark).length + Object.keys(M_CAMEL_MAP).length);
    expect(Object.keys(merged).slice(0, Object.keys(dark).length)).toEqual(Object.keys(dark));
    expect(Object.keys(merged).slice(-16)).toEqual(Object.keys(M_CAMEL_MAP));
  });

  it("关键映射：mSurfaceVariant←surface_container、mOutline←outline_variant、mHover←tertiary", () => {
    const merged = dualKeyMerge(dark);
    expect(merged.mSurfaceVariant).toBe(dark.surface_container);
    expect(merged.mOutline).toBe(dark.outline_variant);
    expect(merged.mHover).toBe(dark.tertiary);
    expect(merged.mPrimary).toBe(dark.primary);
    expect(merged.mShadow).toBe(dark.shadow);
  });

  it("缺键走内置莫兰迪兜底", () => {
    const merged = dualKeyMerge({ primary: "#abcdef" });
    expect(merged.mPrimary).toBe("#abcdef");
    expect(merged.mSurface).toBe("#21201c");
    expect(merged.mOutline).toBe("#6c6a61");
  });

  it("pick 只认 # 开头的字符串", () => {
    expect(pick({ a: "#123456" }, "a", "#000000")).toBe("#123456");
    expect(pick({ a: "red" }, "a", "#000000")).toBe("#000000");
    expect(pick({}, "a", "#000000")).toBe("#000000");
  });
});
