import { describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { DesktopClient, DesktopError } from "../src/desktop.js";

const BINS = {
  xdgOpen: "/fake/xdg-open",
  notifySend: "/fake/notify-send",
  wlCopy: "/fake/wl-copy",
  wlPaste: "/fake/wl-paste",
};

function make() {
  const runner = new FakeRunner();
  return { runner, desktop: new DesktopClient(runner, BINS) };
}

describe("open（xdg-open）", () => {
  it("目标作为唯一参数", async () => {
    const { runner, desktop } = make();
    runner.on(["/tmp/报告.docx"]);
    await desktop.open("/tmp/报告.docx");
    expect(runner.last()).toMatchObject({ cmd: BINS.xdgOpen, args: ["/tmp/报告.docx"] });
  });

  it("空目标直接拒绝", async () => {
    const { runner, desktop } = make();
    await expect(desktop.open("  ")).rejects.toThrow(DesktopError);
    expect(runner.calls).toHaveLength(0);
  });
});

describe("notify（notify-send）", () => {
  it("全量参数：urgency、timeout、summary、body", async () => {
    const { runner, desktop } = make();
    runner.on(["-u", "critical"]);
    await desktop.notify("任务完成", "报告已生成", "critical", 3000);
    expect(runner.last()).toMatchObject({
      cmd: BINS.notifySend,
      args: ["-u", "critical", "-t", "3000", "任务完成", "报告已生成"],
    });
  });

  it("最简形式：默认 urgency、无 body/timeout", async () => {
    const { runner, desktop } = make();
    runner.on(["-u", "normal"]);
    await desktop.notify("好了", undefined, "normal", undefined);
    expect(runner.lastArgs()).toEqual(["-u", "normal", "好了"]);
  });

  it("失败时错误信息带排查提示", async () => {
    const { runner, desktop } = make();
    runner.on(["-u", "normal", "x"], { code: 1, stderr: "no daemon" });
    await expect(desktop.notify("x", undefined, "normal", undefined)).rejects.toThrow(
      /mako/,
    );
  });
});

describe("剪贴板（wl-clipboard）", () => {
  it("读：wl-paste --no-newline，返回 stdout", async () => {
    const { runner, desktop } = make();
    runner.on(["--no-newline"], { stdout: "https://example.com" });
    await expect(desktop.clipboardRead()).resolves.toBe("https://example.com");
    expect(runner.last()).toMatchObject({ cmd: BINS.wlPaste, args: ["--no-newline"] });
  });

  it("写：wl-copy 不带参数，文本走 stdin", async () => {
    const { runner, desktop } = make();
    runner.on([]);
    await desktop.clipboardWrite("要粘贴的文本");
    expect(runner.last()).toMatchObject({ cmd: BINS.wlCopy, args: [] });
    expect(runner.last()?.input).toBe("要粘贴的文本");
  });

  it("不在 Wayland 会话内时报错可读", async () => {
    const { runner, desktop } = make();
    runner.on(["--no-newline"], { code: 1, stderr: "wl-paste: compositor does not support" });
    await expect(desktop.clipboardRead()).rejects.toThrow(/Wayland/);
  });
});
