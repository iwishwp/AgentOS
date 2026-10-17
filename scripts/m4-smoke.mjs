#!/usr/bin/env node
// M4 真实环境冒烟：以真实 MCP 客户端（stdio 直连）验证权限分级 v1 的关键链路。
// 用法: node scripts/m4-smoke.mjs <场景>
//   t1-confirm   —— desktop.confirm 工具走完整 T1 流（mako 四横幅 + Respond/ydotool 应答）
//   t1-refuse    —— niri.close_window 配 confirm 决策，用户拒绝 → 不执行
//   cred-b       —— 通道 B：cred_exec 哈希回执（与预期比对）
//   cred-a       —— 通道 A：cred_autofill 填 data: URL 测试页（长度/sha256 验证）
//   cred-c       —— 通道 C：cred_inject TTL 收割（sleep 60 + ttl 3）
//   pkg-install  —— T2：system.package_install 走 pkexec 全链（需 polkit 代理在位）
// 前提: npm run build 完成；AGENTOS_* 环境已按需导出；审计路径 AGENTOS_AUDIT_PATH 可覆盖。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";

const REPO = new URL("..", import.meta.url).pathname;
const scene = process.argv[2] ?? "t1-confirm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVERS = {
  desktop: `${REPO}packages/desktop-mcp/dist/index.js`,
  niri: `${REPO}packages/niri-mcp/dist/index.js`,
  cred: `${REPO}packages/cred-mcp/dist/index.js`,
  system: `${REPO}packages/system-mcp/dist/index.js`,
};

async function withClient(name, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVERS[name]],
    env: { ...process.env },
  });
  const client = new Client({ name: "m4-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const textOf = (r) => r.content?.[0]?.text ?? "";

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

switch (scene) {
  case "t1-confirm": {
    // 真实调用 desktop.confirm：应弹四条 mako 横幅并阻塞等待；
    // 由外部（测试驱动）通过 Respond 或真实点击应答。
    const r = await withClient("desktop", async (c) =>
      c.callTool({
        name: "confirm",
        arguments: { summary: "m4-smoke: 验证 T1 确认链路", tier: "t1" },
      }),
    );
    console.log(textOf(r));
    if (r.isError) die("confirm 返回 isError");
    break;
  }

  case "t1-refuse": {
    // niri.close_window 配为 confirm：用户拒绝后不得有任何 niri 调用发生
    const r = await withClient("niri", async (c) =>
      c.callTool({ name: "close_window", arguments: {} }),
    );
    console.log(textOf(r));
    if (!r.isError) die("用户拒绝后 close_window 不应执行");
    break;
  }

  case "cred-b": {
    const expected = process.env["M4_EXPECTED_SHA256"] ?? "";
    const r = await withClient("cred", async (c) =>
      c.callTool({
        name: "cred_exec",
        arguments: {
          ref: "vault://test/demo",
          command: [
            "python3",
            "-c",
            "import hashlib,os;v=os.environ['AGENTOS_SECRET'];print('sha256='+hashlib.sha256(v.encode()).hexdigest(),'len='+str(len(v)))",
          ],
        },
      }),
    );
    console.log(textOf(r));
    if (r.isError) die("cred_exec 失败");
    if (expected && !textOf(r).includes(expected)) die("SHA256 与预期不一致");
    if (textOf(r).includes("«redacted»")) die("输出出现未打码明文");
    break;
  }

  case "cred-a": {
    const page =
      "data:text/html,<html><body><h3>M4 通道A测试页</h3><input id=pwd type=password placeholder=密码></body></html>";
    const r = await withClient("cred", async (c) =>
      c.callTool({
        name: "cred_autofill",
        arguments: { ref: "vault://test/demo", url: page, selector: "#pwd" },
      }),
    );
    console.log(textOf(r));
    if (r.isError) die("cred_autofill 失败");
    const m = /sha256: ([0-9a-f]{64})/.exec(textOf(r));
    const expected = process.env["M4_EXPECTED_SHA256"];
    if (!m) die("回执缺 sha256");
    if (expected && m[1] !== expected) die("页面内值与预期不一致");
    break;
  }

  case "cred-c": {
    const t0 = Date.now();
    const r = await withClient("cred", async (c) =>
      c.callTool({
        name: "cred_inject",
        arguments: { ref: "vault://test/demo", command: ["sleep", "60"], ttl_seconds: 3 },
      }),
    );
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(textOf(r));
    console.log(`耗时: ${dt}s`);
    if (r.isError) die("cred_inject 失败");
    if (!/TTL 到点已被收割/.test(textOf(r))) die("未被 TTL 收割");
    if (Number(dt) > 10) die("收割过慢");
    break;
  }

  case "pkg-install": {
    const pkgs = (process.argv[3] ?? "cowsay").split(",");
    // T2 全链（Confirm1 delegated + polkit 认证 + 快照 + dnf）可能超过 SDK 默认 60s
    const r = await withClient("system", async (c) =>
      c.callTool(
        { name: "package_install", arguments: { packages: pkgs } },
        undefined,
        { timeout: 300_000 },
      ),
    );
    console.log(textOf(r));
    if (r.isError) die("package_install 失败");
    break;
  }

  default:
    die(`未知场景 ${scene}`);
}
console.log(`\n== m4-smoke ${scene} 完成 ==`);
process.exit(0);
