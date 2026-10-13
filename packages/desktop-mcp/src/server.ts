import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { DesktopClient, DesktopError } from "./desktop.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

/** 工具异常转为 isError 结果（MCP 惯例），让模型读到原因后自行重试/换路。 */
async function guard(fn: () => Promise<ToolOk>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof DesktopError || e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

export function buildServer(runner: CommandRunner = new ShellRunner()): McpServer {
  const server = new McpServer({ name: "desktop-mcp", version: "0.1.0" });
  const desktop = new DesktopClient(runner);

  server.registerTool(
    "open",
    {
      title: "打开目标",
      description:
        "用系统默认应用打开一个目标：文件（docx/pptx/pdf 走 LibreOffice/WPS）、目录（文件管理器）或 URL（浏览器）。呈现结果给用户的首选方式。",
      inputSchema: {
        target: z.string().min(1).describe("文件路径、目录或 URL"),
      },
    },
    async ({ target }) =>
      guard(async () => {
        await desktop.open(target);
        return text(`已打开: ${target}`);
      }),
  );

  server.registerTool(
    "notify",
    {
      title: "桌面通知",
      description:
        "发一条桌面通知。用于异步任务完成/失败提醒、需要用户确认的时刻。需要通知守护进程（mako）在运行。",
      inputSchema: {
        summary: z.string().min(1).describe("通知标题（一行，简明）"),
        body: z.string().optional().describe("通知正文（可选）"),
        urgency: z
          .enum(["low", "normal", "critical"])
          .default("normal")
          .describe("紧急程度"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("显示时长（毫秒，省略用守护进程默认）"),
      },
    },
    async ({ summary, body, urgency, timeoutMs }) =>
      guard(async () => {
        await desktop.notify(summary, body, urgency, timeoutMs);
        return text(`已通知: ${summary}`);
      }),
  );

  server.registerTool(
    "clipboard_read",
    {
      title: "读剪贴板",
      description: "读取当前剪贴板文本（Wayland，wl-clipboard）。用户复制的链接/文本常在这里。",
    },
    async () =>
      guard(async () => {
        const t = await desktop.clipboardRead();
        return text(t === "" ? "（剪贴板为空）" : t);
      }),
  );

  server.registerTool(
    "clipboard_write",
    {
      title: "写剪贴板",
      description: "把文本写入剪贴板（Wayland，wl-clipboard）。给用户准备好要粘贴的内容时用。",
      inputSchema: {
        text: z.string().describe("要写入的文本"),
      },
    },
    async ({ text: t }) =>
      guard(async () => {
        await desktop.clipboardWrite(t);
        return text(`已写入剪贴板（${t.length} 字符）`);
      }),
  );

  return server;
}
