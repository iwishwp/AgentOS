import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";
import { buildServer } from "../src/server.js";

let runner: FakeRunner;
let client: Client;

beforeEach(async () => {
  runner = new FakeRunner();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(runner).connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

function textOf(result: { content: unknown }): string {
  const first = (result.content as Array<{ text?: string }>)[0];
  return first?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 7 个只读工具 + 1 个 T2 装包工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "journal",
      "list_packages",
      "list_services",
      "network_info",
      "package_info",
      "package_install",
      "service_status",
      "system_status",
    ]);
  });

  it("list_services 默认参数直达 systemctl", async () => {
    runner.on(["list-units"], { stdout: "sshd loaded active running sshd" });
    const r = await client.callTool({ name: "list_services", arguments: {} });
    expect(textOf(r)).toContain("sshd");
  });

  it("journal 的 user 与 lines 透传", async () => {
    runner.on(["--user"], { stdout: "niri log" });
    const r = await client.callTool({
      name: "journal",
      arguments: { unit: "niri", lines: 10, user: true },
    });
    expect(textOf(r)).toContain("niri log");
    expect(runner.lastArgs()?.slice(0, 3)).toEqual(["--user", "-u", "niri"]);
  });

  it("命令失败返回 isError 而非协议错误", async () => {
    const r = await client.callTool({ name: "network_info", arguments: {} });
    expect(r.isError).toBe(true);
  });

  it("非法单元名在服务端被拒（不触碰系统命令）", async () => {
    const r = await client.callTool({
      name: "service_status",
      arguments: { name: "bad;name" },
    });
    expect(r.isError).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });
});

describe("package_install（T2 装包链）", () => {
  it("成功：pkexec helper 直传包名，回复含快照号与回滚指引", async () => {
    runner.on(["/usr/libexec/agentos/pkg-install", "cowsay"], {
      stdout: "AGENTOS_SNAPSHOT=42\n已安装。\n",
    });
    const r = await client.callTool({
      name: "package_install",
      arguments: { packages: ["cowsay"] },
    });
    expect(textOf(r)).toContain("快照 #42");
    expect(textOf(r)).toContain("snapshot.sh rollback 42");
    // 直传：argv 为 [helper, 包名]，无 shell 拼接
    expect(runner.last()!.cmd).toBe("pkexec");
    expect(runner.last()!.args).toEqual(["/usr/libexec/agentos/pkg-install", "cowsay"]);
  });

  it("失败：isError + 回滚指引", async () => {
    runner.on(["/usr/libexec/agentos/pkg-install", "no-such-pkg"], {
      stdout: "AGENTOS_SNAPSHOT=43\n",
      stderr: "没有匹配的包",
      code: 1,
    });
    const r = await client.callTool({
      name: "package_install",
      arguments: { packages: ["no-such-pkg"] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("snapshot.sh rollback 43");
  });

  it("带选项/元字符的包名被拒（防 dnf 选项注入）", async () => {
    for (const bad of ["--config=/tmp/x", "a;b", "../escape", "-v"]) {
      const r = await client.callTool({
        name: "package_install",
        arguments: { packages: [bad] },
      });
      expect(r.isError, `包名 ${bad} 应被拒绝`).toBe(true);
    }
    expect(runner.calls.filter((c) => c.cmd === "pkexec")).toHaveLength(0);
  });

  it("审计含快照号", async () => {
    const fs = await import("node:fs");
    const auditPath = "/tmp/agentos-test-audit.jsonl";
    fs.rmSync(auditPath, { force: true });
    runner.on(["/usr/libexec/agentos/pkg-install", "sl"], {
      stdout: "AGENTOS_SNAPSHOT=77\n",
    });
    await client.callTool({ name: "package_install", arguments: { packages: ["sl"] } });
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    const resultEntry = lines.map((l) => JSON.parse(l)).find((e) => e.snapshot === "77");
    expect(resultEntry).toBeDefined();
    expect(resultEntry.tool).toBe("package_install");
  });
});
