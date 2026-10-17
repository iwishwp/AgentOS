import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createCanvasServer } from "../src/server.js";
import { parseNiriBinds, readKeys } from "../src/keys.js";
import { loadColors } from "../src/keys-page.js";

/** 迷你 fixture：覆盖分组注释/title/无 title/别名/参数/URL 引号/跨行 bind/垃圾行 */
const FIXTURE = `// AgentOS fixture
spawn-at-startup "mako"

binds {
    // ============ 启动应用 ============

    Super+Return { spawn "alacritty"; }

    // 别名 + hotkey-overlay-title
    Mod+T hotkey-overlay-title="Terminal: alacritty" { spawn "alacritty"; }

    // URL 里有 //，引号内的东西一律不当注释/括号
    Super+K hotkey-overlay-title="Keys: canvas /keys page" { spawn "chromium-browser" "--app=http://127.0.0.1:7788/keys" "--password-store=basic"; }

    // ============ 窗口操作 ============

    // 无 title：用 action 兜底
    Super+W { close-window; }
    Mod+Q repeat=false { close-window; }
    这是一行垃圾 hohoho
    Mod+Escape allow-inhibiting=false { toggle-keyboard-shortcuts-inhibit; }

    // 跨行 bind
    Super+F {
        fullscreen-window;
    }

    // 引号内的花括号不是括号
    Mod+E { spawn "echo" "{}"; }
}
`;

let dir: string;
let root: string;
let configPath: string;
let colorsPath: string;
let server: http.Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "agentos-keys-"));
  root = path.join(dir, "canvas");
  configPath = path.join(dir, "config.kdl");
  colorsPath = path.join(dir, "colors.json");
  fs.writeFileSync(configPath, FIXTURE);
  server = createCanvasServer(root, { niriConfigPath: configPath, colorsPath });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(r));
});

function get(p: string): Promise<Response> {
  return fetch(base + p);
}

describe("解析器 parseNiriBinds", () => {
  it("按分组注释分节，title/keys/action 全量正确", () => {
    const sections = parseNiriBinds(FIXTURE);
    expect(sections.map((s) => s.section)).toEqual(["启动应用", "窗口操作"]);
    const app = sections[0]!;
    expect(app.binds).toHaveLength(3);
    expect(app.binds[0]).toEqual({ keys: "Super+Return", title: 'spawn "alacritty"', action: 'spawn "alacritty"' });
    expect(app.binds[1]).toEqual({ keys: "Mod+T", title: "Terminal: alacritty", action: 'spawn "alacritty"' });
    expect(app.binds[2]!.keys).toBe("Super+K");
    // URL 引号内的 // 与内容原样保留
    expect(app.binds[2]!.action).toContain('--app=http://127.0.0.1:7788/keys');
    expect(app.binds[2]!.action).toContain("--password-store=basic");
  });

  it("无 title 的 bind 用 action 兜底；别名与附加参数不影响解析", () => {
    const win = parseNiriBinds(FIXTURE)[1]!;
    expect(win.binds[0]).toEqual({ keys: "Super+W", title: "close-window", action: "close-window" });
    expect(win.binds[1]).toEqual({ keys: "Mod+Q", title: "close-window", action: "close-window" });
    expect(win.binds[2]).toEqual({
      keys: "Mod+Escape",
      title: "toggle-keyboard-shortcuts-inhibit",
      action: "toggle-keyboard-shortcuts-inhibit",
    });
  });

  it("跨行 bind 与引号内花括号", () => {
    const win = parseNiriBinds(FIXTURE)[1]!;
    expect(win.binds[3]).toEqual({ keys: "Super+F", title: "fullscreen-window", action: "fullscreen-window" });
    expect(win.binds[4]).toEqual({ keys: "Mod+E", title: 'spawn "echo" "{}"', action: 'spawn "echo" "{}"' });
  });

  it("异常输入：空串/无 binds/垃圾行/EOF 未闭合，都不炸", () => {
    expect(parseNiriBinds("")).toEqual([]);
    expect(parseNiriBinds("layout { gaps 8 }")).toEqual([]);
    expect(parseNiriBinds("binds { }")).toEqual([]);
    // 垃圾行被跳过（上面 fixture 已含）；EOF 未闭合的 bind 被丢弃
    const unbalanced = parseNiriBinds('binds {\n  Super+A { spawn "x"\n');
    expect(unbalanced).toEqual([]);
    expect(parseNiriBinds("binds {\n  Super+A { spawn \"x\"\n")).toEqual([]);
  });

  it("分组注释之前出现的 bind 归入未分组", () => {
    const out = parseNiriBinds('binds {\n  Super+X { close-window; }\n  // ==== A ====\n  Super+Y { quit; }\n}');
    expect(out.map((s) => [s.section, s.binds.length])).toEqual([["未分组", 1], ["A", 1]]);
  });

  it("真实仓库配置可解析：分组齐、Super+K 已指向 /keys 页", () => {
    const repoConfig = path.resolve(import.meta.dirname, "../../../os/configs/niri/config.kdl");
    const sections = readKeys(repoConfig);
    expect(sections.length).toBeGreaterThanOrEqual(4);
    const all = sections.flatMap((s) => s.binds);
    // 终端默认已切 ghostty（docs/ghostty.md），断言跟着真实配置走
    expect(all.find((b) => b.keys === "Mod+T")).toMatchObject({ title: "Terminal: ghostty" });
    const superK = all.find((b) => b.keys === "Super+K");
    expect(superK!.action).toContain("--app=http://127.0.0.1:7788/keys");
    expect(superK!.action).toContain("--password-store=basic");
    // 内置兜底仍在
    expect(all.find((b) => b.keys === "Mod+Shift+Slash")!.action).toBe("show-hotkey-overlay");
  });
});

describe("/api/keys 路由", () => {
  it("返回分节 JSON", async () => {
    const r = await get("/api/keys");
    expect(r.status).toBe(200);
    const sections = (await r.json()) as { section: string; binds: { keys: string; title: string; action: string }[] }[];
    expect(sections.map((s) => s.section)).toEqual(["启动应用", "窗口操作"]);
    expect(sections[0]!.binds[1]).toMatchObject({ keys: "Mod+T", title: "Terminal: alacritty" });
  });

  it("配置文件缺失：500 + 明确错误（含路径与覆盖方法）", async () => {
    await new Promise<void>((r) => server.close(r));
    const missing = path.join(dir, "nope.kdl");
    server = createCanvasServer(root, { niriConfigPath: missing, colorsPath });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    const r = await fetch(`http://127.0.0.1:${addr.port}/api/keys`);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain(missing);
    expect(body.error).toContain("AGENTOS_NIRI_CONFIG");
  });
});

describe("/keys 页面", () => {
  it("注入 colors.json 的 CSS 变量（莫兰迪取自系统色板）", async () => {
    fs.writeFileSync(colorsPath, JSON.stringify({ surface: "#101010", on_surface: "#eeeeee", primary: "#abcdef", 错误键: 1 }));
    const r = await get("/keys");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("--surface:#101010");
    expect(html).toContain("--primary:#abcdef");
    expect(html).toContain("键位速查");
    expect(html).toContain("/api/keys");
    // 页面骨架：过滤框 + 吸顶分组标题（sticky）+ 键帽样式
    expect(html).toContain('id="filter"');
    expect(html).toContain("position:sticky");
    expect(html.match(/kbd\{/g)).toBeTruthy();
  });

  it("colors.json 缺失时降级到内置莫兰迪缺省值", async () => {
    const colors = loadColors(path.join(dir, "absent.json"));
    expect(colors["surface"]).toBe("#21201c");
    expect(colors["on_surface_variant"]).toBe("#b5b4b0");
    const r = await get("/keys");
    const html = await r.text();
    expect(html).toContain("--surface:#21201c");
  });
});
