import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { CredBroker, CredError } from "../src/broker.js";

const SECRET = "s3cret-value-不外传";
let runner: FakeRunner;
let policyPath: string;

beforeEach(() => {
  runner = new FakeRunner();
  policyPath = path.join(mkdtempSync(path.join(os.tmpdir(), "agentos-cred-")), "credentials.yaml");
  fs.writeFileSync(
    policyPath,
    [
      "credentials:",
      "  vault://test/demo:",
      "    label: 演示凭据",
      "    exec_allow: [python3, curl]",
      "    env: DEMO_TOKEN",
      "  vault://test/tight:",
      "    exec_allow: [git]",
    ].join("\n"),
  );
});

function makeBroker() {
  const b = new CredBroker(runner, { policyPath });
  // secret-tool lookup 的返回
  runner.on(["lookup"], { stdout: `${SECRET}\n` });
  return b;
}

describe("凭据代理（通道 B）", () => {
  it("list 只返回引用与策略，不返回值", async () => {
    const out = (await makeBroker().list()) as { credentials: unknown[] };
    const s = JSON.stringify(out);
    expect(s).toContain("vault://test/demo");
    expect(s).toContain("DEMO_TOKEN");
    expect(s).not.toContain(SECRET);
  });

  it("exec：白名单命令拿到注入的环境变量", async () => {
    runner.on(["-c"], { stdout: "hash=abc\n" });
    const r = await makeBroker().exec("vault://test/demo", [
      "python3",
      "-c",
      "print(os.environ['DEMO_TOKEN'])",
    ]);
    expect(runner.last()?.env?.["DEMO_TOKEN"]).toBe(SECRET);
    expect(r.code).toBe(0);
  });

  it("输出中的明文被彻底打码（双保险）", async () => {
    runner.on(["-c"], { stdout: `token=${SECRET} and bare ${SECRET.trim()}\n` });
    const r = await makeBroker().exec("vault://test/demo", ["python3", "-c", "leak"]);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stdout).toContain("«redacted»");
  });

  it("非白名单命令被拒且不触碰 secret-tool", async () => {
    const b = makeBroker();
    await expect(b.exec("vault://test/demo", ["bash", "-c", "evil"])).rejects.toThrow(
      /白名单/,
    );
    expect(runner.calls.some((c) => c.args[0] === "lookup")).toBe(false);
  });

  it("引用不在策略文件中被拒", async () => {
    await expect(makeBroker().exec("vault://nope/x", ["curl", "v"])).rejects.toThrow(
      /不在策略文件/,
    );
  });

  it("非法引用格式被拒", async () => {
    await expect(makeBroker().exec("vault://a b", ["curl"])).rejects.toThrow(CredError);
  });

  it("钥匙环无值时报可读错误", async () => {
    runner.on(["lookup"], { stdout: "" });
    await expect(makeBroker().exec("vault://test/tight", ["git", "push"])).rejects.toThrow(
      /无值/,
    );
  });
});
