import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { FakeRunner } from "@agentos/proc/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvasServer } from "../src/server.js";
import {
  applyAppearance,
  flipDarkMode,
  listSnapshots,
  probeSettingsDaemon,
  readSettingsState,
  readUnitStates,
  repoRoot,
  runStateExport,
} from "../src/settings.js";

let dir: string;
let server: http.Server;
let port: number;
let runner: FakeRunner;
let stateFile: string;
let socketPath: string;

function get(p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function post(p: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const STATE: Record<string, unknown> = {
  darkMode: true,
  paletteVariant: "dark",
  palettePath: "/home/u/.config/noctalia/lanrhyme-palette.json",
  lastAppliedAt: "2026-10-19T00:00:00.000Z",
  appliedBy: "daemon",
  bridges: { noctalia: "ok", mako: "ok", fuzzel: "ok", ghostty: "ok", gtk: "fail:测试原因" },
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "agentos-settings-"));
  stateFile = path.join(dir, "settings-state.json");
  fs.writeFileSync(stateFile, JSON.stringify(STATE, null, 2));
  socketPath = path.join(dir, "probe.sock");
  runner = new FakeRunner();
  // systemctl / snapshot 脚本的预置应答（FakeRunner 按 args 前缀匹配）
  runner.on(["--user", "is-active", "agentos-canvas"], { stdout: "active" });
  runner.on(["--user", "is-active", "agentos-settings"], { stdout: "active" });
  runner.on(["--user", "is-active", "agentos-orb"], { stdout: "inactive", code: 3 });
  runner.on(["--user", "is-active", "agentos-confirm"], { stdout: "failed", code: 1 });
  runner.on(["list", "--json"], { stdout: JSON.stringify([{ number: 12, date: "2026-10-19T01:02:03Z", description: "agentos-pre-测试" }]) });
  runner.on(["apply", "--dark"], { stdout: "applied" });
  runner.on(["--with-secrets"], { stdout: "已打包 8 个文件\nEXPORTED_PATH=/tmp/agentos-state-x.tar.gz" });
  runner.on([], { stdout: "已打包 8 个文件\nEXPORTED_PATH=/tmp/agentos-state-plain.tar.gz" });
  fs.writeFileSync(path.join(dir, "noctalia.json"), JSON.stringify({ colorSchemes: { darkMode: true } }));
  runner.on(["/fake/settings-cli.js", "apply"], { stdout: "ok" });
  server = createCanvasServer(path.join(dir, "canvas"), {
    runner,
    stateFile,
    settingsSocket: socketPath,
    noctaliaSettings: path.join(dir, "noctalia.json"),
    settingsCli: "/fake/settings-cli.js",
    snapshotScript: "/fake/snapshot.sh",
    exportScript: "/fake/export.sh",
    auditPath: path.join(dir, "audit.jsonl"),
    credPolicyPath: path.join(dir, "credentials.yaml"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

describe("settings 后端单元", () => {
  it("读状态快照：文件在 → 结构完整；坏 JSON → null", () => {
    const s = readSettingsState(stateFile);
    expect(s?.paletteVariant).toBe("dark");
    expect(s?.bridges["gtk"]).toBe("fail:测试原因");
    expect(readSettingsState(path.join(dir, "nope.json"))).toBeNull();
  });

  it("socket 存活探测：真 daemon 应答 alive；无 socket → down", async () => {
    const fake = net.createServer((sock) => {
      sock.on("data", (d) => {
        const req = JSON.parse(d.toString());
        sock.end(JSON.stringify({ ok: true, darkMode: true, paletteVariant: "dark", echo: req.method }) + "\n");
      });
    });
    const sockFile = path.join(dir, "daemon.sock");
    await new Promise<void>((r) => fake.listen(sockFile, r));
    const up = await probeSettingsDaemon(sockFile);
    expect(up.alive).toBe(true);
    expect(up.paletteVariant).toBe("dark");
    fake.close();
    const down = await probeSettingsDaemon(path.join(dir, "不存在.sock"));
    expect(down.alive).toBe(false);
  });

  it("systemd 单元状态：is-active 输出原样保留（inactive/failed 也是有效态）", async () => {
    const r = new FakeRunner();
    r.on(["--user", "is-active", "a"], { stdout: "active" });
    r.on(["--user", "is-active", "b"], { stdout: "failed", code: 1 });
    r.on(["--user", "is-active", "c"], { stdout: "", stderr: "spawn 失败", code: null });
    const st = await readUnitStates(r, ["a", "b", "c"]);
    expect(st).toEqual({ a: "active", b: "failed", c: "不可执行" });
  });

  it("快照列表：解析 snapshot.sh --json；失败/缺脚本如实报错", async () => {
    const ok = await listSnapshots(runner, "/fake/snapshot.sh");
    expect(ok.snapshots).toEqual([{ number: 12, date: "2026-10-19T01:02:03Z", description: "agentos-pre-测试" }]);
    const bad = await listSnapshots(new FakeRunner(), "/fake/snapshot.sh");
    expect(bad.snapshots).toEqual([]);
    expect(bad.error).toBeTruthy();
    const none = await listSnapshots(runner, null);
    expect(none.error).toContain("找不到");
  });

  it("flipDarkMode：只动 colorSchemes.darkMode 一个键，其余原样", () => {
    const f = path.join(dir, "noctalia-settings.json");
    fs.writeFileSync(f, JSON.stringify({ colorSchemes: { darkMode: true, accent: "#abc" }, wallpaper: "/w.png" }));
    expect(flipDarkMode(f, false)).toBe(true);
    const after = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(after.colorSchemes).toEqual({ darkMode: false, accent: "#abc" });
    expect(after.wallpaper).toBe("/w.png");
    expect(flipDarkMode(path.join(dir, "坏.json"), true)).toBe(false); // 文件不在 → false 不炸
  });

  it("外观切换：先翻真相再 apply auto；真相不可写降级强制变体；CLI 失败如实带回", async () => {
    const truth = path.join(dir, "noctalia-settings.json");
    fs.writeFileSync(truth, JSON.stringify({ colorSchemes: { darkMode: true } }));
    const r = new FakeRunner();
    r.on(["/fake/cli.js", "apply"], { stdout: "ok" });
    const res = await applyAppearance(r, "/fake/cli.js", stateFile, "dark", truth);
    expect(res.ok).toBe(true);
    expect(res.truthFlipped).toBe(true);
    expect(r.lastArgs()).toEqual(["/fake/cli.js", "apply"]); // auto：读真相收敛
    expect(JSON.parse(fs.readFileSync(truth, "utf8")).colorSchemes.darkMode).toBe(true);
    // 真相文件缺失 → 降级 --dark
    const r2 = new FakeRunner();
    r2.on(["apply", "--dark"], { stdout: "ok" });
    const res2 = await applyAppearance(r2, "/fake/cli.js", stateFile, "dark", path.join(dir, "无.json"));
    expect(res2.truthFlipped).toBe(false);
    expect(r2.lastArgs()).toEqual(["/fake/cli.js", "apply", "--dark"]);
    const fail = await applyAppearance(new FakeRunner(), "/fake/cli.js", stateFile, "light");
    expect(fail.ok).toBe(false);
    expect(fail.detail).toBeTruthy();
    const noCli = await applyAppearance(runner, null, stateFile, "dark");
    expect(noCli.ok).toBe(false);
    expect(noCli.detail).toContain("agentos-settings");
  });

  it("导出：解析 EXPORTED_PATH=；--with-secrets 传参", async () => {
    const r = new FakeRunner();
    r.on(["--with-secrets"], { stdout: "EXPORTED_PATH=/x/s.tar.gz" });
    r.on([], { stdout: "EXPORTED_PATH=/x/p.tar.gz" });
    const withS = await runStateExport(r, "/fake/export.sh", true);
    expect(withS).toMatchObject({ ok: true, path: "/x/s.tar.gz" });
    const plain = await runStateExport(r, "/fake/export.sh", false);
    expect(plain.path).toBe("/x/p.tar.gz");
    expect((await runStateExport(r, null, false)).ok).toBe(false);
  });

  it("repoRoot：从 src/ 或 dist/ 都解析到仓库根", () => {
    expect(fs.existsSync(path.join(repoRoot(), "scripts", "snapshot.sh"))).toBe(true);
  });
});

describe("/settings 路由", () => {
  it("GET /settings 出页面：四分区 + 凭据零明文声明", async () => {
    const r = await get("/settings");
    expect(r.status).toBe(200);
    for (const sec of ["外观", "凭据", "系统", "迁移"]) expect(r.body).toContain(sec);
    expect(r.body).toContain("/api/credentials");
  });

  it("GET /api/settings/appearance：状态快照 + daemon 探测（无 daemon → alive:false）", async () => {
    const r = await get("/api/settings/appearance");
    expect(r.status).toBe(200);
    const d = JSON.parse(r.body);
    expect(d.state.paletteVariant).toBe("dark");
    expect(d.daemon.alive).toBe(false);
  });

  it("GET /api/settings/system：四单元 + 快照表", async () => {
    const r = await get("/api/settings/system");
    const d = JSON.parse(r.body);
    expect(d.units).toEqual({
      "agentos-canvas": "active",
      "agentos-settings": "active",
      "agentos-orb": "inactive",
      "agentos-confirm": "failed",
    });
    expect(d.snapshots[0].number).toBe(12);
  });

  it("POST /api/settings/appearance：variant 校验 + 经 CLI 应用后回读状态", async () => {
    const bad = await post("/api/settings/appearance", JSON.stringify({ variant: "blue" }));
    expect(bad.status).toBe(400);
    const ok = await post("/api/settings/appearance", JSON.stringify({ variant: "dark" }));
    expect(ok.status).toBe(200);
    const d = JSON.parse(ok.body);
    expect(d.ok).toBe(true);
    expect(d.truthFlipped).toBe(true);
    expect(d.state.paletteVariant).toBe("dark");
    expect(runner.lastArgs()).toEqual(["/fake/settings-cli.js", "apply"]); // auto 收敛
    expect(JSON.parse(fs.readFileSync(path.join(dir, "noctalia.json"), "utf8")).colorSchemes.darkMode).toBe(true);
  });

  it("POST 未知名单外路径照旧 405", async () => {
    const r = await post("/api/whatever", "{}");
    expect(r.status).toBe(405);
  });

  it("POST /api/settings/migrate/export：回传产物路径（withSecrets 传参）", async () => {
    const plain = await post("/api/settings/migrate/export", "{}");
    expect(JSON.parse(plain.body).path).toBe("/tmp/agentos-state-plain.tar.gz");
    const secrets = await post("/api/settings/migrate/export", JSON.stringify({ withSecrets: true }));
    expect(JSON.parse(secrets.body).path).toBe("/tmp/agentos-state-x.tar.gz");
    expect(runner.lastArgs()).toEqual(["--with-secrets"]);
  });

  it("索引页导航与 /settings 并列", async () => {
    const r = await get("/");
    expect(r.body).toContain('href="/settings"');
  });
});
