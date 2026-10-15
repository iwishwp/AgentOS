import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import { SystemClient, SystemError, type PackageManager } from "./system.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

async function guard(fn: () => Promise<ToolOk>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof SystemError || e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const pkgManager = z
  .enum(["rpm", "pacman"])
  .default("rpm")
  .describe("包管理器：rpm(Fedora 系) / pacman(Arch 系)");

export function buildServer(runner: CommandRunner = new ShellRunner()): McpServer {
  const server = new McpServer({ name: "system-mcp", version: "0.1.0" });
  const system = new SystemClient(runner);

  server.registerTool(
    "system_status",
    {
      title: "系统资源概况",
      description: "只读查询：开机时长、内存、根分区磁盘占用。用户问“电脑状态怎么样”先调这个。",
    },
    async () => guard(async () => text(await system.status())),
  );

  server.registerTool(
    "list_services",
    {
      title: "列出服务",
      description: "列出 systemd 服务（只读）。默认 running，可选 failed（排查故障）或 all。",
      inputSchema: {
        state: z.enum(["running", "failed", "all"]).default("running"),
      },
    },
    async ({ state }) => guard(async () => text(await system.services(state))),
  );

  server.registerTool(
    "service_status",
    {
      title: "查单个服务状态",
      description: "查询单个 systemd 服务的状态（ActiveState/SubState/是否开机自启等，只读）。",
      inputSchema: {
        name: z.string().min(1).describe("服务单元名，如 sshd、niri.service"),
      },
    },
    async ({ name }) => guard(async () => text(await system.serviceStatus(name))),
  );

  server.registerTool(
    "journal",
    {
      title: "读服务日志",
      description:
        "读取 systemd 服务日志（只读）。user=true 查用户级服务（如 niri、goose）；系统级日志受 journal 权限限制，看不到时提示用户加组。",
      inputSchema: {
        unit: z.string().min(1).describe("单元名，如 niri、sshd"),
        lines: z.number().int().min(1).max(500).default(50).describe("行数，默认 50"),
        user: z.boolean().default(false).describe("是否用户级服务"),
      },
    },
    async ({ unit, lines, user }) =>
      guard(async () => text(await system.journal(unit, lines, user))),
  );

  server.registerTool(
    "list_packages",
    {
      title: "列出已装包",
      description: "列出已安装的包（只读），支持按子串过滤。判断某软件是否已装时用。",
      inputSchema: {
        query: z.string().optional().describe("过滤子串，如 niri"),
        limit: z.number().int().min(1).max(500).default(100),
        pkg: pkgManager,
      },
    },
    async ({ pkg, query, limit }) =>
      guard(async () => text(await system.packages(pkg, query, limit))),
  );

  server.registerTool(
    "package_info",
    {
      title: "查包详情",
      description: "查询包的详细信息（版本、仓库、大小，只读）：Fedora 用 dnf info，Arch 用 pacman -Si。",
      inputSchema: {
        name: z.string().min(1),
        pkg: pkgManager,
      },
    },
    async ({ pkg, name }) => guard(async () => text(await system.packageInfo(pkg, name))),
  );

  server.registerTool(
    "network_info",
    {
      title: "网络接口",
      description: "列出网络接口与 IP（ip -br addr，只读）。",
    },
    async () => guard(async () => text(await system.network())),
  );

  return server;
}
