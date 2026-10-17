import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, ConfirmClient, audit, createGate, summarizeArgs } from "@agentos/policy";
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
  const confirmClient = new ConfirmClient();

  // 统一注册入口：先过策略（allow/deny/confirm + 审计 + T1 确认流），再进 handler
  const t = createGate({
    server,
    extension: EXT,
    policy,
    confirm: confirmClient,
    summary: (_tool, args) => summarizeArgs(args),
  }) as McpServer["registerTool"];

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

  t(
    "confirm",
    {
      title: "向用户发起确认（T1 通道入口）",
      description:
        "向用户弹四条确认横幅（org.agentos.Confirm1 → mako，一个选择一条，自上而下 允许/会话允许/拒绝/永不），阻塞等待选择：" +
        "allow_once 允许一次 / allow_session 本次会话允许 / deny_once 拒绝 / always_deny 永不；30 秒无响应视为拒绝。" +
        "适用：agent 主动向用户请示（工具策略之外的决定点）。注意 summary 里不要放任何敏感内容——它会显示在通知里。",
      inputSchema: {
        summary: z
          .string()
          .min(1)
          .max(300)
          .describe("给用户看的问题/事项摘要（一行，脱敏）"),
        tier: z.enum(["t1", "t2"]).default("t1").describe("档位标注（影响通知文案）"),
      },
    },
    async ({ summary, tier }) =>
      guard(async () => {
        const outcome = await confirmClient.ask("agent", "question", summary, tier);
        audit({
          ts: new Date().toISOString(),
          extension: EXT,
          tool: "confirm",
          decision: outcome.choice.startsWith("allow") ? "allow" : "deny",
          tier,
          confirm: {
            asked: true,
            result: outcome.choice,
            by: outcome.by,
            response_ms: outcome.responseMs,
          },
        });
        if (outcome.unavailable) {
          throw new DesktopError(
            "确认服务 org.agentos.Confirm1 不可用（systemctl --user status agentos-confirm）",
          );
        }
        return text(
          `用户选择: ${outcome.choice}（by ${outcome.by}，${(outcome.responseMs / 1000).toFixed(1)}s 响应）`,
        );
      }),
  );

  return server;
}
