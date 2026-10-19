#!/usr/bin/env node
// 桌面 Electron/Chromium 应用统一 CDP 通道 —— 真实点击语义的兜底注入。
//
// 为什么需要：AT-SPI doAction 对 Chromium 系按钮"派发成功但不触发 onclick"
// （capabilities.md 附录 B，Chromium 155 两会话复现）；键盘注入能补一部分，
// 但"点这个按钮"始终缺一条可靠通道。CDP Input.dispatchMouseEvent 是合成器级
// 真实输入，绕开 AT-SPI 限制，对所有开了 remote-debugging-port 的
// Electron/Chromium 应用通吃（goose desktop、主会话 chromium、VS Code……）。
//
// 用法（子命令前可用 --port <p> 覆盖，默认 9223=goose desktop 约定；
//   水族馆 chromium=9222）:
//   app-cdp.mjs targets [--port 9223]                 # 列 target（调试/发现用）
//   app-cdp.mjs screenshot out.png [--port p] [--target 子串]   # 页面截图
//   app-cdp.mjs click <x> <y> [--button left|right|middle] [--count 2] [--hold-ms N]
//   app-cdp.mjs key "文本"                            # Input.insertText
//   app-cdp.mjs press Enter|Tab|Escape|Backspace      # 单控制键（rawDown+up）
//   app-cdp.mjs eval "js 表达式"                      # Runtime.evaluate 读结果
//   可选 --target <子串>：按 target URL 匹配页面（默认第一个 page target）。
//
// 坐标语义：**应用客户区的 CSS 像素**（viewport 原点=窗口左上角，不含系统
// 装饰）。先 screenshot 看画面取坐标，或 eval 拿 getBoundingClientRect。
// 端口约定：goose desktop 9223（launch-goose-desktop.sh 固定
// --remote-debugging-port=9223 + --remote-allow-origins=*）；水族馆 browser-mcp
// chromium 9222；其他应用自选端口用 --port。
// 零第三方依赖（Node 22 全局 WebSocket + fetch），与 packages/browser-mcp
// 的 CDP 客户端同构但独立最小实现——不引包间依赖，任意机器单文件可用。
import fs from "node:fs";

const DEFAULT_PORT = 9223;
const USAGE = `用法: app-cdp.mjs [--port <p>] [--target <url子串>] <子命令> <参数...>
子命令: targets | screenshot <路径> | click <x> <y> [--button b] [--count n] | key <文本> | press <键名> | eval <js>`;

function parseArgs(argv) {
  const opt = { port: DEFAULT_PORT, target: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opt.port = Number(argv[++i]);
    else if (a === "--target") opt.target = String(argv[++i]);
    else if (a === "--button") opt.button = argv[++i];
    else if (a === "--count") opt.count = Number(argv[++i]);
    else if (a === "--hold-ms") opt.holdMs = Number(argv[++i]);
    else rest.push(a);
  }
  return { opt, cmd: rest[0], args: rest.slice(1) };
}

async function httpJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** 选 target：默认第一个 type=page；--target 给子串时按 url/title 匹配 */
async function findTarget(port, match) {
  const list = await httpJson(`http://127.0.0.1:${port}/json`).catch((e) => {
    throw new Error(`CDP 端口 ${port} 不可达（应用没开 --remote-debugging-port？）：${e.message}`);
  });
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const chosen = match
    ? pages.find((t) => (t.url ?? "").includes(match) || (t.title ?? "").includes(match))
    : pages[0];
  if (!chosen) {
    throw new Error(
      match ? `没有 URL/标题含 "${match}" 的 page target` : "没有可用的 page target",
    );
  }
  return chosen;
}

/** 极简 CDP 会话：单连接 + id 配对（超时 15s） */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`CDP WebSocket 连接失败: ${wsUrl}`));
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP 错误: ${msg.error.message ?? "?"}`));
        else p.resolve(msg.result);
      }
    } catch { /* 事件通知，忽略 */ }
  };
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`CDP 调用超时: ${method}`));
        }, 15_000);
      });
    },
    close() { ws.close(); },
  };
}

const BUTTON_ENUM = { left: "left", middle: "middle", right: "right" };
const KEY_CODES = {
  enter: { code: 13, key: "Enter", text: "\r" },
  tab: { code: 9, key: "Tab", text: undefined },
  escape: { code: 27, key: "Escape", text: undefined },
  backspace: { code: 8, key: "Backspace", text: "\b" },
  delete: { code: 46, key: "Delete", text: undefined },
  arrowup: { code: 38, key: "ArrowUp", text: undefined },
  arrowdown: { code: 40, key: "ArrowDown", text: undefined },
  arrowleft: { code: 37, key: "ArrowLeft", text: undefined },
  arrowright: { code: 39, key: "ArrowRight", text: undefined },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { opt, cmd, args } = parseArgs(process.argv.slice(2));
  if (!cmd) { console.error(USAGE); process.exit(2); }

  if (cmd === "targets") {
    const list = await httpJson(`http://127.0.0.1:${opt.port}/json`);
    for (const t of list) {
      console.log(`${t.type}\t${t.title ?? ""}\t${t.url ?? ""}`);
    }
    return;
  }

  const target = await findTarget(opt.port, opt.target);
  const c = await connect(target.webSocketDebuggerUrl);
  try {
    switch (cmd) {
      case "screenshot": {
        if (!args[0]) throw new Error("screenshot 需要输出路径");
        const r = await c.send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(args[0], Buffer.from(r.data, "base64"));
        console.log(`已截图 ${args[0]} (${target.title ?? target.url})`);
        return;
      }
      case "click": {
        const [x, y] = [Number(args[0]), Number(args[1])];
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click 需要 <x> <y>");
        const button = BUTTON_ENUM[opt.button ?? "left"];
        if (!button) throw new Error(`未知按钮 ${opt.button}（left|middle|right）`);
        const count = opt.count ?? 1;
        for (let i = 0; i < count; i++) {
          // 先 hover（mouseMoved）——部分 UI（hover 展开的菜单、React onMouseEnter）
          // 需要指针先移动到目标上才响应点击；Playwright 同款序列
          await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
          await sleep(20);
          await c.send("Input.dispatchMouseEvent", {
            type: "mousePressed", x, y, button, clickCount: 1,
          });
          await sleep(Math.max(opt.holdMs ?? 40, 10));
          await c.send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x, y, button, clickCount: 1,
          });
          if (i + 1 < count) await sleep(80);
        }
        console.log(`已点击 (${x},${y}) ${button}${count > 1 ? ` ×${count}` : ""}`);
        return;
      }
      case "key": {
        if (!args[0]) throw new Error("key 需要文本");
        await c.send("Input.insertText", { text: args[0] });
        console.log(`已输入 ${JSON.stringify(args[0])}`);
        return;
      }
      case "press": {
        const k = KEY_CODES[String(args[0] ?? "").toLowerCase()];
        if (!k) throw new Error(`未知键 ${args[0]}（支持: ${Object.keys(KEY_CODES).join("/")}`);
        await c.send("Input.dispatchKeyEvent", {
          type: "keyDown", key: k.key, windowsVirtualKeyCode: k.code, nativeVirtualKeyCode: k.code,
          ...(k.text != null ? { text: k.text } : {}),
        });
        await sleep(30);
        await c.send("Input.dispatchKeyEvent", {
          type: "keyUp", key: k.key, windowsVirtualKeyCode: k.code, nativeVirtualKeyCode: k.code,
        });
        console.log(`已按键 ${k.key}`);
        return;
      }
      case "eval": {
        if (!args[0]) throw new Error("eval 需要 js 表达式");
        const r = await c.send("Runtime.evaluate", {
          expression: args[0], returnByValue: true, awaitPromise: true,
        });
        if (r.exceptionDetails) {
          throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        }
        console.log(JSON.stringify(r.result?.value ?? r.result?.description ?? null));
        return;
      }
      default:
        console.error(`未知子命令 ${cmd}\n${USAGE}`);
        process.exit(2);
    }
  } finally {
    c.close();
  }
}

main().catch((e) => { console.error(`app-cdp: ${e.message}`); process.exit(1); });
