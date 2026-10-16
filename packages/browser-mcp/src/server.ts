import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Policy, audit } from "@agentos/policy";
import { BrowserClient, BrowserError, type BrowserDeps } from "./browser.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "browser";

export function buildServer(deps: BrowserDeps = {}, policy: Policy = Policy.load()): McpServer {
  const browser = new BrowserClient(deps);
  const server = new McpServer({ name: "browser-mcp", version: "0.1.0" });

  const t = ((name: string, config: Parameters<McpServer["registerTool"]>[1], cb: any) =>
    server.registerTool(name, config, async (args: unknown) => {
      const verdict = policy.decide(EXT, name);
      audit({ ts: new Date().toISOString(), extension: EXT, tool: name, decision: verdict.decision });
      if (verdict.decision === "deny") {
        return {
          content: [{ type: "text" as const, text: `策略拒绝 ${EXT}.${name}（${verdict.reason}）。可在 ~/.config/agentos/policy.yaml 调整。` }],
          isError: true,
        };
      }
      try {
        return await cb(args);
      } catch (e) {
        const message = e instanceof BrowserError || e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    })) as McpServer["registerTool"];

  t(
    "browser_open",
    {
      title: "打开网页",
      description:
        "在水族馆的 Chromium 里导航到 URL（首次调用会自动在水族馆启动浏览器）。浏览器在 agent 自己的会话里，不影响用户桌面。",
      inputSchema: {
        url: z.string().url().describe("目标 URL（http/https）"),
      },
    },
    async ({ url }: { url: string }) => text(await browser.open(url)),
  );

  t(
    "browser_eval",
    {
      title: "在页面里执行 JS",
      description:
        "在当前页面执行 JavaScript 并返回结果（returnByValue）。填表单/点按钮/读内容的主力：设置 input.value 并 dispatch 事件、element.click()、读 DOM 文本。",
      inputSchema: {
        js: z.string().min(1).describe("要执行的 JS 表达式（最后一个表达式作为返回值）"),
      },
    },
    async ({ js }: { js: string }) => text(JSON.stringify(await browser.eval(js), null, 2)),
  );

  t(
    "browser_screenshot",
    {
      title: "网页截图",
      description: "CDP 整页截图（PNG 存 ~/Agent/screenshots/，返回路径）。视觉确认页面状态用。",
      inputSchema: {
        name: z.string().optional().describe("文件名标记"),
      },
    },
    async ({ name }: { name?: string }) => text(`截图已保存: ${await browser.screenshot(name)}`),
  );

  return server;
}
