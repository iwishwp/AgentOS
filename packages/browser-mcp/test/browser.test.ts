import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrowserClient, BrowserError, type CdpConnection } from "../src/browser.js";

function makeClient(opts: {
  launchedArgs?: string[][];
  httpJson?: (url: string) => Promise<unknown>;
  cdpResponses?: Record<string, unknown>;
} = {}) {
  const launchedArgs: string[][] = [];
  const launchedEnv: Record<string, string>[] = [];
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "agentos-br-rt-"));
  // 模拟水族馆存在：runtime dir 里有一个非当前 display 的 niri socket
  fs.writeFileSync(path.join(runtimeDir, "niri.wayland-2.777.sock"), "");
  const calls: { method: string; params?: unknown }[] = [];
  const conn: CdpConnection = {
    async send(method, params) {
      calls.push({ method, params });
      const resp = opts.cdpResponses?.[method];
      if (resp === undefined) throw new BrowserError(`CDP 错误: mock 未定义 ${method}`);
      return resp;
    },
    close() {},
  };
  const client = new BrowserClient({
    runtimeDir,
    userDataDir: mkdtempSync(path.join(os.tmpdir(), "agentos-br-ud-")),
    screenshotsDir: mkdtempSync(path.join(os.tmpdir(), "agentos-br-shots-")),
    wait: () => Promise.resolve(),
    launch: (args, env) => {
      launchedArgs.push(args);
      launchedEnv.push(env);
    },
    httpGetJson:
      opts.httpJson ??
      (async (url) => {
        if (url.includes("/json/version")) return { Browser: "chromium" };
        if (url.includes("/json")) {
          return [{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/x", url: "about:blank" }];
        }
        return {};
      }),
    connect: async () => conn,
  });
  return { client, launchedArgs, launchedEnv, calls, runtimeDir };
}

describe("ensure 与启动", () => {
  it("devtools 未起时在水族馆 display 拉起 chromium", async () => {
    let up = false;
    const { client, launchedArgs, launchedEnv } = makeClient({
      httpJson: async (url) => {
        if (url.includes("/json/version")) {
          if (!up) {
            up = true; // 第一次探测失败，第二次（启动后）成功
            return Promise.reject(new Error("down"));
          }
          return { Browser: "x" };
        }
        return [{ type: "page", webSocketDebuggerUrl: "ws://x" }];
      },
    });
    await client.ensure();
    expect(launchedArgs).toHaveLength(1);
    expect(launchedArgs[0]).toContainEqual("--remote-debugging-port=9222");
    expect(launchedEnv[0]?.["WAYLAND_DISPLAY"]).toBe("wayland-2");
  });

  it("默认带 --force-renderer-accessibility（L1 树可达）；AGENTOS_BROWSER_NO_A11Y=1 关闭", async () => {
    let up = false;
    const httpJson = async (url: string) => {
      if (url.includes("/json/version")) {
        if (!up) {
          up = true;
          return Promise.reject(new Error("down"));
        }
        return { Browser: "x" };
      }
      return [{ type: "page", webSocketDebuggerUrl: "ws://x" }];
    };
    const withFlag = makeClient({ httpJson });
    await withFlag.client.ensure();
    expect(withFlag.launchedArgs[0]).toContainEqual("--force-renderer-accessibility");

    up = false;
    const prev = process.env["AGENTOS_BROWSER_NO_A11Y"];
    process.env["AGENTOS_BROWSER_NO_A11Y"] = "1";
    try {
      const withoutFlag = makeClient({ httpJson });
      await withoutFlag.client.ensure();
      expect(withoutFlag.launchedArgs[0]).not.toContainEqual("--force-renderer-accessibility");
    } finally {
      if (prev === undefined) delete process.env["AGENTOS_BROWSER_NO_A11Y"];
      else process.env["AGENTOS_BROWSER_NO_A11Y"] = prev;
    }
  });

  it("没有水族馆时启动被拒", async () => {
    const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "agentos-br-empty-"));
    const client = new BrowserClient({
      runtimeDir,
      userDataDir: runtimeDir,
      launch: () => {},
      httpGetJson: async () => {
        throw new Error("down");
      },
      connect: async () => {
        throw new Error("should not connect");
      },
      wait: () => Promise.resolve(),
    });
    await expect(client.ensure()).rejects.toThrow(/水族馆/);
  });
});

describe("页面操作", () => {
  it("open 导航后返回地址", async () => {
    const { client, calls } = makeClient({
      cdpResponses: {
        "Page.navigate": { frameId: "f" },
        "Runtime.evaluate": { result: { value: "https://www.baidu.com/s?wd=x" } },
      },
    });
    const msg = await client.open("https://www.baidu.com");
    expect(msg).toContain("baidu");
    expect(calls[0]?.method).toBe("Page.navigate");
  });

  it("eval 返回值", async () => {
    const { client } = makeClient({
      cdpResponses: { "Runtime.evaluate": { result: { value: 42 } } },
    });
    const r = (await client.eval("6*7")) as { value: number };
    expect(r.value).toBe(42);
  });

  it("screenshot 落盘 PNG", async () => {
    const png = Buffer.from("fake-png-bytes").toString("base64");
    const { client } = makeClient({
      cdpResponses: { "Page.captureScreenshot": { data: png } },
    });
    const file = await client.screenshot("表单结果");
    expect(file).toContain("表单结果");
    expect(file).toContain("-web.png");
    expect(fs.readFileSync(file, "utf8")).toContain("fake-png");
  });
});
