import os from "node:os";
import path from "node:path";

/**
 * 动作型通知（M2 收尾）："查看产物"等通知动作。
 *
 * Fedora mako 1.11 不渲染通知动作按钮（M4 实测，permissions.md §4.1）——
 * actions 数组里只有 default（整条通知的默认动作）有意义：**点击通知本体
 * 即触发 ActionInvoked(id, "default")**。notify-send 不支持 actions，所以
 * 这里用一个内联 python3 shim（gi/Gio，与 os/dbus/agentos-confirm.py 同一
 * 模式：发 Notify + 监听 ActionInvoked/NotificationClosed）。shim 嵌在 TS 里
 * 而不是单独部署文件，避免发行路径分叉。
 */
export type NotifyAction = { kind: "open_url"; url: string } | { kind: "open_path"; path: string };

export class NotifyActionError extends Error {}

/** 只认 http(s)：URL 会拼进 chromium 参数，其他 scheme（file:/chrome:/--flag）一律拒 */
const URL_RE = /^https?:\/\/\S+$/i;

/** open_path 相对路径的解析基准（files 扩展 Workspace 同一约定） */
export function defaultWorkspaceRoot(): string {
  return process.env["AGENTOS_WORKSPACE"] ?? path.join(os.homedir(), "Agent");
}

/** 校验并规整动作参数（非法 kind/URL/路径直接抛 NotifyActionError，拒绝在审计之前） */
export function parseNotifyAction(raw: unknown): NotifyAction {
  if (typeof raw !== "object" || raw === null) {
    throw new NotifyActionError("action 需要 {kind, url|path} 对象");
  }
  const r = raw as Record<string, unknown>;
  if (r["kind"] === "open_url") {
    const url = String(r["url"] ?? "");
    if (!URL_RE.test(url)) {
      throw new NotifyActionError(`open_url 只接受 http/https URL: ${url}`);
    }
    return { kind: "open_url", url };
  }
  if (r["kind"] === "open_path") {
    const p = String(r["path"] ?? "");
    if (p.trim() === "") {
      throw new NotifyActionError("open_path 需要非空 path（工作区相对路径或绝对路径）");
    }
    if (p.startsWith("-")) {
      throw new NotifyActionError("open_path 不接受以 - 开头的路径（防参数注入）");
    }
    return { kind: "open_path", path: p };
  }
  throw new NotifyActionError(`未知 action.kind: ${String(r["kind"])}（支持 open_url/open_path）`);
}

/** 动作的目标描述（正文提示与审计 detail 共用） */
export function actionTarget(action: NotifyAction): string {
  return action.kind === "open_url" ? action.url : action.path;
}

/** office 扩展名：xdg-open 的 MIME 关联不可靠（M1 实测 fodt→text/xml），直接走 soffice */
export const OFFICE_EXTS = new Set([
  ".fodt", ".fodp", ".fods", ".odt", ".odp", ".ods",
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
]);

/** open_path 落到打开目标：相对路径 = 工作区内（agent 产物都在那里） */
export function resolveOpenPath(p: string, workspaceRoot = defaultWorkspaceRoot()): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.join(workspaceRoot, p);
}

/** chromium 应用窗口参数（--password-store=basic：keyring 锁死网络栈的 M3 教训） */
export function chromiumAppArgs(url: string): string[] {
  return [`--app=${url}`, "--password-store=basic"];
}

/**
 * D-Bus 会话总线环境兜底（goose 经 systemd user service 跑时已有；ssh 直跑时补上）。
 * 与 @agentos/policy confirm.ts 的 dbusEnv 同款。
 */
export function dbusEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!process.env["XDG_RUNTIME_DIR"]) {
    env["XDG_RUNTIME_DIR"] = `/run/user/${process.getuid?.() ?? 1000}`;
  }
  if (!process.env["DBUS_SESSION_BUS_ADDRESS"]) {
    env["DBUS_SESSION_BUS_ADDRESS"] = `unix:path=${env["XDG_RUNTIME_DIR"] ?? process.env["XDG_RUNTIME_DIR"]}/bus`;
  }
  return env;
}

export interface NotifyShimParams {
  summary: string;
  body?: string;
  urgency: "low" | "normal" | "critical";
  timeoutMs?: number;
  /** ActionInvoked 的最长等待（毫秒）：mako 对 critical 不过期，需要看门狗收尾 */
  waitMs: number;
}

/**
 * python3 D-Bus shim：stdin 收 JSON 参数 → 发带 default 动作的通知 →
 * stdout 逐行回事件 JSON：
 *   {"sent": true,  "id": N}                      发送成功（Notify 返回 id）
 *   {"sent": false, "error": "..."}               发送失败（触发降级路径）
 *   {"invoked": true}                             用户点击了通知（默认动作）
 *   {"invoked": false, "reason": "expired|dismissed|timeout"}  通知消亡未点击
 * 任一终态（invoked 或 closed）后进程退出；看门狗超时会主动 CloseNotification。
 */
export const NOTIFY_SHIM_PY = String.raw`
import json, sys
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

params = json.load(sys.stdin)
loop = GLib.MainLoop()
state = {"id": None, "done": False}

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
notify = Gio.DBusProxy.new_sync(
    bus, Gio.DBusProxyFlags.NONE, None,
    "org.freedesktop.Notifications", "/org/freedesktop/Notifications",
    "org.freedesktop.Notifications", None)
if notify is None or notify.get_name_owner() is None:
    emit({"sent": False, "error": "no notification daemon"})
    sys.exit(0)

URGENCY = {"low": 0, "normal": 1, "critical": 2}

def finish(obj):
    if state["done"]:
        return
    state["done"] = True
    emit(obj)
    loop.quit()

def on_signal(proxy, sender, signal, sparams):
    if state["id"] is None or state["done"]:
        return
    args = sparams.unpack()
    if signal == "ActionInvoked" and args[0] == state["id"]:
        finish({"invoked": True})  # mako 无按钮：点击通知本体即 default 动作
    elif signal == "NotificationClosed" and args[0] == state["id"]:
        reason = {1: "expired", 2: "dismissed", 3: "closed", 4: "ignored"}.get(args[1], "closed")
        finish({"invoked": False, "reason": reason})

def on_watchdog():
    nid = state["id"]
    if nid is not None and not state["done"]:
        try:
            notify.CloseNotification("(u)", nid)  # 不留横幅残骸
        except Exception:
            pass
    finish({"invoked": False, "reason": "timeout"})
    return False

notify.connect("g-signal", on_signal)
try:
    nid = notify.Notify(
        "(susssasa{sv}i)",
        "AgentOS", 0, "dialog-information",
        params["summary"], params.get("body") or "",
        ["default", params.get("action_label") or "打开"],
        {"urgency": GLib.Variant("y", URGENCY.get(params["urgency"], 1))},
        params.get("timeout_ms", -1))
except Exception as e:
    emit({"sent": False, "error": str(e)})
    sys.exit(0)
state["id"] = nid
emit({"sent": True, "id": int(nid)})
GLib.timeout_add(params["wait_ms"], on_watchdog)
loop.run()
`;
