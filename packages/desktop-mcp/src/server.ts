import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, audit } from "@agentos/policy";
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

const EXT = "desktop";

export function buildServer(
  runner: CommandRunner = new ShellRunner(),
  policy: Policy = Policy.load(),
): McpServer {
  const server = new McpServer({ name: "desktop-mcp", version: "0.1.0" });
  const desktop = new DesktopClient(runner);

  // 统一注册入口：先过策略（allow/deny + 审计），再进 handler
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
      return cb(args);
    })) as McpServer["registerTool"];

  t(
    "open",
    {
      title: "打开目标",
      description:
        "用系统默认应用打开一个目标：文件（docx/pptx/pdf 走 LibreOffice/WPS）、目录（文件管理器）或 URL（浏览器）。呈现结果给用户的首选方式。MIME 关联不可靠时可传 app 指定应用（如 app: libreoffice）。",
      inputSchema: {
        target: z.string().min(1).describe("文件路径、目录或 URL"),
        app: z
          .string()
          .optional()
          .describe("指定应用别名（libreoffice/soffice），缺省走系统关联"),
      },
    },
    async ({ target, app }) =>
      guard(async () => {
        if (app) {
          await desktop.openWith(app, target);
          return text(`已用 ${app} 打开: ${target}`);
        }
        await desktop.open(target);
        return text(`已打开: ${target}`);
      }),
  );

  t(
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

  t(
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

  t(
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
