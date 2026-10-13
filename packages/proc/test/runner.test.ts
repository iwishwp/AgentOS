import { describe, expect, it } from "vitest";
import { ShellRunner } from "../src/runner.js";

// ShellRunner 是唯一真跑命令的测试：只用 /bin/echo 与 /bin/cat，macOS/Linux 通用
describe("ShellRunner", () => {
  it("捕获 stdout 与退出码", async () => {
    const r = await new ShellRunner().run("/bin/echo", ["hi"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hi\n");
  });

  it("支持向 stdin 写入（写完关闭）", async () => {
    const r = await new ShellRunner().run("/bin/cat", [], { input: "hello stdin" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hello stdin");
  });

  it("命令不存在时 code 为 null 且 stderr 有信息", async () => {
    const r = await new ShellRunner().run("/nonexistent/definitely-not-a-cmd", []);
    expect(r.code).toBeNull();
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it("非零退出码透传", async () => {
    const r = await new ShellRunner().run("/bin/false", []);
    expect(r.code).not.toBe(0);
  });
});
