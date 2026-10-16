import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { AgentSessionManager, SessionError } from "../src/agent-session.js";

let runtimeDir: string;
let shotsDir: string;

afterEach(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.rmSync(shotsDir, { recursive: true, force: true });
});

function makeManager(opts: { launchImpl?: () => number } = {}) {
  runtimeDir = mkdtempSync(path.join(os.tmpdir(), "agentos-rt-"));
  shotsDir = mkdtempSync(path.join(os.tmpdir(), "agentos-shots-"));
  const runner = new FakeRunner();
  const fakePid = 41234;
  const launch =
    opts.launchImpl ??
    (() => {
      // 模拟嵌套 niri：launch 后出现新 socket 文件
      fs.writeFileSync(path.join(runtimeDir, "niri.wayland-9.41234.sock"), "");
      return fakePid;
    });
  const manager = new AgentSessionManager({
    runner,
    runtimeDir,
    screenshotsDir: shotsDir,
    launch,
    wait: () => Promise.resolve(),
  });
  return { manager, runner, fakePid };
}

describe("agent 会话生命周期", () => {
  it("start 发现新 socket 并解析 wayland display", async () => {
    const { manager } = makeManager();
    const s = await manager.start();
    expect(s.pid).toBe(41234);
    expect(s.waylandDisplay).toBe("wayland-9");
    expect(s.socket).toContain("niri.wayland-9.41234.sock");
  });

  it("重复 start 被拒", async () => {
    const { manager } = makeManager();
    await manager.start();
    await expect(manager.start()).rejects.toThrow(SessionError);
  });

  it("stop 后可重新 start", async () => {
    const { manager } = makeManager();
    await manager.start();
    await manager.stop();
    expect(manager.info()).toBeNull();
    await expect(manager.start()).resolves.toBeTruthy();
  });

  it("未启动时操作被拒", async () => {
    const { manager } = makeManager();
    await expect(manager.openApp(["alacritty"])).rejects.toThrow(/未运行/);
    await expect(manager.screenshot()).rejects.toThrow(/未运行/);
  });
});

describe("会话内操作走嵌套 socket", () => {
  it("openApp 的 niri 调用带嵌套 NIRI_SOCKET", async () => {
    const { manager, runner } = makeManager();
    await manager.start();
    runner.on(["msg", "action", "spawn"]);
    await manager.openApp(["alacritty"]);
    const last = runner.last();
    expect(last?.args).toEqual(["msg", "action", "spawn", "--", "alacritty"]);
    expect(last?.env?.["NIRI_SOCKET"]).toContain("niri.wayland-9.41234.sock");
  });

  it("windows 查询同样路由到嵌套会话", async () => {
    const { manager, runner } = makeManager();
    await manager.start();
    runner.on(["msg", "--json", "windows"], { stdout: "[]" });
    await expect(manager.windows()).resolves.toEqual([]);
    expect(runner.last()?.env?.["NIRI_SOCKET"]).toContain("wayland-9");
  });
});

describe("截图", () => {
  it("grim 定向嵌套 display，PNG 落在截图目录", async () => {
    const { manager, runner } = makeManager();
    await manager.start();
    // fake runner 副作用：grim 调用时真的写出文件
    (runner as any).run = async (cmd: string, args: string[], options: any) => {
      runner.calls.push({ cmd, args, env: options?.env });
      fs.writeFileSync(args[0]!, "png");
      return { stdout: "", stderr: "", code: 0 };
    };
    const file = await manager.screenshot("测试");
    expect(file).toContain(shotsDir);
    expect(file).toContain("测试");
    expect(fs.existsSync(file)).toBe(true);
    expect(runner.last()?.env?.["WAYLAND_DISPLAY"]).toBe("wayland-9");
  });

  it("grim 失败时报可读错误", async () => {
    const { manager } = makeManager();
    await manager.start();
    await expect(manager.screenshot()).rejects.toThrow(/grim/);
  });
});
