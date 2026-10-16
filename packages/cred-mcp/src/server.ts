import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { Policy, audit } from "@agentos/policy";
import { CredBroker, CredError, DEFAULT_CRED_POLICY_PATH } from "./broker.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const EXT = "cred";

export function buildServer(
  runner: CommandRunner = new ShellRunner(),
  policy: Policy = Policy.load(),
  brokerOpts: { secretTool?: string; policyPath?: string } = {},
): McpServer {
  const broker = new CredBroker(runner, brokerOpts);
  const server = new McpServer({ name: "cred-mcp", version: "0.1.0" });

  const t = ((name: string, config: Parameters<McpServer["registerTool"]>[1], cb: any) =>
    server.registerTool(name, config, async (args: unknown) => {
      const verdict = policy.decide(EXT, name);
      // 审计只记引用与命令，永不记值
      const a = args as { ref?: string; command?: string[] };
      audit({
        ts: new Date().toISOString(),
        extension: EXT,
        tool: name,
        decision: verdict.decision,
        detail: a.ref ?? "",
      });
      if (verdict.decision === "deny") {
        return {
          content: [{ type: "text" as const, text: `策略拒绝 ${EXT}.${name}（${verdict.reason}）。可在 ~/.config/agentos/policy.yaml 调整。` }],
          isError: true,
        };
      }
      try {
        return await cb(args);
      } catch (e) {
        const message = e instanceof CredError || e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    })) as McpServer["registerTool"];

  t(
    "cred_list",
    {
      title: "列出可用凭据",
      description:
        "列出凭据代理中的可用引用及其使用策略（允许哪些命令、注入的环境变量名）。永远不返回凭据值。",
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

  return server;
}

export { DEFAULT_CRED_POLICY_PATH };
