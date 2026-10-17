import { audit, type AuditEntry, type PolicyVerdict } from "./policy.js";
import type { Policy } from "./policy.js";
import { ConfirmClient, summarizeArgs } from "./confirm.js";

/**
 * MCP server 的统一注册入口（各 server 原有 `t` 包装层的 v1 版）。
 * 结构上不依赖 MCP SDK：只要求 server 有 registerTool（结构类型）。
 *
 * 流程：policy.decide → 审计（含 tier/confirm 扩字段）→
 *   deny   → isError 拒绝（原文案不变）；
 *   confirm→ ConfirmClient.ask（mako 通知按钮 / Respond / 30s 超时），
 *            allow_once/allow_session 放行，deny_once/always_deny 拒绝；
 *   allow  → 直接执行。
 */
export interface GateServer {
  // cb 用 any：McpServer.registerTool 的泛型/重载签名无法被收窄签名结构匹配
  registerTool(name: string, config: any, cb: any): unknown;
}

export interface GateOptions {
  server: GateServer;
  extension: string;
  policy: Policy;
  /** 确认客户端；不传则 confirm 决策一律按"服务不可用"拒绝（安全默认） */
  confirm?: ConfirmClient;
  /** 确认通知的参数摘要（给用户看，必须脱敏——只放引用/路径/数量，不放内容） */
  summary?: (tool: string, args: unknown) => string;
  /** 审计 detail 字段（沿用各 server 原有语义，如 cred 记 ref） */
  detail?: (tool: string, args: unknown) => string;
  /** confirm 决策的档位标注（t1 默认；T2 工具传 "t2"） */
  tier?: string;
  /** 声明"确认由工具内部承担"的工具（T2：polkit 强认证）——网关不再走 Confirm1，
   *  直接放行进 handler，审计记 confirm.result="delegated"。 */
  delegatedConfirm?: (tool: string) => boolean;
}

export type ToolResult =
  | { content: [{ type: "text"; text: string }] }
  | { content: [{ type: "text"; text: string }]; isError: true };

/** 返回给 server 的注册函数形态（cb 参数收窄到具体 args 类型的 handler 也能传入） */
export type ToolRegistrar = (name: string, config: any, cb: (args: any) => Promise<any>) => unknown;

export function createGate(o: GateOptions): ToolRegistrar {
  return ((name: string, config: unknown, cb: (args: unknown) => Promise<unknown>) =>
    o.server.registerTool(name, config, async (args: unknown): Promise<ToolResult> => {
      async function runHandler(): Promise<ToolResult> {
        try {
          return (await cb(args)) as ToolResult;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      }
      const verdict = o.policy.decide(o.extension, name);
      const entry: AuditEntry = {
        ts: new Date().toISOString(),
        extension: o.extension,
        tool: name,
        decision: verdict.decision,
      };
      const detail = o.detail?.(name, args);
      if (detail !== undefined) entry.detail = detail;

      if (verdict.decision === "deny") {
        audit(entry);
        return policyRefusal(o.extension, name, verdict);
      }
      if (verdict.decision === "confirm") {
        entry.tier = o.tier ?? "t1";
        if (o.delegatedConfirm?.(name)) {
          // T2：确认由 handler 内的 polkit 认证承担（permissions.md §4.2）
          entry.confirm = { asked: true, result: "delegated", by: "polkit" };
          audit(entry);
          return runHandler();
        }
        if (!o.confirm) {
          entry.confirm = { asked: false, result: "deny_once", by: "no-confirm-client" };
          audit(entry);
          return {
            content: [
              {
                type: "text" as const,
                text: `策略要求确认 ${o.extension}.${name}，但本 server 未配置确认通道（org.agentos.Confirm1）。安全默认：拒绝执行。`,
              },
            ],
            isError: true,
          };
        }
        const outcome = await o.confirm.ask(
          o.extension,
          name,
          o.summary?.(name, args) ?? summarizeArgs(args),
          entry.tier,
        );
        entry.confirm = {
          asked: outcome.by !== "session-memory",
          result: outcome.choice,
          by: outcome.by,
          response_ms: outcome.responseMs,
        };
        audit(entry);
        if (outcome.choice !== "allow_once" && outcome.choice !== "allow_session") {
          if (outcome.unavailable) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `需要用户确认 ${o.extension}.${name}，但确认服务 org.agentos.Confirm1 不可用（systemctl --user status agentos-confirm）。安全默认：拒绝执行。`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `用户未批准 ${o.extension}.${name}（选择: ${outcome.choice}）。${outcome.choice === "always_deny" ? "已写入 policy.yaml，后续同类调用将被策略直接拒绝。" : "可再次发起并说明理由，由用户重新选择。"}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        audit(entry);
      }

      return runHandler();
    })) as ToolRegistrar;
}

function policyRefusal(extension: string, name: string, verdict: PolicyVerdict): ToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: `策略拒绝 ${extension}.${name}（${verdict.reason}）。可在 ~/.config/agentos/policy.yaml 调整。`,
      },
    ],
    isError: true,
  };
}
