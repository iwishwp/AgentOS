/**
 * apply.test.ts + state.test.ts —— 编排器与状态映射。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTheme, ApplyError } from "../src/apply.js";
import { defaultPaths, type Paths } from "../src/paths.js";
import { parseDarkMode, loadState, saveState } from "../src/state.js";
import { FakeRunner } from "@agentos/proc/testing";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function makeHome(darkMode: boolean, withLight: boolean): { home: string; paths: Paths; runner: FakeRunner } {
  const home = mkdtempSync(join(tmpdir(), "agentos-apply-"));
  const noctalia = join(home, ".config", "noctalia");
  const runtime = join(home, "run");
  mkdirSync(noctalia, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  cpSync(join(REPO, "os/configs/noctalia/lanrhyme/colors.json"), join(noctalia, "lanrhyme-palette.json"));
  if (withLight) {
    cpSync(join(REPO, "os/configs/noctalia/lanrhyme/colors-light.json"), join(noctalia, "lanrhyme-palette-light.json"));
  }
  writeFileSync(join(noctalia, "settings.json"), JSON.stringify({ colorSchemes: { darkMode } }));
  const runner = new FakeRunner();
  runner.on(["-c"], { stdout: "", code: 1 }); // command -v wtype 失败 → 跳过 ghostty 热重载
  return { home, paths: defaultPaths({ AGENTOS_HOME: home, XDG_RUNTIME_DIR: runtime }), runner };
}

describe("applyTheme 编排", () => {
  it("auto：darkMode=true → 暗档五桥全 ok，状态快照落盘", async () => {
    const { paths, runner } = makeHome(true, true);
    const r = await applyTheme({ paths, runner }, { reason: "test", appliedBy: "cli" });
    expect(r.variant).toBe("dark");
    expect(r.bridges.map((b) => b.name)).toEqual(["noctalia", "mako", "fuzzel", "ghostty", "gtk"]);
    expect(r.bridges.every((b) => b.ok)).toBe(true);
    const state = await loadState(paths.stateFile);
    expect(state).toMatchObject({ darkMode: true, paletteVariant: "dark", appliedBy: "cli" });
    expect(state?.bridges).toEqual({ noctalia: "ok", mako: "ok", fuzzel: "ok", ghostty: "ok", gtk: "ok" });
  });

  it("auto：darkMode=false + 浅色板 → 浅档，prefer-dark 翻 false、gsettings default", async () => {
    const { paths, runner } = makeHome(false, true);
    const r = await applyTheme({ paths, runner }, { reason: "test", appliedBy: "cli" });
    expect(r.variant).toBe("light");
    expect(r.palettePath).toBe(paths.paletteLight);
    const ini4 = readFileSync(paths.gtk4Ini, "utf8");
    expect(ini4).toContain("gtk-application-prefer-dark-theme=false");
    expect(runner.calls).toContainEqual({
      cmd: "gsettings",
      args: ["set", "org.gnome.desktop.interface", "color-scheme", "default"],
      input: undefined,
      env: undefined,
    });
    const colors = JSON.parse(readFileSync(paths.colorsJson, "utf8"));
    expect(colors.mPrimary).toBeTruthy(); // 双键格式重落
  });

  it("浅色板缺失 → 回落暗档（与旧链一致）", async () => {
    const { paths, runner } = makeHome(false, false);
    const r = await applyTheme({ paths, runner }, { reason: "test", appliedBy: "cli" });
    expect(r.variant).toBe("dark");
    expect(r.lightFallbackToDark).toBe(true);
    expect(r.palettePath).toBe(paths.paletteDark);
  });

  it("双色板缺失 → ApplyError", async () => {
    const { paths, runner } = makeHome(true, true);
    const { rmSync } = await import("node:fs");
    rmSync(paths.paletteDark);
    rmSync(paths.paletteLight);
    await expect(
      applyTheme({ paths, runner }, { reason: "test", appliedBy: "cli" }),
    ).rejects.toBeInstanceOf(ApplyError);
  });

  it("强制 --light 与真相背离时按强制档应用（状态如实记录）", async () => {
    const { paths, runner } = makeHome(true, true);
    const r = await applyTheme({ paths, runner }, { variant: "light", reason: "test", appliedBy: "cli" });
    expect(r.forced).toBe(true);
    expect(r.variant).toBe("light");
    expect(r.darkMode).toBe(true); // 真相不动
    const state = await loadState(paths.stateFile);
    expect(state?.darkMode).toBe(true);
    expect(state?.paletteVariant).toBe("light");
  });

  it("settings.json 读不到按暗色兜底（旧链同语义）", async () => {
    const { paths, runner } = makeHome(false, true);
    const { rmSync } = await import("node:fs");
    rmSync(paths.noctaliaSettings);
    const r = await applyTheme({ paths, runner }, { reason: "test", appliedBy: "cli" });
    expect(r.variant).toBe("dark");
  });
});

describe("state 模块", () => {
  it("parseDarkMode：缺文件/坏 JSON/缺键全按暗色，显式 false 才浅", () => {
    expect(parseDarkMode(null)).toBe(true);
    expect(parseDarkMode("not json")).toBe(true);
    expect(parseDarkMode("{}")).toBe(true);
    expect(parseDarkMode('{"colorSchemes":{}}')).toBe(true);
    expect(parseDarkMode('{"colorSchemes":{"darkMode":false}}')).toBe(false);
    expect(parseDarkMode('{"colorSchemes":{"darkMode":true}}')).toBe(true);
  });

  it("saveState/loadState 往返", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-state-"));
    const p = join(dir, "settings-state.json");
    await saveState(p, {
      darkMode: true,
      paletteVariant: "dark",
      palettePath: "/x.json",
      lastAppliedAt: "2026-10-18T00:00:00.000Z",
      appliedBy: "daemon",
      bridges: { gtk: "ok" },
    });
    expect(await loadState(p)).toMatchObject({ paletteVariant: "dark", appliedBy: "daemon" });
    expect(await loadState(join(dir, "none.json"))).toBeNull();
  });
});
