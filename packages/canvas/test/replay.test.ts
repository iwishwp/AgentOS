import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createCanvasServer } from "../src/server.js";
import { readAudit, redactEntry, listRecordings, DEFAULT_AUDIT_PATH } from "../src/replay.js";

let root: string;
let auditFile: string;
let recDir: string;
let server: http.Server;
let base: string;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-canvas-"));
  root = path.join(dir, "canvas");
  auditFile = path.join(dir, "audit.jsonl");
  recDir = path.join(dir, "recordings");
  fs.mkdirSync(recDir, { recursive: true });
  server = createCanvasServer(root, { auditPath: auditFile, recordingsDir: recDir });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(r));
});

async function get(p: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(base + p, { headers });
}

function writeAudit(lines: unknown[]): void {
  fs.writeFileSync(auditFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("/api/audit", () => {
  it("倒序返回（最新在前）+ 全字段", async () => {
    writeAudit([
      { ts: "2026-10-18T10:00:00Z", extension: "files", tool: "read_file", decision: "allow" },
      {
        ts: "2026-10-18T11:00:00Z",
        extension: "desktop",
        tool: "open",
        decision: "confirm",
        tier: "t1",
        confirm: { asked: true, result: "allow_once", by: "notify-action", response_ms: 2312 },
      },
      { ts: "2026-10-18T12:00:00Z", extension: "system", tool: "package_install", decision: "deny" },
    ]);
    const r = await get("/api/audit");
    expect(r.status).toBe(200);
    const entries = (await r.json()) as Record<string, unknown>[];
    expect(entries).toHaveLength(3);
    expect(entries[0]!.tool).toBe("package_install"); // 最新在前
    expect(entries[1]!.confirm).toMatchObject({ result: "allow_once", response_ms: 2312 });
  });

  it("过滤器 tool/tier/decision/since 生效", async () => {
    writeAudit([
      { ts: "2026-10-18T10:00:00Z", extension: "a", tool: "t1_open", decision: "allow" },
      { ts: "2026-10-18T11:00:00Z", extension: "a", tool: "t2_open", decision: "confirm", tier: "t1" },
      { ts: "2026-10-19T11:00:00Z", extension: "b", tool: "t3_open", decision: "deny" },
    ]);
    expect(await (await get("/api/audit?tool=t1_")).json()).toHaveLength(1);
    expect(await (await get("/api/audit?tier=t1")).json()).toHaveLength(1);
    expect(await (await get("/api/audit?decision=deny")).json()).toHaveLength(1);
    expect(await (await get("/api/audit?since=2026-10-19T00:00:00Z")).json()).toHaveLength(1);
    expect(await (await get("/api/audit?ext=b")).json()).toHaveLength(1);
  });

  it("打码器兜底：敏感键值与 token 形态被遮蔽", async () => {
    writeAudit([
      {
        ts: "2026-10-18T10:00:00Z",
        extension: "x",
        tool: "y",
        decision: "allow",
        detail: "api_key=sk-abcdefghijklmnop1234",
        nested: { password: "hunter2", note: "token ghp_abcdefghijklmnop123 in text" },
      },
    ]);
    const entries = (await (await get("/api/audit")).json()) as Record<string, unknown>[];
    const text = JSON.stringify(entries[0]);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk-abcdefghijklmnop1234");
    expect(text).not.toContain("ghp_abcdefghijklmnop123");
    expect(text).toContain("«redacted»");
  });

  it("审计文件缺失时返回空数组（200）", async () => {
    fs.rmSync(auditFile, { force: true });
    const r = await get("/api/audit");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });
});

describe("/replay 页面", () => {
  it("返回自包含 HTML（时间轴 + 录像两个区块）", async () => {
    const r = await get("/replay");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("审计时间轴");
    expect(html).toContain("/api/audit");
    expect(html).toContain("/api/recordings");
  });
});

describe("录像清单与播放", () => {
  it("/api/recordings 列出 mkv（倒序、忽略隐藏/状态文件）", async () => {
    fs.writeFileSync(path.join(recDir, "20261018-120000.mkv"), "x");
    fs.writeFileSync(path.join(recDir, "20261018-130000.mkv"), "yy");
    fs.writeFileSync(path.join(recDir, ".recorder.pid"), "123");
    fs.writeFileSync(path.join(recDir, "notes.txt"), "z");
    const list = (await (await get("/api/recordings")).json()) as { name: string; size: number }[];
    expect(list.map((v) => v.name)).toEqual(["20261018-130000.mkv", "20261018-120000.mkv"]);
  });

  it("/recordings/<name> 提供 mkv（含 Range 206）", async () => {
    fs.writeFileSync(path.join(recDir, "a.mkv"), Buffer.alloc(1000, 7));
    const full = await get("/recordings/a.mkv");
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/x-matroska");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const part = await get("/recordings/a.mkv", { range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  it("路径穿越与非法扩展名被拒", async () => {
    const a = await get("/recordings/..%2F..%2Fetc%2Fpasswd");
    expect([403, 404]).toContain(a.status);
    const b = await get("/recordings/.recorder.pid");
    expect([403, 404]).toContain(b.status);
  });
});

describe("纯函数", () => {
  it("readAudit：limit 生效、坏行不炸", () => {
    fs.writeFileSync(auditFile, '{"ts":"1","tool":"a"}\nnot-json\n');
    const out = readAudit(auditFile, { limit: 10 });
    expect(out).toHaveLength(2);
    expect((out[1] as Record<string, unknown>)["tool"]).toBe("a");
  });

  it("redactEntry：白名单键不误伤", () => {
    const e = redactEntry({ detail: "packages=cowsay,sl", ts: "t" });
    expect(e["detail"]).toBe("packages=cowsay,sl");
  });

  it("listRecordings：目录缺失返回空", () => {
    expect(listRecordings(path.join(os.tmpdir(), "no-such-agentos-dir-xyz"))).toEqual([]);
  });

  it("默认路径约定", () => {
    expect(DEFAULT_AUDIT_PATH).toContain("agentos/audit.jsonl");
  });
});
