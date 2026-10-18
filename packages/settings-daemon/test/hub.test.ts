/**
 * hub.test.ts —— 环保护逻辑（本任务最大的坑）：
 *   1. 外部真实变更 → 上行一次
 *   2. 内容未变（同哈希）→ 去重不上行
 *   3. daemon 自写回声（recordSelfWrite 登记后写入）→ **不上行**（防死循环的关键）
 *   4. 自写之后 Noctalia 真覆写 → 仍能上行（不误吞）
 *   5. 端到端拓扑：colors.json 事件 → applyTheme → noctalia 桥写 colors.json → 无回环
 */
import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, cpSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WatchHub } from "../src/hub.js";
import { applyTheme } from "../src/apply.js";
import { defaultPaths } from "../src/paths.js";
import { loadPalette } from "../src/palette.js";
import { sleep } from "../src/fsutil.js";
import { FakeRunner } from "@agentos/proc/testing";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const tmps: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "agentos-hub-"));
  tmps.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe("WatchHub 环保护", () => {
  it("外部变更上行一次；同内容去重；自写回声不上行；随后真覆写仍上行", async () => {
    const dir = makeTmp();
    const target = join(dir, "colors.json");
    writeFileSync(target, "{}");
    const events: number[] = [];
    const hub = new WatchHub({ debounceMs: 40 });
    hub.watch(target, () => events.push(events.length));
    await sleep(150); // 挂载基线

    writeFileSync(target, '{"v":1}');
    await sleep(200);
    expect(events).toHaveLength(1); // 外部变更 → 上行

    writeFileSync(target, '{"v":1}');
    await sleep(200);
    expect(events).toHaveLength(1); // 内容未变 → 去重

    const self = '{"v":2}';
    hub.recordSelfWrite(target, self);
    writeFileSync(target, self);
    await sleep(200);
    expect(events).toHaveLength(1); // 自写回声 → 环保护吞掉

    writeFileSync(target, '{"noctalia":"覆写"}');
    await sleep(200);
    expect(events).toHaveLength(2); // 真实覆写 → 照常上行

    await hub.stopAll();
  });

  it("端到端：colors.json 事件触发 applyTheme，桥写回 colors.json 不引发二次事件", async () => {
    const home = makeTmp();
    const noctalia = join(home, ".config", "noctalia");
    const runtime = join(home, "run");
    mkdirSync(noctalia, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    cpSync(join(REPO, "os/configs/noctalia/lanrhyme/colors.json"), join(noctalia, "lanrhyme-palette.json"));
    writeFileSync(
      join(noctalia, "settings.json"),
      JSON.stringify({ colorSchemes: { darkMode: true } }),
    );
    const colorsJson = join(noctalia, "colors.json");
    writeFileSync(colorsJson, "{}");

    const paths = defaultPaths({ AGENTOS_HOME: home, XDG_RUNTIME_DIR: runtime });
    const runner = new FakeRunner();
    runner.on(["-c"], { stdout: "", code: 1 }); // command -v wtype → 不存在，跳过热重载
    const hub = new WatchHub({ debounceMs: 40 });

    let applies = 0;
    hub.watch(colorsJson, () => {
      applies++;
      void applyTheme(
        { paths, runner, hub },
        { reason: "colors.json 事件（测试）", appliedBy: "daemon" },
      );
    });
    await sleep(150);

    // 模拟 Noctalia 暗/亮切换覆写 colors.json（浅色默认顶掉我们的色板）
    writeFileSync(colorsJson, JSON.stringify({ mPrimary: "#070722", noctaliaDefault: true }));
    await sleep(600); // 防抖 + apply + 自写回声的防抖窗口

    expect(applies).toBe(1); // 只有外部那次；桥写回的回声被吞
    const written = JSON.parse(readFileSync(colorsJson, "utf8")) as Record<string, string>;
    expect(written.mPrimary).toBe((await loadPalette(paths.paletteDark)).primary); // 已被重落为我们的色板
    const state = JSON.parse(readFileSync(paths.stateFile, "utf8"));
    expect(state.paletteVariant).toBe("dark");
    expect(state.bridges.noctalia).toBe("ok");

    await hub.stopAll();
  });
});
