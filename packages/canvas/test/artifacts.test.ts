import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createCanvasServer } from "../src/server.js";
import { classify, listArtifacts, resolveInsideWorkspace } from "../src/artifacts.js";

/**
 * fixture：一个迷你工作区——覆盖全部呈现通道（网页/文档/图片/数据/影音/其他）
 * 加上三类必须被排除的东西（.trash 回收站、隐藏文件、指向外部的符号链接）。
 */
let dir: string;
let canvasRoot: string;
let workspace: string;
let outside: string;
let server: http.Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "agentos-artifacts-"));
  workspace = path.join(dir, "Agent");
  canvasRoot = path.join(workspace, "canvas");
  outside = path.join(dir, "outside");
  fs.mkdirSync(path.join(workspace, "reports"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "downloads"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".trash"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  fs.mkdirSync(path.join(canvasRoot, "weekly"), { recursive: true });
  fs.writeFileSync(path.join(canvasRoot, "weekly", "index.html"), "<h1>周报</h1>");
  fs.writeFileSync(path.join(workspace, "reports", "weekly.fodt"), "<odf/>");
  fs.writeFileSync(path.join(workspace, "reports", "年报.docx"), "docx");
  fs.writeFileSync(path.join(workspace, "reports", "简报.pdf"), "%PDF");
  fs.writeFileSync(path.join(workspace, "downloads", "截图.png"), "png");
  fs.writeFileSync(path.join(workspace, "notes.md"), "# 笔记");
  fs.writeFileSync(path.join(workspace, "数据.csv"), "a,b");
  fs.writeFileSync(path.join(workspace, "misc.zip"), "zip");
  // 排除项：回收站、隐藏文件、外链符号链接
  fs.writeFileSync(path.join(workspace, ".trash", "已删.fodt"), "deleted");
  fs.writeFileSync(path.join(workspace, ".DS_Store"), "junk");
  fs.symlinkSync(outside, path.join(workspace, "外链"));

  server = createCanvasServer(canvasRoot, { workspaceDir: workspace });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

function get(p: string): Promise<Response> {
  return fetch(base + p);
}

describe("classify 类型徽章", () => {
  it("六类通道各就各位", () => {
    expect(classify(".html")).toBe("html");
    expect(classify("FODT")).toBe("document");
    expect(classify(".docx")).toBe("document");
    expect(classify(".pdf")).toBe("document");
    expect(classify(".png")).toBe("image");
    expect(classify(".csv")).toBe("data");
    expect(classify(".mkv")).toBe("media");
    expect(classify(".zip")).toBe("misc");
    expect(classify("")).toBe("misc");
  });
});

describe("listArtifacts 全类型扫描", () => {
  it("多类型文件全量命中，rel/group/kind 正确", () => {
    const idx = listArtifacts(workspace);
    const rels = idx.items.map((a) => a.rel);
    expect(rels).toContain("canvas/weekly/index.html");
    expect(rels).toContain("reports/weekly.fodt");
    expect(rels).toContain("reports/年报.docx");
    expect(rels).toContain("reports/简报.pdf");
    expect(rels).toContain("downloads/截图.png");
    expect(rels).toContain("notes.md");
    expect(rels).toContain("数据.csv");
    expect(rels).toContain("misc.zip");
    expect(idx.items.find((a) => a.rel === "reports/weekly.fodt")).toMatchObject({
      group: "reports",
      kind: "document",
    });
    expect(idx.items.find((a) => a.rel === "notes.md")).toMatchObject({ group: "", kind: "data" });
    expect(idx.items.find((a) => a.rel === "canvas/weekly/index.html")).toMatchObject({ kind: "html" });
  });

  it(".trash、隐藏文件、符号链接不进索引", () => {
    const rels = listArtifacts(workspace).items.map((a) => a.rel);
    expect(rels).not.toContain(".trash/已删.fodt");
    expect(rels).not.toContain(".DS_Store");
    expect(rels).not.toContain("外链");
  });

  it("mtime 倒序（最新在前）", () => {
    const now = Date.now();
    const a = listArtifacts(workspace).items;
    expect(a[0]!.mtime >= a[a.length - 1]!.mtime).toBe(true);
    expect(Math.abs(Date.parse(a[0]!.mtime) - now)).toBeLessThan(60_000);
  });
});

describe("resolveInsideWorkspace 沙箱", () => {
  it("工作区内相对路径可解析（realpath 后的绝对路径）", () => {
    expect(resolveInsideWorkspace(workspace, "reports/weekly.fodt")).toBe(
      path.join(fs.realpathSync(workspace), "reports", "weekly.fodt"),
    );
  });

  it("越界与空路径拒绝", () => {
    expect(resolveInsideWorkspace(workspace, "../outside")).toBeNull();
    expect(resolveInsideWorkspace(workspace, "")).toBeNull();
    // 绝对路径沿用 canvas safe() 语义：剥掉前导 / 当工作区相对路径处理——
    // 结果困在工作区内（不存在即 404），永远不会指到系统路径
    const abs = resolveInsideWorkspace(workspace, "/etc/passwd")!;
    expect(abs.startsWith(fs.realpathSync(workspace))).toBe(true);
    expect(abs).not.toBe("/etc/passwd");
  });
});

describe("/api/artifacts 路由", () => {
  it("返回全类型索引 JSON", async () => {
    const r = await get("/api/artifacts");
    expect(r.status).toBe(200);
    const idx = (await r.json()) as { workspace: string; total: number; items: { rel: string; kind: string }[] };
    expect(idx.total).toBe(idx.items.length);
    expect(idx.items.some((a) => a.kind === "document")).toBe(true);
    expect(idx.items.some((a) => a.rel === "reports/年报.docx")).toBe(true);
    expect(idx.items.every((a) => !a.rel.startsWith("."))).toBe(true);
  });
});

describe("/api/artifacts/file 路由", () => {
  it("在线看：inline + 正确 MIME（中文文件名/子目录）", async () => {
    const r = await get(`/api/artifacts/file?path=${encodeURIComponent("reports/简报.pdf")}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect(r.headers.get("content-disposition")).toBe("inline");
  });

  it("下载：attachment + 双文件名（ASCII 兜底 + UTF-8 主通道）", async () => {
    const r = await get(`/api/artifacts/file?path=${encodeURIComponent("reports/年报.docx")}&mode=download`);
    expect(r.status).toBe(200);
    const d = r.headers.get("content-disposition") ?? "";
    expect(d).toContain("attachment");
    expect(d).toContain("filename*=");
  });

  it("../ 越界与绝对路径拒绝（沙箱纪律）", async () => {
    const esc1 = await get(`/api/artifacts/file?path=${encodeURIComponent("../../etc/passwd")}`);
    expect(esc1.status).toBe(404);
    expect(await esc1.text()).not.toContain("root:");
    const esc2 = await get(`/api/artifacts/file?path=${encodeURIComponent("/etc/passwd")}`);
    expect(esc2.status).toBe(404);
  });

  it(".trash 与隐藏文件不出网", async () => {
    const trash = await get(`/api/artifacts/file?path=${encodeURIComponent(".trash/已删.fodt")}`);
    expect(trash.status).toBe(403);
    const hidden = await get(`/api/artifacts/file?path=${encodeURIComponent(".DS_Store")}`);
    expect(hidden.status).toBe(403);
  });

  it("指向外部的符号链接拒绝", async () => {
    const r = await get(`/api/artifacts/file?path=${encodeURIComponent("外链")}`);
    expect(r.status).toBe(404);
  });

  it("目录与不存在的文件 404", async () => {
    expect((await get(`/api/artifacts/file?path=reports`)).status).toBe(404);
    expect((await get(`/api/artifacts/file?path=reports/nope.fodt`)).status).toBe(404);
  });
});

describe("/artifacts 索引页", () => {
  it("渲染莫兰迪骨架与通道文案（colors.json 缺失降级）", async () => {
    const r = await get("/artifacts");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("产物索引");
    expect(html).toContain("--surface:#21201c"); // 缺省莫兰迪
    expect(html).toContain("/api/artifacts");
    expect(html).toContain("在线看");
    expect(html).toContain("下载");
    expect(html).toContain("desktop__open"); // 文档通道提示
  });

  it("canvas 首页升级：导航指向 /artifacts", async () => {
    const r = await get("/");
    const html = await r.text();
    expect(html).toContain('href="/artifacts"');
    expect(html).toContain('href="/keys"');
    expect(html).toContain('href="/replay"');
  });
});
