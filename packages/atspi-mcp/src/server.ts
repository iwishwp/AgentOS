import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, ConfirmClient, createGate, summarizeArgs } from "@agentos/policy";
import { AtspiBridge, AtspiError } from "./bridge.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "a11y";
const appArg = z.string().min(1).describe("a11y 总线上的应用名（先用 a11y_list_apps 查）");

export function buildServer(
  runner: CommandRunner = new ShellRunner(),
  policy: Policy = Policy.load(),
): McpServer {
  const bridge = new AtspiBridge(runner);
  const server = new McpServer({ name: "atspi-mcp", version: "0.1.0" });

  // 统一注册入口：先过策略（allow/deny/confirm + 审计 + T1 确认流），再进 handler
  const t = createGate({
    server,
    extension: EXT,
    policy,
    confirm: new ConfirmClient(),
    summary: (_tool, args) => summarizeArgs(args),
  }) as McpServer["registerTool"];

  t(
    "a11y_list_apps",
    {
      title: "列出 a11y 应用",
      description:
        "列出 AT-SPI2 无障碍总线上注册的应用。操作 UI 前先调这个找目标应用名（agent 会话里开的应用也会注册）。",
    },
    async () => text(JSON.stringify(await bridge.apps(), null, 2)),
  );

  t(
    "a11y_dump_tree",
    {
      title: "倒无障碍树",
      description:
        "导出应用的无障碍树（JSON：role/name/states/actions/text/children），用于了解界面结构、找按钮名称。注意：树结构跨进程可能重建，索引路径不要跨调用使用——操作请用 a11y_click/a11y_set_text 按名称寻址。",
      inputSchema: {
        app: appArg,
        depth: z.number().int().min(1).max(16).default(16),
      },
    },
    async ({ app, depth }: { app: string; depth: number }) =>
      text(JSON.stringify(await bridge.tree(app, depth), null, 2)),
  );

  t(
    "a11y_click",
    {
      title: "按名称点击按钮",
      description:
        "在应用里按 accessible 名称点击按钮（AT-SPI2，无需焦点、不打扰用户）。例如 a11y_click('gnome-calculator', '7')。",
      inputSchema: {
        app: appArg,
        buttonName: z.string().min(1).describe("按钮名称（来自 dump_tree 或界面标签）"),
      },
    },
    async ({ app, buttonName }: { app: string; buttonName: string }) =>
      text(JSON.stringify(await bridge.click(app, buttonName))),
  );

  t(
    "a11y_read_texts",
    {
      title: "读应用内文本",
      description: "读取应用全部非空文本节点（显示屏/结果/标签值）。读计算结果、表单当前值都用它。",
      inputSchema: { app: appArg },
    },
    async ({ app }: { app: string }) => text(JSON.stringify(await bridge.texts(app), null, 2)),
  );

  t(
    "a11y_set_text",
    {
      title: "按名称写文本框",
      description:
        "对可编辑文本节点直接设置内容（无需焦点）。match 为节点名子串，* 表示第一个可编辑节点。表单填写主力。",
      inputSchema: {
        app: appArg,
        match: z.string().default("*").describe("节点名匹配子串，* 为第一个"),
        text: z.string().describe("要写入的新文本"),
      },
    },
    async ({ app, match, text: newText }: { app: string; match: string; text: string }) =>
      text(JSON.stringify(await bridge.setTextByMatch(app, match, newText))),
  );

  return server;
}
