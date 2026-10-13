import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { NiriClient, NiriError } from "./niri.js";

const windowId = z.number().int().describe("窗口 id（来自 list_windows 的 id 字段）");
const workspaceRef = z
  .string()
  .describe('工作区引用：序号（如 "3"）或名称（如 "web"）');

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

/** 工具异常转为 isError 结果（MCP 惯例），让模型读到原因后自行重试/换路。 */
async function guard(fn: () => Promise<ToolOk>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof NiriError || e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function buildServer(runner: CommandRunner = new ShellRunner()): McpServer {
  const server = new McpServer({ name: "niri-mcp", version: "0.1.0" });
  const niri = new NiriClient(runner);

  server.registerTool(
    "list_windows",
    {
      title: "列出窗口",
      description:
        "列出当前 niri 会话的所有窗口（JSON 数组，含 id、标题、app_id、所在工作区、是否聚焦）。操作具体窗口前先调用它拿 id。",
    },
    async () =>
      guard(async () => text(JSON.stringify(await niri.windows(), null, 2))),
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "列出工作区",
      description: "列出所有工作区（JSON 数组，含 idx、名称、是否活跃、所在输出器）。",
    },
    async () =>
      guard(async () => text(JSON.stringify(await niri.workspaces(), null, 2))),
  );

  server.registerTool(
    "list_outputs",
    {
      title: "列出输出器",
      description: "列出显示器/输出器（JSON 数组，含名称、分辨率、逻辑位置）。",
    },
    async () =>
      guard(async () => text(JSON.stringify(await niri.outputs(), null, 2))),
  );

  server.registerTool(
    "focus_window",
    {
      title: "聚焦窗口",
      description: "把指定窗口切换到前台并聚焦。注意：这会切换用户当前视角，呈现结果给用户时才用。",
      inputSchema: { id: windowId },
    },
    async ({ id }) =>
      guard(async () => {
        await niri.focusWindow(id);
        return text(`已聚焦窗口 ${id}`);
      }),
  );

  server.registerTool(
    "focus_workspace",
    {
      title: "切换工作区",
      description: "切换到指定工作区（序号或名称）。注意：这会切换用户当前视角。",
      inputSchema: { reference: workspaceRef },
    },
    async ({ reference }) =>
      guard(async () => {
        await niri.focusWorkspace(reference);
        return text(`已切换到工作区 ${reference}`);
      }),
  );

  server.registerTool(
    "move_window_to_workspace",
    {
      title: "移动窗口到工作区",
      description: "把窗口移到指定工作区。不传 id 则作用于当前聚焦窗口。移动不抢焦点，适合整理窗口。",
      inputSchema: { id: windowId.optional(), reference: workspaceRef },
    },
    async ({ id, reference }) =>
      guard(async () => {
        await niri.moveWindowToWorkspace(id, reference);
        return text(`已把窗口 ${id ?? "(当前聚焦)"} 移到工作区 ${reference}`);
      }),
  );

  server.registerTool(
    "close_window",
    {
      title: "关闭窗口",
      description: "关闭指定窗口。不传 id 则关闭当前聚焦窗口。",
      inputSchema: { id: windowId.optional() },
    },
    async ({ id }) =>
      guard(async () => {
        await niri.closeWindow(id);
        return text(`已关闭窗口 ${id ?? "(当前聚焦)"}`);
      }),
  );

  server.registerTool(
    "open_app",
    {
      title: "启动应用",
      description:
        '在 niri 会话里启动一个程序，如 ["firefox"] 或 ["libreoffice", "--writer", "报告.docx"]。',
      inputSchema: {
        command: z.array(z.string()).min(1).describe("要执行的命令及参数"),
      },
    },
    async ({ command }) =>
      guard(async () => {
        await niri.spawn(command);
        return text(`已启动: ${command.join(" ")}`);
      }),
  );

  return server;
}

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}
