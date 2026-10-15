import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvasServer } from "../src/server.js";

let root: string;
let server: http.Server;
let port: number;

function get(p: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"] ?? "", body }),
      );
    }).on("error", reject);
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "agentos-canvas-"));
  fs.mkdirSync(path.join(root, "status"));
  fs.writeFileSync(path.join(root, "status", "index.html"), "<h1>状态页</h1>");
  fs.writeFileSync(path.join(root, "style.css"), "body{}");
  server = createCanvasServer(root);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

describe("canvas 服务", () => {
  it("目录 artifact 以 index.html 响应，content-type 正确", async () => {
    const r = await get("/status/");
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/html");
    expect(r.body).toContain("状态页");
  });

  it("无尾斜杠访问目录自动落到 index.html", async () => {
    const r = await get("/status");
    expect(r.status).toBe(200);
  });

  it("css 等静态资源 MIME 正确", async () => {
    const r = await get("/style.css");
    expect(r.type).toContain("text/css");
  });

  it("索引页列出 artifact 名称", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("status");
    expect(r.body).toContain("/status/");
  });

  it("不存在的文件 404", async () => {
    expect((await get("/nope.html")).status).toBe(404);
  });

  it("编码 ../ 的越界请求被拒（沙箱纪律）", async () => {
    const r1 = await get("/%2e%2e/%2e%2e/etc/passwd");
    expect(r1.status).toBe(404);
    expect(r1.body).not.toContain("root:");
    const r2 = await get("/status/../../../../etc/passwd");
    expect([404, 400]).toContain(r2.status);
    expect(r2.body).not.toContain("root:");
  });

  it("非 GET/HEAD 方法 405", async () => {
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/", method: "POST" }, (res) =>
        resolve({ status: res.statusCode ?? 0 }),
      );
      req.on("error", reject);
      req.end();
    });
    expect(r.status).toBe(405);
  });
});
