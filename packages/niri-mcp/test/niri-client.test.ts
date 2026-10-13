import { describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { NiriClient, NiriError } from "../src/niri.js";

const BIN = "/fake/niri";

const ACTION_PREFIXES = [
  ["msg", "action", "focus-window"],
  ["msg", "action", "focus-workspace"],
  ["msg", "action", "move-window-to-workspace"],
  ["msg", "action", "close-window"],
  ["msg", "action", "spawn"],
];

function make() {
  const runner = new FakeRunner();
  for (const prefix of ACTION_PREFIXES) runner.on(prefix);
  return { runner, niri: new NiriClient(runner, BIN) };
}

describe("查询命令", () => {
  it("windows/workspaces/outputs 走 msg --json 并解析 JSON", async () => {
    const { runner, niri } = make();
    runner.on(["msg", "--json", "windows"], { stdout: '[{"id":1,"title":"alacritty"}]' });

    await expect(niri.windows()).resolves.toEqual([{ id: 1, title: "alacritty" }]);
    expect(runner.lastArgs()).toEqual(["msg", "--json", "windows"]);
    expect(runner.calls[0]?.cmd).toBe(BIN);
  });

  it("非 JSON 输出报 NiriError", async () => {
    const { runner, niri } = make();
    runner.on(["msg", "--json", "workspaces"], { stdout: "not-json" });
    await expect(niri.workspaces()).rejects.toThrow(NiriError);
  });

  it("命令失败时把 stderr 带进错误信息", async () => {
    const { runner, niri } = make();
    runner.on(["msg", "--json", "outputs"], { code: 1, stderr: "boom" });
    await expect(niri.outputs()).rejects.toThrow("boom");
  });
});

describe("动作命令", () => {
  it("focusWindow 拼 --id", async () => {
    const { runner, niri } = make();
    await niri.focusWindow(3);
    expect(runner.lastArgs()).toEqual(["msg", "action", "focus-window", "--id", "3"]);
  });

  it("focusWorkspace 接受序号或名称", async () => {
    const { runner, niri } = make();
    await niri.focusWorkspace("web");
    expect(runner.lastArgs()).toEqual(["msg", "action", "focus-workspace", "web"]);
  });

  it("moveWindowToWorkspace：带 id 与不带 id 两种形态", async () => {
    const { runner, niri } = make();
    await niri.moveWindowToWorkspace(3, "5");
    expect(runner.lastArgs()).toEqual([
      "msg",
      "action",
      "move-window-to-workspace",
      "--id",
      "3",
      "5",
    ]);
    await niri.moveWindowToWorkspace(undefined, "5");
    expect(runner.lastArgs()).toEqual(["msg", "action", "move-window-to-workspace", "5"]);
  });

  it("closeWindow：带 id 与作用于当前聚焦两种形态", async () => {
    const { runner, niri } = make();
    await niri.closeWindow(7);
    expect(runner.lastArgs()).toEqual(["msg", "action", "close-window", "--id", "7"]);
    await niri.closeWindow(undefined);
    expect(runner.lastArgs()).toEqual(["msg", "action", "close-window"]);
  });

  it("spawn 用 -- 分隔命令", async () => {
    const { runner, niri } = make();
    await niri.spawn(["libreoffice", "--writer", "报告.odt"]);
    expect(runner.lastArgs()).toEqual([
      "msg",
      "action",
      "spawn",
      "--",
      "libreoffice",
      "--writer",
      "报告.odt",
    ]);
  });

  it("spawn 空命令直接拒绝，不碰 runner", async () => {
    const { runner, niri } = make();
    await expect(niri.spawn([])).rejects.toThrow(NiriError);
    expect(runner.calls).toHaveLength(0);
  });
});
