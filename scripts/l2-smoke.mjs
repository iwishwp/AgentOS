#!/usr/bin/env node
// L2 真实环境冒烟：在 niri 会话内以真实 MCP 客户端直连 niri-mcp，逐个调用工具。
// 用法: node scripts/l2-smoke.mjs [server-entry-js]
// 前提: 已在 niri 会话内（NIRI_SOCKET 已导出），且 npm run build 完成。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server =
  process.argv[2] ?? new URL("../packages/niri-mcp/dist/index.js", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function textOf(r) {
  return r.content?.[0]?.text ?? "";
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
});
const client = new Client({ name: "l2-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("已注册工具:", tools.map((t) => t.name).join(", "));

for (const t of ["list_windows", "list_workspaces", "list_outputs"]) {
  const r = await client.callTool({ name: t, arguments: {} });
  console.log(`\n== ${t} == isError=${r.isError === true}`);
  console.log(textOf(r).slice(0, 240));
}

// 生命周期：开 alacritty → 移动 → 关闭
await client.callTool({ name: "open_app", arguments: { command: ["alacritty"] } });
await sleep(2000);
const wins = JSON.parse(textOf(await client.callTool({ name: "list_windows", arguments: {} })));
const target = wins.find((w) => String(w.app_id ?? "").includes("alacritty"));
if (!target) {
  console.log("\n!! alacritty 窗口未出现，检查 spawn 是否成功");
} else {
  console.log(`\nalacritty 窗口 id=${target.id} title=${JSON.stringify(target.title)}`);
  const mv = await client.callTool({
    name: "move_window_to_workspace",
    arguments: { id: target.id, reference: "2" },
  });
  console.log("move:", textOf(mv), "isError=", mv.isError === true);
  const cl = await client.callTool({ name: "close_window", arguments: { id: target.id } });
  console.log("close:", textOf(cl), "isError=", cl.isError === true);
}

await client.close();
console.log("\n== L2 冒烟完成 ==");
