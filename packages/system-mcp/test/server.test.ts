import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import { beforeEach, describe, expect, it } from "vitest";
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
  it("注册 7 个只读工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "journal",
      "list_packages",
      "list_services",
      "network_info",
      "package_info",
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
