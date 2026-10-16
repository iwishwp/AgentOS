import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner } from "@agentos/proc";
import { NiriClient } from "@agentos/niri-mcp/niri";

export class SessionError extends Error {}

export interface AgentSessionInfo {
  pid: number;
  /** 嵌套会话的 IPC socket 绝对路径 */
  socket: string;
  /** 嵌套会话的 Wayland display（如 wayland-2） */
  waylandDisplay: string;
}

/** 可注入依赖，便于测试 */
export interface SessionDeps {
  runtimeDir?: string;
  runner: CommandRunner;
  /** 真实实现：后台拉起嵌套 niri 并返回 pid */
  launch?: () => number;
  listSockets?: (dir: string) => SocketFile[];
  wait?: (ms: number) => Promise<void>;
  screenshotsDir?: string;
}

const NIRI_SOCKET_RE = /^niri\.(wayland-\d+)\.(\d+)\.sock$/;

/**
 * agent 会话（"水族馆"）管理器：在用户桌面里以窗口形式跑一个嵌套 niri，
 * agent 的 GUI 操作全部发生在这个会话里——不碰用户的输入焦点。
 * 嵌套会话有自己独立的 IPC socket 与 Wayland display。
 */
export class AgentSessionManager {
  private session: AgentSessionInfo | null = null;
  private readonly runtimeDir: string;
  private readonly runner: CommandRunner;
  private readonly launch: () => number;
  private readonly listSockets: (dir: string) => SocketFile[];
  private readonly wait: (ms: number) => Promise<void>;
  private readonly screenshotsDir: string;

  constructor(deps: SessionDeps) {
    this.runner = deps.runner;
    this.runtimeDir = deps.runtimeDir ?? process.env["XDG_RUNTIME_DIR"] ?? `/run/user/${process.getuid?.() ?? 1000}`;
    this.listSockets = deps.listSockets ?? ((dir) => listNiriSockets(dir));
    this.wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.screenshotsDir = deps.screenshotsDir ?? path.join(os.homedir(), "Agent", "screenshots");
    this.launch =
      deps.launch ??
      (() => {
        // 嵌套 niri：在当前 Wayland 会话里作为窗口运行
        const wayland = process.env["WAYLAND_DISPLAY"];
        if (!wayland) {
          throw new SessionError("没有 WAYLAND_DISPLAY——session-mcp 必须在图形会话环境内运行");
        }
        const child = spawn("niri", [], {
          stdio: "ignore",
          detached: true,
          env: { ...process.env, WAYLAND_DISPLAY: wayland },
        });
        child.unref();
        return child.pid ?? -1;
      });
  }

  info(): AgentSessionInfo | null {
    return this.session;
  }

  async start(): Promise<AgentSessionInfo> {
    if (this.session && this.isSocketAlive(this.session)) {
      throw new SessionError("agent 会话已在运行（先 stop 再 start）");
    }
    const before = new Set(this.listSockets(this.runtimeDir).map((s) => s.name));
    const pid = this.launch();
    // 轮询等待新 IPC socket 出现（niri 起来需要一点时间）
    for (let i = 0; i < 40; i++) {
      await this.wait(250);
      const fresh = this.listSockets(this.runtimeDir).filter((s) => !before.has(s.name));
      const match = fresh
        .map((s) => NIRI_SOCKET_RE.exec(s.name))
        .find((m) => m != null);
      if (match) {
        this.session = {
          pid,
          socket: match[0] ? path.join(this.runtimeDir, match[0]) : "",
          waylandDisplay: match[1] ?? "",
        };
        return this.session;
      }
    }
    throw new SessionError("嵌套 niri 启动后 10 秒内未出现 IPC socket（进程可能已退出）");
  }

  async stop(): Promise<void> {
    if (!this.session) return;
    const { pid, socket } = this.session;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 进程已不在，忽略
    }
    for (let i = 0; i < 20; i++) {
      await this.wait(150);
      if (!fs.existsSync(socket)) break;
    }
    // 兜底清理孤儿 socket（正常情况 niri 退出时自删），保证可重新 start
    try {
      fs.unlinkSync(socket);
    } catch {
      // 已不存在
    }
    this.session = null;
  }

  /** 在 agent 会话内启动应用 */
  async openApp(command: string[]): Promise<void> {
    const s = this.requireSession();
    await this.client(s).spawn(command);
  }

  /** agent 会话内的窗口列表 */
  async windows(): Promise<unknown> {
    const s = this.requireSession();
    return this.client(s).windows();
  }

  /** 截取 agent 会话自己的屏幕（不碰用户桌面） */
  async screenshot(name?: string): Promise<string> {
    const s = this.requireSession();
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    // Unicode 感知白名单：保留字母/数字/CJK 与 . _ -，其余（路径分隔符、控制字符等）替换
    const safeName = (name ?? "").replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 80);
    const file = path.join(
      this.screenshotsDir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}${safeName ? `-${safeName}` : ""}.png`,
    );
    const r = await this.runner.run("grim", [file], {
      env: { WAYLAND_DISPLAY: s.waylandDisplay },
    });
    if (r.code !== 0 || !fs.existsSync(file)) {
      throw new SessionError(`grim 截图失败: ${r.stderr.trim() || `exit ${r.code}`}（grim 装了吗？）`);
    }
    return file;
  }

  private client(s: AgentSessionInfo): NiriClient {
    return new NiriClient(this.runner, "niri", { NIRI_SOCKET: s.socket });
  }

  private requireSession(): AgentSessionInfo {
    if (!this.session || !this.isSocketAlive(this.session)) {
      throw new SessionError("agent 会话未运行（先调用 agent_session_start）");
    }
    return this.session;
  }

  private isSocketAlive(s: AgentSessionInfo): boolean {
    return fs.existsSync(s.socket);
  }
}

export interface SocketFile {
  name: string;
  path: string;
}

function listNiriSockets(dir: string): SocketFile[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => NIRI_SOCKET_RE.test(n))
      .map((n) => ({ name: n, path: path.join(dir, n) }));
  } catch {
    return [];
  }
}
