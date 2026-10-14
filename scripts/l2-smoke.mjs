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

// 注意：MCP SDK 的 stdio 客户端默认只透传白名单环境变量（HOME/PATH/USER 等），
// NIRI_SOCKET 会被丢掉——必须显式传完整 env。
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
});
const client = new Client({ name: "l2-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("已注册工具:", tools.map((t) => t.name).join(", "));

let failed = 0;
for (const t of ["list_windows", "list_workspaces", "list_outputs"]) {
  const r = await client.callTool({ name: t, arguments: {} });
  if (r.isError) failed++;
  console.log(`\n== ${t} == isError=${r.isError === true}`);
  console.log(textOf(r).slice(0, 240));
}

// 生命周期：开 alacritty → 移动 → 关闭
await client.callTool({ name: "open_app", arguments: { command: ["alacritty"] } });
await sleep(3000);
let wins = [];
try {
  wins = JSON.parse(textOf(await client.callTool({ name: "list_windows", arguments: {} })));
} catch {
  failed++;
  console.log("\n!! list_windows 返回的不是 JSON，前面的查询应该已经报错");
}
// 注意 app_id 的大小写由应用自报（Alacritty 是大写开头），统一小写再比
const target = wins.find((w) => String(w.app_id ?? "").toLowerCase().includes("alacritty"));
if (!target) {
  failed++;
  console.log("\n!! alacritty 窗口未出现，检查 spawn 是否成功");
} else {
  console.log(`\nalacritty 窗口 id=${target.id} title=${JSON.stringify(target.title)}`);
  const mv = await client.callTool({
    name: "move_window_to_workspace",
    arguments: { id: target.id, reference: "2" },
  });
  if (mv.isError) failed++;
  console.log("move:", textOf(mv), "isError=", mv.isError === true);
  const cl = await client.callTool({ name: "close_window", arguments: { id: target.id } });
  if (cl.isError) failed++;
  console.log("close:", textOf(cl), "isError=", cl.isError === true);
}

await client.close();
console.log(`\n== L2 冒烟完成（失败项: ${failed}）==`);
process.exit(failed > 0 ? 1 : 0);
