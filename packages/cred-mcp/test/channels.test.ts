import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import {
  CredBroker,
  CredError,
  buildFillExpression,
  INJECT_TTL_RANGE,
} from "../src/broker.js";

const SECRET = "autofill-秘密-123";
let runner: FakeRunner;
let policyPath: string;

beforeEach(() => {
  runner = new FakeRunner();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-ch"));
  policyPath = path.join(dir, "credentials.yaml");
  fs.writeFileSync(
    policyPath,
    [
      "credentials:",
      "  vault://test/full:",
      "    label: 全通道",
      "    allow: [execute, autofill, inject]",
      "    exec_allow: [python3, sleep, node]",
      "    env: DEMO_TOKEN",
      "  vault://test/exec-only:",
      "    exec_allow: [python3]",
      "  vault://test/af:",
      "    allow: autofill",
      "    exec_allow: [python3]",
    ].join("\n"),
  );
});

function makeBroker() {
  const b = new CredBroker(runner, { policyPath });
  runner.on(["lookup"], { stdout: `${SECRET}\n` });
  return b;
}

describe("通道 A（cred_autofill）", () => {
  const cdp = {
    open: async () => "已导航",
    eval: async (js: string) => {
      // 记录表达式（不得包含明文），返回页面内计算的回执形态
      (cdp as { lastJs?: string }).lastJs = js;
      return { value: { bytes: Buffer.byteLength(SECRET, "utf8"), sha256: "deadbeef" } };
    },
  };

  it("回执只有长度与 sha256，页面表达式内嵌值但绝不外传", async () => {
    const r = await makeBroker().autofill("vault://test/full", "data:text/html,<input id=p>", "#p", cdp);
    expect(r.bytes).toBe(Buffer.byteLength(SECRET, "utf8"));
    expect(r.sha256).toBe("deadbeef");
    expect(JSON.stringify(r)).not.toContain(SECRET);
    // 表达式里是 JSON.stringify 内嵌（无引号逃逸面）
    expect(cdp.lastJs).toContain(JSON.stringify(SECRET));
  });

  it("未开放 autofill 通道被拒（不触碰 secret-tool）", async () => {
    await expect(
      makeBroker().autofill("vault://test/exec-only", "data:text/html,<input>", "#p", cdp),
    ).rejects.toThrow(/未开放 autofill/);
    expect(runner.calls.some((c) => c.args[0] === "lookup")).toBe(false);
  });

  it("allow 单值（autofill）与列表等价", async () => {
    const r = await makeBroker().autofill("vault://test/af", "data:text/html,<input>", "#p", cdp);
    expect(r.sha256).toBe("deadbeef");
  });

  it("非法 url / selector 被拒", async () => {
    await expect(
      makeBroker().autofill("vault://test/full", "javascript:alert(1)", "#p", cdp),
    ).rejects.toThrow(/url/);
    await expect(
      makeBroker().autofill("vault://test/full", "data:text/html,<input>", "", cdp),
    ).rejects.toThrow(/selector/);
  });

  it("页面返回 error 时抛可读错误", async () => {
    const bad = { open: async () => "x", eval: async () => ({ value: { error: "selector 未命中: #p" } }) };
    await expect(
      makeBroker().autofill("vault://test/full", "data:text/html,<input>", "#p", bad),
    ).rejects.toThrow(/selector 未命中/);
  });

  it("buildFillExpression：值与选择器经 JSON 内嵌，事件为 input+change", () => {
    const js = buildFillExpression("#p", 'a"b\\c');
    expect(js).toContain(JSON.stringify('a"b\\c'));
    expect(js).toContain('"input"');
    expect(js).toContain('"change"');
    expect(js).toContain("HTMLInputElement.prototype");
  });
});

describe("通道 C（cred_inject）", () => {
  it("wrapper 参数与 env：secret 进 wrapper env、不上命令行", async () => {
    makeBroker(); // 先预置 lookup 应答，再挂兜底应答（空前缀匹配一切调用）
    runner.on([], { stdout: "", code: 0 });
    const audits: { tool: string; detail: string }[] = [];
    await makeBroker().inject("vault://test/full", ["sleep", "5"], 3, (e) => audits.push(e));
    const call = runner.calls.find((c) => c.args[0]?.includes("inject-wrapper"));
    expect(call).toBeDefined();
    expect(call!.args).toEqual(
      expect.arrayContaining(["--ttl", "3", "--env-name", "DEMO_TOKEN", "--", "sleep", "5"]),
    );
    // secret 在 env 里，绝不在 argv 里
    expect(call!.env?.["AGENTOS_INJECT_SECRET"]).toBe(SECRET);
    expect(call!.args.join(" ")).not.toContain(SECRET);
  });

  it("未开放 inject 通道被拒", async () => {
    await expect(
      makeBroker().inject("vault://test/exec-only", ["python3", "-c", "x"], 5, () => {}),
    ).rejects.toThrow(/未开放 inject/);
  });

  it("ttl 越界被拒（1–3600s）", async () => {
    for (const bad of [0, -1, INJECT_TTL_RANGE.max + 1, 1.5]) {
      await expect(
        makeBroker().inject("vault://test/full", ["sleep", "1"], bad, () => {}),
      ).rejects.toThrow(/ttl_seconds/);
    }
  });

  it("exec_allow 白名单同样约束通道 C", async () => {
    await expect(
      makeBroker().inject("vault://test/full", ["bash", "-c", "evil"], 5, () => {}),
    ).rejects.toThrow(/白名单/);
  });

  it("过期：AGENTOS_EXPIRED 标记 → expired=true + 过期审计", async () => {
    makeBroker(); // 先预置 lookup 应答，再挂兜底应答（空前缀匹配一切调用）
    runner.on([], { stderr: "AGENTOS_EXPIRED=1\n", code: 124 });
    const audits: { tool: string; detail: string }[] = [];
    const r = await makeBroker().inject("vault://test/full", ["sleep", "60"], 3, (e) => audits.push(e));
    expect(r.expired).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.detail).toContain("expired");
    expect(audits[0]!.detail).toContain("vault://test/full");
  });
});

describe("inject-wrapper（真实进程行为）", () => {
  const wrapper = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "inject-wrapper.ts");

  function runWrapper(ttl: number, command: string[]) {
    const nodeBin = process.execPath;
    // 直接跑 .ts：node 22+ 支持 --experimental-strip-types
    try {
      const out = execFileSync(
        nodeBin,
        ["--experimental-strip-types", wrapper, "--ttl", String(ttl), "--", ...command],
        {
          env: { ...process.env, AGENTOS_INJECT_SECRET: "W", AGENTOS_INJECT_REF: "vault://test/w" },
          timeout: 15_000,
        },
      ).toString();
      return out + "[exit 0]";
    } catch (e) {
      const err = e as { stdout?: Buffer; status?: number };
      return (err.stdout?.toString() ?? "") + `[exit ${err.status ?? "?"}]`;
    }
  }

  it("TTL 到点收割子进程组（sleep 30 + ttl 1 → ~1s 被杀，exit 124）", () => {
    const t0 = Date.now();
    const out = runWrapper(1, ["sleep", "30"]);
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(10_000);
    expect(out).toContain("[exit 124]");
  }, 20_000);

  it("命令在 TTL 内自然退出则原样返回退出码", () => {
    const out = runWrapper(10, ["sleep", "0.2"]);
    expect(out).not.toContain("[exit 124]");
    expect(out).toContain("[exit 0]");
  }, 20_000);

  it("子进程从改名后的 env 读到 secret（默认名 AGENTOS_SECRET）", () => {
    const out = runWrapper(10, [
      process.execPath,
      "-e",
      "process.stdout.write(process.env.AGENTOS_SECRET || 'MISSING')",
    ]);
    expect(out).toContain("W");
  }, 20_000);
});
