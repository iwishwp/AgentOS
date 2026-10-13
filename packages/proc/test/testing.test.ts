import { describe, expect, it } from "vitest";
import { FakeRunner } from "../src/testing.js";

describe("FakeRunner", () => {
  it("记录调用（含 stdin 输入）并按前缀返回预置结果", async () => {
    const runner = new FakeRunner();
    runner.on(["a", "b"], { stdout: "ok" });

    await expect(runner.run("tool", ["a", "b", "c"], { input: "x" })).resolves.toEqual({
      stdout: "ok",
      stderr: "",
      code: 0,
    });
    expect(runner.last()).toEqual({ cmd: "tool", args: ["a", "b", "c"], input: "x" });
  });

  it("未预置的命令默认失败", async () => {
    const runner = new FakeRunner();
    const r = await runner.run("tool", ["nope"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("fake");
  });
});
