import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { FilesError, Workspace } from "../src/workspace.js";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agentos-ws-"));

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

function ws(): Workspace {
  return new Workspace(tmpRoot);
}

describe("基本读写", () => {
  it("写入→读回→列表 roundtrip", () => {
    const w = ws();
    expect(w.writeFile("notes/a.txt", "你好 AgentOS")).toBeGreaterThan(0);
    expect(w.readFile("notes/a.txt")).toBe("你好 AgentOS");
    expect(w.listDir("notes")).toContain("a.txt");
  });

  it("读文件超上限报错并可调高", () => {
    const w = ws();
    const big = "x".repeat(70 * 1024);
    w.writeFile("big.txt", big);
    expect(() => w.readFile("big.txt")).toThrow(FilesError);
    expect(w.readFile("big.txt", 100 * 1024)).toHaveLength(70 * 1024);
  });
});

describe("沙箱越界防护（核心安全测试）", () => {
  it("拒绝 ../ 逃逸", () => {
    const w = ws();
    expect(() => w.readFile("../../../etc/passwd")).toThrow(/越界/);
  });

  it("拒绝绝对路径", () => {
    const w = ws();
    expect(() => w.readFile("/etc/passwd")).toThrow(/越界/);
  });

  it("拒绝指向外部的符号链接", () => {
    const outer = mkdtempSync(path.join(os.tmpdir(), "agentos-out-"));
    fs.writeFileSync(path.join(outer, "secret.txt"), "outside");
    const w = ws();
    fs.symlinkSync(outer, path.join(tmpRoot, "escape"));
    expect(() => w.readFile("escape/secret.txt")).toThrow(/越界/);
    fs.rmSync(outer, { recursive: true, force: true });
  });

  it("写入到 ../ 也被拒", () => {
    const w = ws();
    expect(() => w.writeFile("../evil.txt", "x")).toThrow(/越界/);
  });
});

describe("下载", () => {
  it("从本地 http 服务下载到沙箱", async () => {
    const { createServer } = await import("node:http");
    const srv = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("downloaded content 中文");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      const w = ws();
      const r = await w.download(`http://127.0.0.1:${port}/a.txt`, "downloads/a.txt");
      expect(r.bytes).toBeGreaterThan(0);
      expect(w.readFile("downloads/a.txt")).toContain("downloaded content");
    } finally {
      srv.close();
    }
  });

  it("非 http(s) 协议被拒", async () => {
    const w = ws();
    await expect(w.download("file:///etc/passwd", "x")).rejects.toThrow(/http/);
    await expect(w.download("ftp://example.com/x", "x")).rejects.toThrow(/http/);
  });

  it("HTTP 404 报错", async () => {
    const { createServer } = await import("node:http");
    const srv = createServer((_, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      const w = ws();
      await expect(w.download(`http://127.0.0.1:${port}/x`, "x")).rejects.toThrow(/404/);
    } finally {
      srv.close();
    }
  });
});

describe("目录与移动", () => {
  it("createDir 后 move 重命名", () => {
    const w = ws();
    w.createDir("jobs/2026");
    w.writeFile("jobs/2026/tmp.md", "hi");
    w.move("jobs/2026/tmp.md", "jobs/2026/final.md");
    expect(w.readFile("jobs/2026/final.md")).toBe("hi");
    expect(() => w.readFile("jobs/2026/tmp.md")).toThrow();
  });

  it("move 到已存在目标被拒", () => {
    const w = ws();
    w.writeFile("a", "1");
    w.writeFile("b", "2");
    expect(() => w.move("a", "b")).toThrow(FilesError);
  });
});

describe("删除进回收站", () => {
  it("删除后文件从原位消失、出现在 .trash", () => {
    const w = ws();
    w.writeFile("tobedeleted.txt", "bye");
    const trashPath = w.delete("tobedeleted.txt");
    expect(trashPath).toContain(".trash");
    expect(() => w.readFile("tobedeleted.txt")).toThrow();
    expect(fs.existsSync(trashPath)).toBe(true);
  });
});

describe("按名称查找", () => {
  it("递归查找且跳过 .trash", () => {
    const w = ws();
    w.createDir("deep/deeper");
    w.writeFile("deep/report-2026.md", "x");
    w.writeFile("deep/deeper/report-draft.md", "x");
    w.writeFile("other.txt", "x");
    w.writeFile("gone-report.txt", "x");
    w.delete("gone-report.txt");
    const hits = w.findByName("report");
    expect(hits).toContain("deep/report-2026.md");
    expect(hits).toContain("deep/deeper/report-draft.md");
    expect(hits.some((h) => h.includes("gone-report"))).toBe(false);
  });
});
