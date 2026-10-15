import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTOS_AUDIT_PATH = "/tmp/agentos-test-audit.jsonl";
import { buildServer } from "../src/server.js";
import { Workspace } from "../src/workspace.js";

let client: Client;
let w: Workspace;

beforeEach(async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentos-mcp-"));
  w = new Workspace(root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(w).connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

function textOf(result: { content: unknown }): string {
  const first = (result.content as Array<{ text?: string }>)[0];
  return first?.text ?? "";
}

describe("MCP 工具面", () => {
  it("注册 8 个工具", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_dir",
      "delete",
      "download",
      "find_by_name",
      "list_dir",
      "move",
      "read_file",
      "write_file",
    ]);
  });

  it("写→读 roundtrip", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "hello.md", content: "# 标题" },
    });
    const r = await client.callTool({ name: "read_file", arguments: { path: "hello.md" } });
    expect(textOf(r)).toBe("# 标题");
  });

  it("越界读取返回 isError 而非协议错误", async () => {
    const r = await client.callTool({
      name: "read_file",
      arguments: { path: "../../../etc/passwd" },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("越界");
  });

  it("删除进回收站后原文件不可读", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "trashme.txt", content: "x" },
    });
    const d = await client.callTool({ name: "delete", arguments: { path: "trashme.txt" } });
    expect(textOf(d)).toContain(".trash");
    const r = await client.callTool({ name: "read_file", arguments: { path: "trashme.txt" } });
    expect(r.isError).toBe(true);
  });

  it("find_by_name 找到刚写入的文件", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "docs/计划-v2.md", content: "x" },
    });
    const r = await client.callTool({
      name: "find_by_name",
      arguments: { pattern: "计划" },
    });
    expect(textOf(r)).toContain("docs/计划-v2.md");
  });
});
