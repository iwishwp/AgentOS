import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { AtspiBridge, AtspiError } from "../src/bridge.js";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";

let runner: FakeRunner;
let script: string;

beforeEach(() => {
  runner = new FakeRunner();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-atspi-"));
  script = path.join(dir, "atspi_bridge.py");
  fs.writeFileSync(script, "# fake bridge");
});

describe("命令构造", () => {
  it("apps 无额外参数", async () => {
    runner.on([script, "apps"], { stdout: '{"apps":[]}' });
    const b = new AtspiBridge(runner, "/fake/python3", script);
    await b.apps();
    expect(runner.last()).toMatchObject({ cmd: "/fake/python3", args: [script, "apps"] });
  });

  it("tree 带 app 与 depth", async () => {
    runner.on([script, "tree"], { stdout: "{}" });
    await new AtspiBridge(runner, "/fake/python3", script).tree("gnome-calculator", 16);
    expect(runner.lastArgs()).toEqual([script, "tree", "gnome-calculator", "16"]);
  });

  it("tree 默认 interactive：不附加任何模式参数（桥端默认）", async () => {
    runner.on([script, "tree"], { stdout: '{"mode":"interactive"}' });
    await new AtspiBridge(runner, "/fake/python3", script).tree("app", 8);
    expect(runner.lastArgs()).toEqual([script, "tree", "app", "8"]);
  });

  it("tree interactive_only=false 时传 mode=full", async () => {
    runner.on([script, "tree"], { stdout: "{}" });
    await new AtspiBridge(runner, "/fake/python3", script).tree("app", 16, {
      interactiveOnly: false,
    });
    expect(runner.lastArgs()).toEqual([script, "tree", "app", "16", "mode=full"]);
  });

  it("tree roles 白名单与 compact 透传为 k=v", async () => {
    runner.on([script, "tree"], { stdout: "{}" });
    await new AtspiBridge(runner, "/fake/python3", script).tree("app", 16, {
      interactiveOnly: false,
      compact: true,
      roles: ["button", "push button"],
    });
    expect(runner.lastArgs()).toEqual([
      script,
      "tree",
      "app",
      "16",
      "mode=full",
      "compact=1",
      "roles=button,push button",
    ]);
  });

  it("clickSequence 把按钮名按序展开为 clickseq 参数", async () => {
    runner.on([script, "clickseq"], { stdout: '{"done":true}' });
    await new AtspiBridge(runner, "/fake/python3", script).clickSequence(
      "gnome-calculator",
      ["1", "2", "3", "4", "×", "5", "6", "="],
    );
    expect(runner.lastArgs()).toEqual([
      script,
      "clickseq",
      "gnome-calculator",
      "1",
      "2",
      "3",
      "4",
      "×",
      "5",
      "6",
      "=",
    ]);
  });

  it("clickSequence 空列表与超长列表被拒", async () => {
    const b = new AtspiBridge(runner, "/fake/python3", script);
    await expect(b.clickSequence("app", [])).rejects.toThrow(AtspiError);
    await expect(b.clickSequence("app", Array(33).fill("x"))).rejects.toThrow(AtspiError);
    await expect(b.clickSequence("app", ["ok", "  "])).rejects.toThrow(AtspiError);
    expect(runner.calls).toHaveLength(0);
  });

  it("doAction 的路径序列化成逗号串", async () => {
    runner.on([script, "action"], { stdout: '{"done":true}' });
    await new AtspiBridge(runner, "/fake/python3", script).doAction(
      "gnome-calculator",
      [0, 0, 3, 17],
      0,
    );
    expect(runner.lastArgs()).toEqual([
      script,
      "action",
      "gnome-calculator",
      "0,0,3,17",
      "0",
    ]);
  });

  it("setText 传新文本", async () => {
    runner.on([script, "text"], { stdout: '{"done":true}' });
    await new AtspiBridge(runner, "/fake/python3", script).setText("app", [1, 2], "你好");
    expect(runner.lastArgs()).toEqual([script, "text", "app", "1,2", "你好"]);
  });
});

describe("校验与错误", () => {
  it("非法应用名被拒", async () => {
    const b = new AtspiBridge(runner, "/fake/python3", script);
    await expect(b.tree("a;b", 4)).rejects.toThrow(AtspiError);
    expect(runner.calls).toHaveLength(0);
  });

  it("路径含负数/空路径被拒", async () => {
    const b = new AtspiBridge(runner, "/fake/python3", script);
    await expect(b.doAction("app", [-1], 0)).rejects.toThrow(AtspiError);
    await expect(b.doAction("app", [], 0)).rejects.toThrow(AtspiError);
  });

  it("桥脚本不存在时构造即报错", () => {
    expect(() => new AtspiBridge(runner, "/fake/python3", "/nonexistent.py")).toThrow(
      AtspiError,
    );
  });

  it("非零退出码把 stderr 透传", async () => {
    runner.on([script, "apps"], { code: 1, stderr: "未找到应用 xxx" });
    await expect(
      new AtspiBridge(runner, "/fake/python3", script).apps(),
    ).rejects.toThrow(/未找到应用/);
  });

  it("输出非 JSON 报错", async () => {
    runner.on([script, "apps"], { stdout: "not-json" });
    await expect(new AtspiBridge(runner, "/fake/python3", script).apps()).rejects.toThrow(
      /JSON/,
    );
  });
});
