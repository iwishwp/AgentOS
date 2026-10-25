import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, ConfirmClient, createGate, summarizeArgs } from "@agentos/policy";
import { AgentSessionManager, SessionError, type SessionDeps } from "./agent-session.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "session";

export function buildServer(
  deps: Omit<SessionDeps, "runner"> & { runner?: CommandRunner } = {},
  policy: Policy = Policy.load(),
): McpServer {
  const runner = deps.runner ?? new ShellRunner();
  const manager = new AgentSessionManager({ ...deps, runner });
  const server = new McpServer({ name: "session-mcp", version: "0.1.0" });

  // 统一注册入口：先过策略（allow/deny/confirm + 审计 + T1 确认流），再进 handler
  const t = createGate({
    server,
    extension: EXT,
    policy,
    confirm: new ConfirmClient(),
    summary: (_tool, args) => summarizeArgs(args),
  }) as McpServer["registerTool"];

  t(
    "agent_session_start",
    {
      title: "启动 agent 会话（水族馆）",
      description:
        "在用户桌面上以窗口形式启动一个嵌套 niri 会话——agent 专属的 GUI 环境，所有 GUI 操作都在里面进行，不影响用户焦点。返回它的 IPC socket 与 Wayland display。桌面上会出现一个新窗口，用户可以围观。启动后要开应用可直接同轮紧跟 agent_open_app（同轮调用按序执行）。",
    },
    async () => {
      const s = await manager.start();
      return text(
        `agent 会话已启动（水族馆）: pid=${s.pid}, wayland=${s.waylandDisplay}, socket=${s.socket}`,
      );
    },
  );

  t(
    "agent_session_stop",
    {
      title: "停止 agent 会话",
      description: "关闭 agent 的嵌套 niri 会话（水族馆窗口消失）。",
    },
    async () => {
      await manager.stop();
      return text("agent 会话已停止");
    },
  );

  t(
    "agent_session_status",
    {
      title: "agent 会话状态",
      description: "查询 agent 会话是否在运行及其 socket/display 信息。",
    },
    async () => {
      const s = manager.info();
      return text(
        s
          ? `运行中: pid=${s.pid}, wayland=${s.waylandDisplay}, socket=${s.socket}`
          : "未运行（用 agent_session_start 启动）",
      );
    },
  );

  t(
    "agent_open_app",
    {
      title: "在 agent 会话内启动应用",
      description: '在 agent 自己的嵌套会话里启动应用（如 ["alacritty"]、["firefox"]），不影响用户桌面。',
      inputSchema: {
        command: z.array(z.string()).min(1).describe("要执行的命令及参数"),
      },
    },
    async ({ command }: { command: string[] }) => {
      await manager.openApp(command);
      return text(
        `已在 agent 会话内启动: ${command.join(" ")}（GUI 应用会随即注册到 a11y 总线，` +
          `名称通常与应用名相同——可直接用 a11y 扩展按名称操作，如 a11y_click_sequence ` +
          `连点、a11y_read_texts 读结果；不确定名称时再 a11y_list_apps 查）`,
      );
    },
  );

  t(
    "agent_list_windows",
    {
      title: "列出 agent 会话内的窗口",
      description: "列出嵌套会话里的窗口（JSON，含 id/title/app_id）。",
    },
    async () => text(JSON.stringify(await manager.windows(), null, 2)),
  );

  t(
    "agent_screenshot",
    {
      title: "截取 agent 会话屏幕",
      description:
        "对 agent 自己的嵌套会话截图（grim，只截水族馆内部，永远不会截到用户桌面），PNG 保存到 ~/Agent/screenshots/ 并返回路径。视觉理解自身 GUI 操作结果时用。截图与读取类调用（如 a11y_read_texts）相互独立，可在同一轮并行发出。水族馆启动初期画面上可能叠着 niri 的 Important Hotkeys 键位浮层——它是合成器装饰层（非应用内容、不影响 a11y 读写），关闭需要 Esc 注入；截图遇到它时如实说明即可，不必反复重试。",
      inputSchema: {
        name: z.string().optional().describe("文件名标记（可选，仅安全字符）"),
      },
    },
    async ({ name }: { name?: string }) => {
      const file = await manager.screenshot(name);
      return text(`截图已保存: ${file}`);
    },
  );

  return server;
}
