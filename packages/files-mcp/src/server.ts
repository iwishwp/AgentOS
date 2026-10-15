import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Policy, audit } from "@agentos/policy";
import { FilesError, Workspace } from "./workspace.js";

type ToolOk = { content: [{ type: "text"; text: string }] };
type ToolResult = ToolOk | { content: [{ type: "text"; text: string }]; isError: true };

async function guard(fn: () => Promise<ToolOk>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof FilesError || e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function text(t: string): ToolOk {
  return { content: [{ type: "text", text: t }] };
}

const relPath = z.string().min(1).describe("相对工作区根目录的路径（~/Agent）");

export function buildServer(ws = new Workspace(), policy: Policy = Policy.load()): McpServer {
  const server = new McpServer({ name: "files-mcp", version: "0.1.0" });

  // 统一注册入口：先过策略（allow/deny + 审计），再进 handler
  const EXT = "files";
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
    "list_dir",
    {
      title: "列目录",
      description: `列出工作区（${ws.root}）内目录内容。所有文件工具都只在这个沙箱内工作。`,
      inputSchema: { path: relPath.optional().describe("默认根目录") },
    },
    async ({ path: p }) => guard(async () => text(ws.listDir(p ?? "."))),
  );

  t(
    "read_file",
    {
      title: "读文件",
      description: "读取工作区内文本文件（默认上限 64KB，最大 1MB）。",
      inputSchema: {
        path: relPath,
        maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
      },
    },
    async ({ path: p, maxBytes }) =>
      guard(async () => text(ws.readFile(p, maxBytes))),
  );

  t(
    "write_file",
    {
      title: "写文件",
      description: "写入文本文件（自动创建父目录，覆盖已有内容）。任务产物统一落在工作区。",
      inputSchema: {
        path: relPath,
        content: z.string().describe("文件内容（UTF-8 文本）"),
      },
    },
    async ({ path: p, content }) =>
      guard(async () => text(`已写入 ${p}（${ws.writeFile(p, content)} 字节）`)),
  );

  t(
    "create_dir",
    {
      title: "建目录",
      description: "创建目录（含父目录）。",
      inputSchema: { path: relPath },
    },
    async ({ path: p }) => guard(async () => {
      ws.createDir(p);
      return text(`已创建目录 ${p}`);
    }),
  );

  t(
    "move",
    {
      title: "移动/重命名",
      description: "移动或重命名工作区内的文件/目录（目标不能已存在）。",
      inputSchema: { src: relPath, dst: relPath },
    },
    async ({ src, dst }) =>
      guard(async () => {
        ws.move(src, dst);
        return text(`已移动 ${src} → ${dst}`);
      }),
  );

  t(
    "delete",
    {
      title: "删除（进回收站）",
      description: "删除工作区内文件/目录——实际移入工作区 .trash/，可恢复，不是不可逆删除。",
      inputSchema: { path: relPath },
    },
    async ({ path: p }) =>
      guard(async () => text(`已移入回收站: ${ws.delete(p)}`)),
  );

  t(
    "download",
    {
      title: "下载文件",
      description: "下载 http/https 资源保存到工作区（上限 50MB，60 秒超时）。URL 必须以 http(s):// 开头。",
      inputSchema: {
        url: z.string().url().describe("下载地址"),
        path: relPath.describe("保存到工作区的相对路径"),
      },
    },
    async ({ url, path: p }) =>
      guard(async () => {
        const r = await ws.download(url, p);
        return text(`已下载 ${p}（${r.bytes} 字节）`);
      }),
  );

  t(
    "find_by_name",
    {
      title: "按名称查找",
      description: "按名称子串递归查找工作区内的文件/目录（大小写不敏感，跳过 .trash）。",
      inputSchema: {
        pattern: z.string().min(1),
        limit: z.number().int().min(1).max(500).default(200),
      },
    },
    async ({ pattern, limit }) =>
      guard(async () => {
        const hits = ws.findByName(pattern, limit);
        return text(hits.length === 0 ? "（无匹配）" : hits.join("\n"));
      }),
  );

  return server;
}
