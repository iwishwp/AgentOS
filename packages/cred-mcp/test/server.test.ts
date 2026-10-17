import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRunner } from "@agentos/proc/testing";
import { Policy } from "@agentos/policy";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";

const SECRET = "top-secret-42";

let runner: FakeRunner;
let client: Client;
let policyPath: string;

beforeEach(async () => {
  runner = new FakeRunner();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-mcp-"));
  policyPath = path.join(dir, "credentials.yaml");
  fs.writeFileSync(
    policyPath,
    "credentials:\n  vault://test/demo:\n    exec_allow: [python3]\n    env: TOKEN\n",
  );
  runner.on(["lookup"], { stdout: `${SECRET}\n` });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await buildServer(runner, Policy.fromRules({}), { policyPath }).connect(st);
  client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
});

function textOf(r: { content: unknown }): string {
  return (r.content as Array<{ text?: string }>)[0]?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 4 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["cred_autofill", "cred_exec", "cred_inject", "cred_list"]);
  });

  it("cred_exec 全链路：注入/打码/返回", async () => {
    runner.on(["hash.py"], { stdout: `sha256=${SECRET}的哈希不会泄露\n` });
    const r = await client.callTool({
      name: "cred_exec",
      arguments: { ref: "vault://test/demo", command: ["python3", "hash.py"] },
    });
    expect(textOf(r)).toContain("exit=0");
    expect(textOf(r)).not.toContain(SECRET);
    expect(runner.last()?.env?.["TOKEN"]).toBe(SECRET);
  });

  it("白名单外命令返回 isError", async () => {
    const r = await client.callTool({
      name: "cred_exec",
      arguments: { ref: "vault://test/demo", command: ["curl", "http://x"] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("白名单");
  });

  it("策略 deny 拦截（agentos policy 层）", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildServer(runner, Policy.fromRules({ cred: { cred_exec: "deny" } }), {
      policyPath,
    }).connect(st);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(ct);
    const r = await c.callTool({
      name: "cred_exec",
      arguments: { ref: "vault://test/demo", command: ["python3", "x"] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("策略拒绝");
  });
});
