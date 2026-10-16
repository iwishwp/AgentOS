import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, audit } from "@agentos/policy";
import { AtspiBridge, AtspiError } from "./bridge.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "a11y";
const appArg = z.string().min(1).describe("a11y 总线上的应用名（先用 a11y_list_apps 查）");
const pathArg = z
  .array(z.number().int().min(0))
  .min(1)
  .describe("从应用根出发的子节点索引路径（来自 a11y_dump_tree 的 children 顺序）");

export function buildServer(
  runner: CommandRunner = new ShellRunner(),
  policy: Policy = Policy.load(),
): McpServer {
  const bridge = new AtspiBridge(runner);
  const server = new McpServer({ name: "atspi-mcp", version: "0.1.0" });

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
        const message = e instanceof AtspiError || e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    })) as McpServer["registerTool"];

  t(
    "a11y_list_apps",
    {
      title: "列出 a11y 应用",
      description:
        "列出 AT-SPI2 无障碍总线上注册的应用。操作 UI 前先调这个找目标应用名（agent 会话里开的应用也会注册在这里）。",
    },
    async () => text(JSON.stringify(await bridge.apps(), null, 2)),
  );

  t(
    "a11y_dump_tree",
    {
      title: "倒无障碍树",
      description:
        "导出应用的完整无障碍树（JSON：role/name/states/actions/text/children）。找按钮/输入框/文本的索引路径用它。libadwaita 嵌套深，depth 建议 16。",
      inputSchema: {
        app: appArg,
        depth: z.number().int().min(1).max(16).default(16),
      },
    },
    async ({ app, depth }: { app: string; depth: number }) =>
      text(JSON.stringify(await bridge.tree(app, depth), null, 2)),
  );

  t(
    "a11y_do_action",
    {
      title: "触发控件动作",
      description:
        "对无障碍节点触发动作（按钮 click、菜单项等）——不需要窗口获得焦点，不会打扰用户。动作序号来自 dump_tree 里的 actions[index]。",
      inputSchema: {
        app: appArg,
        path: pathArg,
        actionIndex: z.number().int().min(0).default(0),
      },
    },
    async ({ app, path, actionIndex }: { app: string; path: number[]; actionIndex: number }) =>
      text(JSON.stringify(await bridge.doAction(app, path, actionIndex))),
  );

  t(
    "a11y_set_text",
    {
      title: "设置文本框内容",
      description: "对可编辑文本节点直接设置内容（EditableText 接口）——同样无需焦点。表单填写的主力工具。",
      inputSchema: {
        app: appArg,
        path: pathArg,
        text: z.string().describe("要写入的新文本"),
      },
    },
    async ({ app, path, text: newText }: { app: string; path: number[]; text: string }) =>
      text(JSON.stringify(await bridge.setText(app, path, newText))),
  );

  return server;
}
