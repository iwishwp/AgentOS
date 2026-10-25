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
const appArg = z
  .string()
  .min(1)
  .describe("a11y 总线上的应用名（不确定时先用 a11y_list_apps 查）");

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
        "探索界面的首选：默认返回可交互元素扁平清单（名称+角色+值非空文本，如全部按钮名/输入框），一跳拿到可点清单后直接按名称操作，不要为了找按钮名倒全树。interactive_only=false 才输出完整嵌套树（结构分析用，token 量大，配合 compact=1 精简）。操作一律按名称寻址（a11y_click/a11y_click_sequence），索引路径跨调用不可用。",
      inputSchema: {
        app: appArg,
        depth: z.number().int().min(1).max(16).default(16),
        interactive_only: z
          .boolean()
          .default(true)
          .describe("true=可交互元素扁平清单（默认，省 token）；false=完整嵌套树"),
        roles: z
          .string()
          .optional()
          .describe("角色白名单（逗号分隔，如 'button,toggle button'），给定后替代默认可交互判定"),
        compact: z
          .boolean()
          .default(false)
          .describe("interactive_only=false 时的精简树：去 states/actions、叶子文本并入父节点"),
      },
    },
    async (args: {
      app: string;
      depth: number;
      interactive_only: boolean;
      roles?: string;
      compact: boolean;
    }) => {
      const roles = args.roles
        ?.split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      return text(
        JSON.stringify(
          await bridge.tree(args.app, args.depth, {
            interactiveOnly: args.interactive_only,
            roles,
            compact: args.compact,
          }),
          null,
          2,
        ),
      );
    },
  );

  t(
    "a11y_click",
    {
      title: "按名称点击按钮",
      description:
        "在应用里按 accessible 名称点击单个按钮（AT-SPI2，无需焦点、不打扰用户）。例如 a11y_click('gnome-calculator', '7')。连续点击多个已知名称的控件用 a11y_click_sequence 一次完成。",
      inputSchema: {
        app: appArg,
        buttonName: z.string().min(1).describe("按钮名称（来自 dump_tree 可点清单或界面标签）"),
      },
    },
    async ({ app, buttonName }: { app: string; buttonName: string }) =>
      text(JSON.stringify(await bridge.click(app, buttonName))),
  );

  t(
    "a11y_click_sequence",
    {
      title: "按名称连点多个控件",
      description:
        "按序点击多个已知名称的控件：一次调用完成整串（服务端循环，逐步结果数组返回），适合连续操作已知名称的控件序列——计算器按键、多步表单、向导页等。比逐个 a11y_click 快得多（N 次模型往返变 1 次）。控件名已知（任务给出或界面常识，如计算器的数字/运算符按键名）时可直接调用，不必先 dump_tree 验证；某步找不到名称会停在该步并返回已完成部分。",
      inputSchema: {
        app: appArg,
        names: z
          .array(z.string().min(1))
          .min(1)
          .max(32)
          .describe("按点击顺序排列的控件名称数组（来自 dump_tree 可点清单或界面标签）"),
      },
    },
    async ({ app, names }: { app: string; names: string[] }) => {
      const r = (await bridge.clickSequence(app, names)) as { clicked?: number };
      const hint =
        (r?.clicked ?? 0) > 0
          ? "（提示：读结果 a11y_read_texts 与留证 agent_screenshot 相互独立，可同轮并行发出）"
          : "";
      return text(JSON.stringify(r, null, 2) + (hint ? `\n${hint}` : ""));
    },
  );

  t(
    "a11y_read_texts",
    {
      title: "读应用内文本",
      description:
        "读取应用全部非空文本节点（显示屏/结果/标签值）。读计算结果、表单当前值都用它。与截图类调用相互独立，可在同一轮并行发出。",
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
