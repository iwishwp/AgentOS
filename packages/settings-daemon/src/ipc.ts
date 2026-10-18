/**
 * ipc.ts —— D-Bus API：org.agentos.Settings @ /org/agentos/settings
 *   属性: darkMode(b, read) / paletteVariant(s, read)
 *   方法: Apply(s variant) → b   （dark|light|auto）
 *          Reload() → b
 *   信号: Changed(s variant)
 * 纯 JS 的 dbus-next（无原生依赖），成员经 configureMembers 注册（非装饰器）。
 * D-Bus 起不来时降级为 unix socket JSON API（$XDG_RUNTIME_DIR/agentos-settings.sock，
 * 行协议 {"method":"Apply","params":{...}} → {"ok":true,...}）——socket 通道始终可用，
 * 供 CLI status/无 dbus 工具的环境使用；transport 字段如实记录实际生效通道。
 */
import * as dbus from "dbus-next";
import { createServer, type Server, type Socket } from "node:net";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

export interface IpcHandlers {
  getDarkMode(): boolean;
  getPaletteVariant(): "dark" | "light";
  /** 返回 ok=false 时带 detail 作为 DBusError 文本 */
  apply(variant: string): Promise<{ ok: boolean; detail?: string }>;
  reload(): Promise<{ ok: boolean; detail?: string }>;
}

export interface IpcServer {
  transport: "dbus+socket" | "socket-only";
  /** 应用成功后广播 Changed(s variant) 信号（D-Bus 不可用时为 no-op） */
  emitChanged(variant: string): void;
  close(): Promise<void>;
}

class SettingsInterface extends dbus.interface.Interface {
  constructor(private readonly h: IpcHandlers) {
    super("org.agentos.Settings");
  }

  get darkMode(): boolean {
    return this.h.getDarkMode();
  }

  get paletteVariant(): string {
    return this.h.getPaletteVariant();
  }

  async Apply(variant: string): Promise<boolean> {
    const r = await this.h.apply(variant);
    if (!r.ok) throw new dbus.DBusError("org.agentos.Settings.Error", r.detail ?? "apply 失败");
    return true;
  }

  async Reload(): Promise<boolean> {
    const r = await this.h.reload();
    if (!r.ok) throw new dbus.DBusError("org.agentos.Settings.Error", r.detail ?? "reload 失败");
    return true;
  }

  /** 信号（configureMembers 包装为 emit：调用即广播） */
  async Changed(variant: string): Promise<string> {
    return variant;
  }
}

// 非装饰器注册（dbus-next 的 configureMembers，避免 TS 装饰器配置）
SettingsInterface.configureMembers({
  properties: {
    darkMode: { signature: "b", access: "read" },
    paletteVariant: { signature: "s", access: "read" },
  },
  methods: {
    Apply: { inSignature: "s", outSignature: "b" },
    Reload: { inSignature: "", outSignature: "b" },
  },
  signals: { Changed: { signature: "s" } },
});

export const DBUS_NAME = "org.agentos.Settings";
export const DBUS_PATH = "/org/agentos/settings";

export async function serveIpc(h: IpcHandlers, socketPath: string): Promise<IpcServer> {
  // ---- 通道 1：unix socket JSON（始终开）----
  await startSocketServer(h, socketPath).catch(() => undefined); // 端口被旧实例占住时容忍（systemd 重启竞态）

  // ---- 通道 2：D-Bus（尽力；失败降级 socket-only）----
  let dbusOk = false;
  let iface: SettingsInterface | null = null;
  try {
    const bus = dbus.sessionBus();
    if (!bus) throw new Error("session bus 不可用");
    bus.on("error", () => {}); // 连接失败异步报错时降级，不让进程崩
    iface = new SettingsInterface(h);
    bus.export(DBUS_PATH, iface);
    const flags = 2 | 4; // REPLACE_EXISTING | DO_NOT_QUEUE
    const result = await bus.requestName(DBUS_NAME, flags);
    if (result !== 1) {
      // 1 = PRIMARY_OWNER；拿不到主属就撤下导出，走 socket-only
      bus.disconnect();
      throw new Error(`requestName 返回 ${result}`);
    }
    process.on("exit", () => bus.disconnect());
    dbusOk = true;
  } catch {
    dbusOk = false;
  }
  const ifaceRef = iface;

  return {
    transport: dbusOk ? "dbus+socket" : "socket-only",
    emitChanged(variant: string) {
      // dbus-next：调用被 @signal/configureMembers 包装的方法即广播信号
      void ifaceRef?.Changed(variant);
    },
    async close() {
      await stopSocketServer(socketPath);
    },
  };
}

// ---- socket 实现 ----
let server: Server | null = null;

async function startSocketServer(h: IpcHandlers, socketPath: string): Promise<void> {
  await unlink(socketPath).catch(() => undefined);
  server = createServer((sock: Socket) => {
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const reply = await handleJson(h, line);
        sock.write(JSON.stringify(reply) + "\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(socketPath, resolve);
  });
}

async function handleJson(h: IpcHandlers, line: string): Promise<unknown> {
  try {
    const req = JSON.parse(line) as { method?: string; params?: Record<string, string> };
    switch (req.method) {
      case "Get":
        return { ok: true, darkMode: h.getDarkMode(), paletteVariant: h.getPaletteVariant() };
      case "Apply": {
        const r = await h.apply(req.params?.variant ?? "auto");
        return r;
      }
      case "Reload":
        return await h.reload();
      default:
        return { ok: false, detail: `未知方法: ${req.method ?? "(空)"}` };
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function stopSocketServer(socketPath: string): Promise<void> {
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  await unlink(socketPath).catch(() => undefined);
}

/** CLI/测试用：向 socket 发一行 JSON 请求 */
export async function socketCall(socketPath: string, method: string, params?: Record<string, string>): Promise<unknown> {
  const { connect } = await import("node:net");
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    let out = "";
    sock.on("connect", () => sock.write(JSON.stringify({ method, params }) + "\n"));
    sock.on("data", (d) => {
      out += d.toString("utf8");
      if (out.includes("\n")) {
        sock.end();
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          reject(e);
        }
      }
    });
    sock.on("error", reject);
    setTimeout(() => {
      sock.destroy();
      reject(new Error(`socket 超时: ${socketPath}`));
    }, 3000);
  });
}

export { SettingsInterface };
export const socketDefaultPath = (runtimeDir: string) => join(runtimeDir, "agentos-settings.sock");
