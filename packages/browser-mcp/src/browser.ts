import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class BrowserError extends Error {}

export interface CdpConnection {
  send(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

/** 可注入依赖（测试用） */
export interface BrowserDeps {
  port?: number;
  chromiumBin?: string;
  userDataDir?: string;
  screenshotsDir?: string;
  /** 拉起 chromium（detached），默认在水族馆的 wayland display 里 */
  launch?: (args: string[], env: Record<string, string>) => void;
  httpGetJson?: (url: string) => Promise<unknown>;
  connect?: (wsUrl: string) => Promise<CdpConnection>;
  wait?: (ms: number) => Promise<void>;
  runtimeDir?: string;
}

interface TargetInfo {
  type: string;
  webSocketDebuggerUrl?: string;
  url?: string;
}

const NIRI_SOCKET_RE = /^niri\.(wayland-\d+)\.(\d+)\.sock$/;

/** 各发行版 chromium 可执行名不一致（Fedora: chromium-browser），逐个探测 */
function detectChromiumBin(): string {
  const candidates = ["chromium", "chromium-browser", "chromium-bin", "google-chrome"];
  for (const name of candidates) {
    for (const dir of ["/usr/bin", "/usr/local/bin"]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return "chromium";
}

/**
 * 水族馆里的浏览器：Chromium + 原生 CDP（WebSocket）。
 * Firefox 已移除 CDP，故选 Chromium；零第三方依赖（Node 22 全局 WebSocket）。
 */
export class BrowserClient {
  private conn: CdpConnection | null = null;
  private readonly port: number;
  private readonly chromiumBin: string;
  private readonly userDataDir: string;
  private readonly screenshotsDir: string;
  private readonly launch: (args: string[], env: Record<string, string>) => void;
  private readonly httpGetJson: (url: string) => Promise<unknown>;
  private readonly connect: (wsUrl: string) => Promise<CdpConnection>;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly runtimeDir: string;

  constructor(deps: BrowserDeps = {}) {
    this.port = deps.port ?? 9222;
    this.chromiumBin =
      deps.chromiumBin ?? process.env["CHROMIUM_BIN"] ?? detectChromiumBin();
    this.userDataDir =
      deps.userDataDir ?? path.join(os.homedir(), ".local", "share", "agentos", "chromium");
    this.screenshotsDir =
      deps.screenshotsDir ?? path.join(os.homedir(), "Agent", "screenshots");
    this.launch =
      deps.launch ??
      ((args, env) => {
        const child = spawn(this.chromiumBin, args, {
          stdio: "ignore",
          detached: true,
          env: { ...process.env, ...env },
        });
        child.unref();
      });
    this.httpGetJson = deps.httpGetJson ?? (async (url) => (await fetch(url)).json() as unknown);
    this.connect =
      deps.connect ??
      (async (wsUrl) => {
        const ws = new WebSocket(wsUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new BrowserError(`CDP WebSocket 连接失败: ${wsUrl}`));
        });
        let nextId = 1;
        const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
            if (msg.id != null) {
              const p = pending.get(msg.id);
              if (p) {
                pending.delete(msg.id);
                if (msg.error) p.reject(new BrowserError(`CDP 错误: ${msg.error.message ?? "?"}`));
                else p.resolve(msg.result);
              }
            }
          } catch {
            // 事件通知，忽略
          }
        };
        return {
          send(method: string, params: unknown = {}) {
            const id = nextId++;
            ws.send(JSON.stringify({ id, method, params }));
            return new Promise<unknown>((resolve, reject) => {
              pending.set(id, { resolve, reject });
              setTimeout(() => {
                if (pending.delete(id)) reject(new BrowserError(`CDP 调用超时: ${method}`));
              }, 15_000);
            });
          },
          close() {
            ws.close();
          },
        };
      });
    this.wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.runtimeDir =
      deps.runtimeDir ?? process.env["XDG_RUNTIME_DIR"] ?? `/run/user/${process.getuid?.() ?? 1000}`;
  }

  /** 确保浏览器已启动并连上第一个 page target */
  async ensure(): Promise<void> {
    if (this.conn) return;
    if (!(await this.devtoolsUp())) {
      await this.launchInAquarium();
      for (let i = 0; i < 40; i++) {
        await this.wait(500);
        if (await this.devtoolsUp()) break;
      }
      if (!(await this.devtoolsUp())) {
        throw new BrowserError("Chromium 启动后 20 秒内 CDP 端口未就绪");
      }
    }
    const target = await this.firstPageTarget();
    this.conn = await this.connect(target.webSocketDebuggerUrl!);
  }

  async open(url: string): Promise<string> {
    const c = await this.connection();
    try {
      await c.send("Page.navigate", { url });
    } catch {
      // 跨站导航会交换渲染进程、销毁当前 target，navigate 响应可能永不到达——
      // 忽略，靠下面的重新发现目标恢复连接
    }
    await this.wait(1500); // 等初步加载
    // target 可能已更换（OOPIF/站点隔离），强制重连
    this.conn?.close();
    this.conn = null;
    await this.ensure();
    const info = (await this.eval("location.href")) as { value?: unknown };
    return `已导航: ${String(info?.value ?? url)}`;
  }

  async eval(js: string): Promise<unknown> {
    const c = await this.connection();
    const r = (await c.send("Runtime.evaluate", {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: unknown; description?: string; subtype?: string } };
    const value = r.result?.value ?? r.result?.description ?? null;
    return { value };
  }

  /** CDP 整页截图，PNG 存工作区，返回路径 */
  async screenshot(name?: string): Promise<string> {
    const c = await this.connection();
    const r = (await c.send("Page.captureScreenshot", { format: "png" })) as { data?: string };
    if (!r.data) throw new BrowserError("截图失败：无数据返回");
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    const safe = (name ?? "").replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 80);
    const file = path.join(
      this.screenshotsDir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}${safe ? `-${safe}` : ""}-web.png`,
    );
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  async close(): Promise<void> {
    this.conn?.close();
    this.conn = null;
  }

  private async connection(): Promise<CdpConnection> {
    await this.ensure();
    return this.conn!;
  }

  private async devtoolsUp(): Promise<boolean> {
    try {
      await this.httpGetJson(`http://127.0.0.1:${this.port}/json/version`);
      return true;
    } catch {
      return false;
    }
  }

  private async firstPageTarget(): Promise<TargetInfo> {
    const list = (await this.httpGetJson(`http://127.0.0.1:${this.port}/json`)) as TargetInfo[];
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new BrowserError("没有可用的 page target");
    return page;
  }

  /** 在水族馆（嵌套 niri 会话）里拉起 Chromium；display 通过 IPC socket 差集自动发现 */
  private async launchInAquarium(): Promise<void> {
    const current = process.env["WAYLAND_DISPLAY"] ?? "wayland-1";
    let aquarium: string | null = null;
    try {
      for (const name of fs.readdirSync(this.runtimeDir)) {
        const m = NIRI_SOCKET_RE.exec(name);
        if (m && m[1] !== current) {
          aquarium = m[1] ?? null;
          break;
        }
      }
    } catch {
      // runtime dir 不可读
    }
    if (!aquarium) {
      throw new BrowserError("未发现水族馆（agent 会话）——先用 session__agent_session_start 启动");
    }
    fs.mkdirSync(this.userDataDir, { recursive: true });
    this.launch(
      [
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${this.userDataDir}`,
        // 关键：headless/服务化环境必须跳过钥匙环——Chromium 经 libsecret 解密 Cookie，
        // 钥匙环锁定时网络服务会阻塞等待解锁对话框，表现为一切 http/https 导航挂死
        // （data: URL 正常的假象即来源于此，实测 2026-10-16）
        "--password-store=basic",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--ozone-platform-hint=auto",
        "--window-size=1200,860",
        "about:blank",
      ],
      { WAYLAND_DISPLAY: aquarium },
    );
  }
}
