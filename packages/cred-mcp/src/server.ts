import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, ConfirmClient, audit, createGate } from "@agentos/policy";
import { BrowserClient, type BrowserDeps } from "@agentos/browser-mcp/browser";
import {
  CredBroker,
  CredError,
  DEFAULT_CRED_POLICY_PATH,
  INJECT_TTL_RANGE,
} from "./broker.js";

type ToolOk = { content: [{ type: "text"; text: string }] };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "cred";

export function buildServer(
  runner: CommandRunner = new ShellRunner(),
  policy: Policy = Policy.load(),
  brokerOpts: { secretTool?: string; policyPath?: string } = {},
  browserDeps: BrowserDeps = {},
): McpServer {
  const broker = new CredBroker(runner, brokerOpts);
  const browser = new BrowserClient(browserDeps);
  const server = new McpServer({ name: "cred-mcp", version: "0.1.0" });

  // 统一注册入口：先过策略（allow/deny/confirm + 审计 + T1 确认流），再进 handler。
  // 审计 detail 只记引用，永不记值；命令/URL 也不进 detail（避免误带查询串里的敏感参数）。
  const t = createGate({
    server,
    extension: EXT,
    policy,
    confirm: new ConfirmClient(),
    summary: (tool, args) => {
      const ref = (args as { ref?: string }).ref ?? "";
      return tool === "cred_inject" ? `${ref} ttl=${(args as { ttl_seconds?: number }).ttl_seconds}s` : ref;
    },
    detail: (_tool, args) => (args as { ref?: string }).ref ?? "",
  }) as McpServer["registerTool"];

  t(
    "cred_list",
    {
      title: "列出可用凭据",
      description:
        "列出凭据代理中的可用引用及其使用策略（开放通道、允许哪些命令、注入的环境变量名）。永远不返回凭据值。",
    },
    async () => text(JSON.stringify(await broker.list(), null, 2)),
  );

  t(
    "cred_exec",
    {
      title: "凭据代执行（通道 B）",
      description:
        "以代执行方式使用凭据：命令必须在该凭据的 exec_allow 白名单内；明文只注入子进程环境变量（变量名见 cred_list 的 env 字段），你在输出里看到的任何明文都会被打码——不要尝试 echo 它，直接让目标命令自己读取环境变量完成工作。",
      inputSchema: {
        ref: z.string().describe("凭据引用，如 vault://test/demo（先用 cred_list 查）"),
        command: z
          .array(z.string())
          .min(1)
          .describe("要执行的命令及参数（数组，不经 shell；命令须在白名单内）"),
      },
    },
    async ({ ref, command }: { ref: string; command: string[] }) => {
      const r = await broker.exec(ref, command);
      return text(
        `exit=${r.code}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
      );
    },
  );

  t(
    "cred_autofill",
    {
      title: "凭据自动填充（通道 A）",
      description:
        "把凭据自动填充到浏览器页面的密码/输入框：打开 url → 在页面内设值并派发 input/change 事件 → 明文即刻丢弃。" +
        "你只会拿到字节数与 sha256（用于与预期比对确认填充成功），永远拿不到值本身。" +
        "需要该凭据 credentials.yaml 的 allow 含 autofill。",
      inputSchema: {
        ref: z.string().describe("凭据引用，如 vault://bank/login"),
        url: z.string().describe("目标页面（http(s)/data/file URL）"),
        selector: z
          .string()
          .describe("CSS 选择器，如 #password、input[name=pwd]（须命中 input/textarea）"),
      },
    },
    async ({ ref, url, selector }: { ref: string; url: string; selector: string }) => {
      const r = await broker.autofill(ref, url, selector, browser);
      return text(
        `已填充（明文未离开 broker/页面）\nurl: ${r.url}\nselector: ${r.selector}\n长度: ${r.bytes} 字节\nsha256: ${r.sha256}`,
      );
    },
  );

  t(
    "cred_inject",
    {
      title: "凭据短期注入（通道 C）",
      description:
        `以短 TTL 把凭据注入 broker 起的 wrapper 子进程环境变量（不上命令行）：目标命令从环境变量读取（变量名见 cred_list 的 env 字段）；` +
        `TTL 到点整组进程被收割并记过期审计。ttl_seconds 须在 ${INJECT_TTL_RANGE.min}–${INJECT_TTL_RANGE.max} 之间。` +
        "命令必须在该凭据的 exec_allow 白名单内；需要 credentials.yaml 的 allow 含 inject。",
      inputSchema: {
        ref: z.string().describe("凭据引用，如 vault://github/token"),
        command: z
          .array(z.string())
          .min(1)
          .describe("要执行的命令及参数（数组，不经 shell；命令须在白名单内）"),
        ttl_seconds: z
          .number()
          .int()
          .min(INJECT_TTL_RANGE.min)
          .max(INJECT_TTL_RANGE.max)
          .describe(`凭据存活秒数（到点整组收割）`),
      },
    },
    async ({ ref, command, ttl_seconds }: { ref: string; command: string[]; ttl_seconds: number }) => {
      const r = await broker.inject(ref, command, ttl_seconds, (e) =>
        audit({
          ts: new Date().toISOString(),
          extension: EXT,
          tool: e.tool,
          decision: "allow",
          detail: e.detail,
        }),
      );
      const head = r.expired
        ? `TTL 到点已被收割（ttl=${r.ttl}s，exit=124）——凭据有效期即进程有效期`
        : `命令在 TTL 内自然退出（exit=${r.code}）`;
      return text(
        `${head}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
      );
    },
  );

  return server;
}

export { DEFAULT_CRED_POLICY_PATH };
