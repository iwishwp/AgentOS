/**
 * bridges.test.ts —— 五个桥的写文件断言（tmp 目录）。
 * 含**字节级对拍**：对同一色板分别跑旧 shell 桥（scripts/theme-*.sh，env 注入 tmp 路径）
 * 与 TS 桥，比较输出文件内容必须一致——"逻辑照搬、不自创行为"的机器证明。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeRunner } from "@agentos/proc/testing";
import { loadPalette, isLightPalette, dualKeyMerge, type Palette } from "../src/palette.js";
import { applyNoctalia } from "../src/bridges/noctalia.js";
import { applyMako, makoConfigText } from "../src/bridges/mako.js";
import { applyFuzzel } from "../src/bridges/fuzzel.js";
import { applyGhostty, ghosttyBlock } from "../src/bridges/ghostty.js";
import { applyGtk } from "../src/bridges/gtk.js";
import type { BridgeCtx } from "../src/bridges/types.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const REPO_DARK = join(REPO, "os/configs/noctalia/lanrhyme/colors.json");
const REPO_LIGHT = join(REPO, "os/configs/noctalia/lanrhyme/colors-light.json");

const HAS_PY = (() => {
  try {
    execFileSync("bash", ["-c", "command -v python3"]);
    return true;
  } catch {
    return false;
  };
})();

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "agentos-bridge-"));
}

function ctxFor(palette: Palette, runner = new FakeRunner()): { ctx: BridgeCtx; runner: FakeRunner } {
  return { ctx: { palette, variant: "dark", runner }, runner };
}

/** 跑旧 shell 桥，env 指到 tmp 路径 */
function runOldBridge(script: string, env: Record<string, string>): void {
  execFileSync("bash", [join(REPO, "scripts", script)], {
    env: { ...process.env, HOME: process.env.HOME ?? "/tmp", ...env },
  });
}

describe.each([
  ["暗色板", REPO_DARK],
  ["浅色板", REPO_LIGHT],
] as const)("桥输出（%s）", (_, paletteFile) => {
  let palette: Palette;
  let dir: string;
  beforeAll(async () => {
    palette = await loadPalette(paletteFile);
    dir = makeTmp();
  });

  it("noctalia：双键合并 colors.json（蛇形全量 + m 驼峰 16 键，幂等）", async () => {
    const out = join(dir, "colors.json");
    const { ctx } = ctxFor(palette);
    const r1 = await applyNoctalia(ctx, { colorsJson: out });
    const r2 = await applyNoctalia(ctx, { colorsJson: out });
    expect(r1.changed).toBe(true);
    expect(r2.changed).toBe(false); // 幂等：内容一致不重写
    const written = JSON.parse(readFileSync(out, "utf8")) as Palette;
    expect(Object.keys(written).filter((k) => k.startsWith("m"))).toHaveLength(16);
    expect(written.mPrimary).toBe(palette.primary);
    expect(written.mSurfaceVariant).toBe(palette.surface_container);
    expect(readFileSync(out, "utf8")).toBe(JSON.stringify(dualKeyMerge(palette), null, 2));
  });

  it("mako：三档紧急度配色 + makoctl reload 副作用", async () => {
    const out = join(dir, "mako-config");
    const { ctx, runner } = ctxFor(palette);
    const r = await applyMako(ctx, { config: out });
    expect(r.ok).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text).toContain(`background-color=${palette.surface_container}`);
    expect(text).toContain(`border-color=${palette.outline_variant}`);
    expect(text).toContain("[urgency=critical]");
    expect(text).toContain("default-timeout=0");
    expect(runner.calls.map((c) => `${c.cmd} ${c.args.join(" ")}`)).toContain("makoctl reload");
  });

  it("fuzzel：全部 8 位 #RRGGBBAA，border 三项在 [border] 小节", async () => {
    const out = join(dir, "fuzzel.ini");
    const { ctx } = ctxFor(palette);
    await applyFuzzel(ctx, { config: out });
    const text = readFileSync(out, "utf8");
    for (const m of text.matchAll(/=(#[0-9a-fA-F]{6,8})/g)) {
      expect(m[1]).toMatch(/^#[0-9a-fA-F]{8}$/); // fuzzel 只认 8 位
    }
    expect(text).toContain(`background=${palette.surface_container}ee`);
    const borderStart = text.lastIndexOf("[border]");
    const borderSection = borderStart >= 0 ? text.slice(borderStart, text.indexOf("[", borderStart + 1)) : "";
    expect(borderSection).toContain("width=2");
    expect(borderSection).toContain("radius=12");
    expect(borderSection).toContain("selection-radius=8");
  });

  it("ghostty：标记块幂等 + 极性正确 + theme= 行注释保留", async () => {
    const out = join(dir, "ghostty-config");
    writeFileSync(out, "theme = catppuccin-frappe\nfont-size = 12\n", "utf8");
    const { ctx } = ctxFor(palette);
    const r1 = await applyGhostty(ctx, { config: out });
    const first = readFileSync(out, "utf8");
    const r2 = await applyGhostty(ctx, { config: out });
    expect(r1.changed).toBe(true);
    expect(r2.changed).toBe(false);
    expect(first.match(/BEGIN agentos-morandi/g)).toHaveLength(1); // 幂等：单块
    expect(first).toContain("# [agentos-morandi 已接管] theme = catppuccin-frappe");
    expect(first).toContain("font-size = 12"); // 其余配置不动
    expect(first).toContain(`background = ${isLightPalette(palette) ? palette.surface_container : palette.surface}`);
    expect(first).toContain(`selection-background = ${palette.surface_container_highest}`);
    expect(first.match(/^palette = \d+=#/gm)).toHaveLength(16);
  });

  it("ghostty：浅色档极性翻转（背景 surface_container、光标 on_surface、ANSI 向深调和）", async () => {
    const lightBg = isLightPalette(palette);
    const block = ghosttyBlock(palette);
    const bg = /background = (#[0-9a-f]{6})/.exec(block)?.[1];
    const cursor = /cursor-color = (#[0-9a-f]{6})/.exec(block)?.[1];
    if (lightBg) {
      expect(bg).toBe(palette.surface_container);
      expect(cursor).toBe(palette.on_surface);
    } else {
      expect(bg).toBe(palette.surface);
      expect(cursor).toBe(palette.primary);
    }
    expect(bg).toBeDefined();
    expect(cursor).toBeDefined();
  });

  it("gtk：35+22 项 @define-color + shade_color rgba + settings.ini 单行翻转 + gsettings 同向翻转", async () => {
    const dirGtk = join(dir, "gtk");
    mkdirSync(join(dirGtk, "gtk-4.0"), { recursive: true });
    mkdirSync(join(dirGtk, "gtk-3.0"), { recursive: true });
    writeFileSync(join(dirGtk, "gtk-4.0", "settings.ini"), "[Settings]\ngtk-font-name=Noto Sans CJK 11\ngtk-application-prefer-dark-theme=true\n");
    const { ctx, runner } = ctxFor(palette);
    const r = await applyGtk(ctx, {
      gtk4Css: join(dirGtk, "gtk-4.0", "gtk.css"),
      gtk3Css: join(dirGtk, "gtk-3.0", "gtk.css"),
      gtk4Ini: join(dirGtk, "gtk-4.0", "settings.ini"),
      gtk3Ini: join(dirGtk, "gtk-3.0", "settings.ini"),
    });
    expect(r.ok).toBe(true);
    const css4 = readFileSync(join(dirGtk, "gtk-4.0", "gtk.css"), "utf8");
    const css3 = readFileSync(join(dirGtk, "gtk-3.0", "gtk.css"), "utf8");
    expect(css4.match(/@define-color /g)).toHaveLength(35);
    expect(css3.match(/@define-color /g)).toHaveLength(22);
    const shadow = palette.shadow ?? "#21201c";
    const [r16, g16, b16] = [1, 3, 5].map((i) => parseInt(shadow.slice(i, i + 2), 16));
    expect(css4).toContain(`@define-color shade_color rgba(${r16},${g16},${b16},0.36);`);
    expect(css4).toContain(`@define-color window_bg_color ${palette.surface};`);
    // ini：其余行保留 + prefer-dark 按极性翻转
    const ini4 = readFileSync(join(dirGtk, "gtk-4.0", "settings.ini"), "utf8");
    expect(ini4).toContain("gtk-font-name=Noto Sans CJK 11");
    const isLight = isLightPalette(palette);
    expect(ini4).toContain(`gtk-application-prefer-dark-theme=${isLight ? "false" : "true"}`);
    const ini3 = readFileSync(join(dirGtk, "gtk-3.0", "settings.ini"), "utf8");
    expect(ini3).toContain("[Settings]");
    expect(runner.calls).toContainEqual({
      cmd: "gsettings",
      args: ["set", "org.gnome.desktop.interface", "color-scheme", isLight ? "default" : "prefer-dark"],
      input: undefined,
      env: undefined,
    });
  });
});

describe("字节级对拍（TS 桥 vs 旧 shell 桥）", () => {
  it.skipIf(!HAS_PY)("noctalia 桥输出与 theme-noctalia.sh 一致", async () => {
    const dir = makeTmp();
    const oldOut = join(dir, "old-colors.json");
    const newOut = join(dir, "new-colors.json");
    runOldBridge("theme-noctalia.sh", { AGENTOS_COLORS_JSON: REPO_DARK, AGENTOS_NOCTALIA_COLORS: oldOut });
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyNoctalia(ctx, { colorsJson: newOut });
    expect(readFileSync(newOut, "utf8")).toBe(readFileSync(oldOut, "utf8"));
  });

  it.skipIf(!HAS_PY)("mako 桥配色项与 theme-mako.sh 一致（文本除生成头注释）", async () => {
    const dir = makeTmp();
    const oldOut = join(dir, "old-mako");
    const newOut = join(dir, "new-mako");
    runOldBridge("theme-mako.sh", { AGENTOS_COLORS_JSON: REPO_DARK, MAKO_CONFIG: oldOut });
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyMako(ctx, { config: newOut });
    stripHeader(oldOut, newOut, "# ");
    expect(readFileSync(newOut, "utf8")).toBe(readFileSync(oldOut, "utf8"));
  });

  it.skipIf(!HAS_PY)("fuzzel 桥与 theme-fuzzel.sh 一致（文本除生成头注释）", async () => {
    const dir = makeTmp();
    const oldOut = join(dir, "old-fuzzel.ini");
    const newOut = join(dir, "new-fuzzel.ini");
    runOldBridge("theme-fuzzel.sh", { AGENTOS_COLORS_JSON: REPO_DARK, FUZZEL_CONFIG: oldOut });
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyFuzzel(ctx, { config: newOut });
    stripHeader(oldOut, newOut, "# ");
    expect(readFileSync(newOut, "utf8")).toBe(readFileSync(oldOut, "utf8"));
  });

  it.skipIf(!HAS_PY)("ghostty 桥色值块与 theme-ghostty.sh 一致（除标记头文字）", async () => {
    const dir = makeTmp();
    const oldOut = join(dir, "old-ghostty");
    const newOut = join(dir, "new-ghostty");
    runOldBridge("theme-ghostty.sh", { AGENTOS_COLORS_JSON: REPO_DARK, GHOSTTY_CONFIG: oldOut });
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyGhostty(ctx, { config: newOut });
    // 块内逐行比对（标记行本身写明由谁生成，比对除标记行外的全部内容行）
    const body = (p: string) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => !l.includes("===== BEGIN") && !l.includes("===== END"))
        .map((l) => l.replace(/（[^）]*生成[^）]*）/, ""));
    expect(body(newOut)).toEqual(body(oldOut));
  });

  it.skipIf(!HAS_PY)("gtk 桥与 theme-gtk.sh 一致（css 除标记行；ini 全文）", async () => {
    const dir = makeTmp();
    runOldBridge("theme-gtk.sh", {
      AGENTOS_COLORS_JSON: REPO_DARK,
      GTK4_CSS: join(dir, "old-4.css"),
      GTK3_CSS: join(dir, "old-3.css"),
      GTK4_SETTINGS: join(dir, "old-4.ini"),
      GTK3_SETTINGS: join(dir, "old-3.ini"),
    });
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyGtk(ctx, {
      gtk4Css: join(dir, "new-4.css"),
      gtk3Css: join(dir, "new-3.css"),
      gtk4Ini: join(dir, "new-4.ini"),
      gtk3Ini: join(dir, "new-3.ini"),
    });
    const cssBody = (p: string) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => !l.includes("===== BEGIN") && !l.includes("===== END"));
    expect(cssBody(join(dir, "new-4.css"))).toEqual(cssBody(join(dir, "old-4.css")));
    expect(cssBody(join(dir, "new-3.css"))).toEqual(cssBody(join(dir, "old-3.css")));
    expect(readFileSync(join(dir, "new-4.ini"), "utf8")).toBe(readFileSync(join(dir, "old-4.ini"), "utf8"));
    expect(readFileSync(join(dir, "new-3.ini"), "utf8")).toBe(readFileSync(join(dir, "old-3.ini"), "utf8"));
  });

  it.skipIf(!HAS_PY)("浅色板对拍：ghostty/gtk 双档一致", async () => {
    const dir = makeTmp();
    runOldBridge("theme-ghostty.sh", { AGENTOS_COLORS_JSON: REPO_LIGHT, GHOSTTY_CONFIG: join(dir, "old-ghostty") });
    runOldBridge("theme-gtk.sh", {
      AGENTOS_COLORS_JSON: REPO_LIGHT,
      GTK4_CSS: join(dir, "old-4.css"),
      GTK3_CSS: join(dir, "old-3.css"),
      GTK4_SETTINGS: join(dir, "old-4.ini"),
      GTK3_SETTINGS: join(dir, "old-3.ini"),
    });
    const { ctx } = ctxFor(await loadPalette(REPO_LIGHT));
    await applyGhostty(ctx, { config: join(dir, "new-ghostty") });
    await applyGtk(ctx, {
      gtk4Css: join(dir, "new-4.css"),
      gtk3Css: join(dir, "new-3.css"),
      gtk4Ini: join(dir, "new-4.ini"),
      gtk3Ini: join(dir, "new-3.ini"),
    });
    const body = (p: string) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => !l.includes("===== BEGIN") && !l.includes("===== END"))
        .map((l) => l.replace(/（[^）]*生成[^）]*）/, ""));
    expect(body(join(dir, "new-ghostty"))).toEqual(body(join(dir, "old-ghostty")));
    expect(readFileSync(join(dir, "new-4.ini"), "utf8")).toBe(readFileSync(join(dir, "old-4.ini"), "utf8"));
  });

  it("旧脚本写的标记块能被新桥清掉（迁移期防双块）", async () => {
    const dir = makeTmp();
    if (HAS_PY) {
      runOldBridge("theme-ghostty.sh", { AGENTOS_COLORS_JSON: REPO_DARK, GHOSTTY_CONFIG: join(dir, "g") });
      runOldBridge("theme-gtk.sh", {
        AGENTOS_COLORS_JSON: REPO_DARK,
        GTK4_CSS: join(dir, "c4"),
        GTK3_CSS: join(dir, "c3"),
        GTK4_SETTINGS: join(dir, "i4"),
        GTK3_SETTINGS: join(dir, "i3"),
      });
    } else {
      writeFileSync(join(dir, "g"), "# ===== BEGIN agentos-morandi（scripts/theme-ghostty.sh 生成，勿手改） =====\nbackground = #21201c\n# ===== END agentos-morandi =====\n");
      writeFileSync(join(dir, "c4"), "/* ===== BEGIN agentos-morandi（scripts/theme-gtk.sh 生成，勿手改） ===== */\n@define-color accent_color #dad8ce;\n/* ===== END agentos-morandi ===== */\n");
    }
    const { ctx } = ctxFor(await loadPalette(REPO_DARK));
    await applyGhostty(ctx, { config: join(dir, "g") });
    await applyGtk(ctx, {
      gtk4Css: join(dir, "c4"),
      gtk3Css: join(dir, "c3"),
      gtk4Ini: join(dir, "i4"),
      gtk3Ini: join(dir, "i3"),
    });
    expect(readFileSync(join(dir, "g"), "utf8").match(/BEGIN agentos-morandi/g)).toHaveLength(1);
    expect(readFileSync(join(dir, "c4"), "utf8").match(/BEGIN agentos-morandi/g)).toHaveLength(1);
    expect(existsSync(join(dir, "c3"))).toBe(true);
  });
});

/** 头注释行（生成方署名）替换后再比对——正文必须全等 */
function stripHeader(oldPath: string, newPath: string, commentPrefix: string): void {
  const strip = (p: string) =>
    readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => !(l.startsWith(commentPrefix) && l.includes("生成")))
      .join("\n");
  writeFileSync(oldPath, strip(oldPath), "utf8");
  writeFileSync(newPath, strip(newPath), "utf8");
}
