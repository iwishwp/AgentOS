import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { FakeRunner } from "@agentos/proc/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvasServer } from "../src/server.js";
import {
  isValidRef,
  lastUsedFromAudit,
  listCredentials,
  removePolicyEntry,
  revokeCredential,
  type CredentialRow,
} from "../src/credentials.js";

// 与 cred-store.sh 产物同构的 fixture：注释 + 两个引用 + 各自策略
const POLICY_FIXTURE = `# AgentOS 凭据策略（cred-store.sh 生成；吊销会摘块，注释保留）
credentials:
  vault://github/token:
    label: "GitHub"
    exec_allow: [gh, git]
  vault://bank/login:
    label: "银行登录"
    allow: [autofill, execute]
    exec_allow: [python3]
    env: BANK_PASS
`;

function get(p: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function post(p: string, body: string, port: number): Promise<{ status: number; body: string }> {
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

describe("removePolicyEntry 策略块手术", () => {
  it("摘中间条目：其余条目与注释原样保留", () => {
    const { text, removed } = removePolicyEntry(POLICY_FIXTURE, "vault://github/token");
    expect(removed).toBe(true);
    expect(text).not.toContain("vault://github/token");
    expect(text).toContain("vault://bank/login");
    expect(text).not.toContain("exec_allow: [gh, git]"); // github 的白名单一并摘除
    expect(text).toContain("# AgentOS 凭据策略"); // 注释保留
    expect(text).toContain("env: BANK_PASS"); // bank 的字段不受影响
  });

  it("摘最后一条后空壳 credentials: 一并收走（YAML 解析不再有 null 键）", () => {
    const one = `credentials:\n  vault://a/b:\n    label: "B"\n`;
    const { text, removed } = removePolicyEntry(one, "vault://a/b");
    expect(removed).toBe(true);
    expect(text).not.toMatch(/credentials\s*:/);
    // 解析验证在 revoke 的落盘路径里做，这里只验文本形状
  });

  it("无该引用 → removed:false 原文不动；前缀相似的引用不误伤", () => {
    const a = removePolicyEntry(POLICY_FIXTURE, "vault://github/token2");
    expect(a.removed).toBe(false);
    expect(a.text).toBe(POLICY_FIXTURE);
    const b = removePolicyEntry(POLICY_FIXTURE, "vault://nope/x");
    expect(b.removed).toBe(false);
  });
});

describe("listCredentials / 审计反查", () => {
  it("清单：策略解析 + keyring 存在性（search 只探属性）+ 最近使用", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-"));
    const policyPath = path.join(dir, "credentials.yaml");
    const auditPath = path.join(dir, "audit.jsonl");
    fs.writeFileSync(policyPath, POLICY_FIXTURE);
    fs.writeFileSync(
      auditPath,
      [
        JSON.stringify({ ts: "2026-10-18T01:00:00Z", extension: "cred", tool: "cred_exec", decision: "allow", detail: "vault://github/token" }),
        JSON.stringify({ ts: "2026-10-19T02:00:00Z", extension: "cred", tool: "cred_autofill", decision: "allow", detail: "vault://github/token" }),
        JSON.stringify({ ts: "2026-10-19T03:00:00Z", extension: "cred", tool: "cred_exec", decision: "allow", detail: "vault://bank/login" }),
        JSON.stringify({ ts: "2026-10-19T04:00:00Z", extension: "files", tool: "write", decision: "allow", detail: "vault://github/token 不相关扩展" }),
      ].join("\n") + "\n",
    );
    const runner = new FakeRunner();
    runner.on(["search", "--all", "agentos-ref", "vault://github/token"], { code: 0, stdout: "attributes" });
    runner.on(["search", "--all", "agentos-ref", "vault://bank/login"], { code: 1, stdout: "", stderr: "" });
    const rows = await listCredentials({ runner, policyPath, auditPath, secretTool: "secret-tool" });
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r])) as Record<string, CredentialRow>;
    expect(byRef["vault://github/token"]).toMatchObject({
      label: "GitHub",
      allow: ["execute"], // 只写 exec_allow 的旧条目 → 缺省 execute
      exec_allow: ["gh", "git"],
      env: "AGENTOS_SECRET",
      keyring: true,
      lastUsed: "2026-10-19T02:00:00Z",
    });
    expect(byRef["vault://bank/login"]).toMatchObject({
      allow: ["autofill", "execute"],
      env: "BANK_PASS",
      keyring: false,
      lastUsed: "2026-10-19T03:00:00Z",
    });
    // 存在性探测走 search --all（列属性），绝无 lookup（取值）
    for (const c of runner.calls) {
      expect(c.args[0]).not.toBe("lookup");
      expect(c.args).toContain("search");
    }
  });

  it("secret-tool 异常 → keyring: null（列表不当机），code1+干净 stderr → false", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-"));
    fs.writeFileSync(path.join(dir, "credentials.yaml"), POLICY_FIXTURE);
    const runner = new FakeRunner();
    runner.on(["search", "--all", "agentos-ref", "vault://github/token"], { code: null, stderr: "spawn ENOENT" });
    runner.on(["search", "--all", "agentos-ref", "vault://bank/login"], { code: 1, stderr: "" });
    const rows = await listCredentials({ runner, policyPath: path.join(dir, "credentials.yaml"), auditPath: path.join(dir, "无.jsonl") });
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r])) as Record<string, CredentialRow>;
    expect(byRef["vault://github/token"].keyring).toBeNull();
    expect(byRef["vault://bank/login"].keyring).toBe(false);
    expect(rows.every((r) => r.lastUsed === null)).toBe(true);
  });

  it("lastUsedFromAudit：无审计/无匹配 → null", () => {
    expect(lastUsedFromAudit("/不存在的/audit.jsonl", "vault://a/b")).toBeNull();
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-"));
    const f = path.join(dir, "a.jsonl");
    fs.writeFileSync(f, JSON.stringify({ extension: "cred", detail: "别的引用", ts: "2026-01-01T00:00:00Z" }) + "\n");
    expect(lastUsedFromAudit(f, "vault://a/b")).toBeNull();
  });
});

describe("revokeCredential 吊销事务", () => {
  function setup(): { dir: string; policyPath: string; auditPath: string; runner: FakeRunner } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-"));
    const policyPath = path.join(dir, "credentials.yaml");
    const auditPath = path.join(dir, "audit.jsonl");
    fs.writeFileSync(policyPath, POLICY_FIXTURE);
    const runner = new FakeRunner();
    runner.on(["clear", "agentos-ref"], { code: 0 });
    return { dir, policyPath, auditPath, runner };
  }

  it("happy path：clear→摘块（保另一条与注释）→审计 credential_revoke，零明文", async () => {
    const { policyPath, auditPath, runner } = setup();
    const r = await revokeCredential({ runner, policyPath, auditPath, secretTool: "secret-tool" }, "vault://github/token");
    expect(r).toMatchObject({ ok: true, ref: "vault://github/token", keyringCleared: true, policyRemoved: true, audited: true });
    // ① secret-tool clear 按属性精确清
    expect(runner.lastArgs()).toEqual(["clear", "agentos-ref", "vault://github/token"]);
    // ② 文件只剩另一条 + 注释保留，无 .tmp 残留
    const after = fs.readFileSync(policyPath, "utf8");
    expect(after).toContain("vault://bank/login");
    expect(after).toContain("# AgentOS 凭据策略");
    expect(after).not.toContain("vault://github/token");
    expect(fs.readdirSync(path.dirname(policyPath)).filter((f) => f.includes(".tmp-"))).toEqual([]);
    // ③ 审计只记引用与三步结果
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as { tool: string; extension: string; detail: string };
    expect(entry.tool).toBe("credential_revoke");
    expect(entry.detail).toContain("ref=vault://github/token");
    expect(entry.detail).toContain("keyring=cleared");
    expect(entry.detail).toContain("policy=removed");
  });

  it("引用不在策略文件：仍清 keyring + 审计（policyRemoved:false）", async () => {
    const { policyPath, auditPath, runner } = setup();
    const r = await revokeCredential({ runner, policyPath, auditPath }, "vault://nope/x");
    expect(r.ok).toBe(true);
    expect(r.policyRemoved).toBe(false);
    expect(fs.readFileSync(policyPath, "utf8")).toBe(POLICY_FIXTURE); // 原文一字不动
    expect(fs.readFileSync(auditPath, "utf8")).toContain("credential_revoke");
  });

  it("非法引用：直接拒绝，不碰 keyring 不写审计", async () => {
    const { policyPath, auditPath, runner } = setup();
    const r = await revokeCredential({ runner, policyPath, auditPath }, "not-a-ref; rm -rf /");
    expect(r.ok).toBe(false);
    expect(runner.calls).toHaveLength(0);
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("keyring clear 失败：仍摘策略 + 审计如实记 error（broker 即拒用）", async () => {
    const { policyPath, auditPath } = setup();
    const runner = new FakeRunner(); // 未预置 clear → code 1
    const r = await revokeCredential({ runner, policyPath, auditPath }, "vault://bank/login");
    expect(r.ok).toBe(true);
    expect(r.keyringCleared).toBe(false);
    expect(r.keyringError).toBeTruthy();
    expect(fs.readFileSync(policyPath, "utf8")).not.toContain("vault://bank/login");
    expect(fs.readFileSync(auditPath, "utf8")).toContain("keyring=error:");
  });

  it("isValidRef：vault://组/名 白名单", () => {
    expect(isValidRef("vault://github/token")).toBe(true);
    expect(isValidRef("vault://a-b.c/d_e")).toBe(true);
    expect(isValidRef("vault://x")).toBe(true); // 单段也放行——与 broker.assertRef 同语义（组/名是约定）
    expect(isValidRef("http://x/y")).toBe(false);
    expect(isValidRef("vault://a/b c")).toBe(false); // 空格
  });
});

describe("/api/credentials 路由", () => {
  let dir: string;
  let server: http.Server;
  let port: number;
  let policyPath: string;
  let auditPath: string;
  let runner: FakeRunner;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "agentos-cred-route-"));
    policyPath = path.join(dir, "credentials.yaml");
    auditPath = path.join(dir, "audit.jsonl");
    fs.writeFileSync(policyPath, POLICY_FIXTURE);
    runner = new FakeRunner();
    runner.on(["search", "--all"], { code: 0 });
    runner.on(["clear", "agentos-ref"], { code: 0 });
    server = createCanvasServer(path.join(dir, "canvas"), {
      runner,
      credPolicyPath: policyPath,
      auditPath,
      stateFile: path.join(dir, "state.json"),
      settingsSocket: path.join(dir, "无.sock"),
      settingsCli: null,
      snapshotScript: null,
      exportScript: null,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("GET /api/credentials：清单 + 注册引导，永不出现明文/lookup 调用", async () => {
    const r = await get("/api/credentials", port);
    expect(r.status).toBe(200);
    const d = JSON.parse(r.body);
    expect(d.credentials).toHaveLength(2);
    expect(d.credentials[0]).toHaveProperty("keyring");
    expect(d.registerGuide).toContain("cred-store.sh");
    expect(JSON.stringify(d)).not.toContain("lookup");
    // 响应里没有 value/secret 字样
    expect(JSON.stringify(d)).not.toMatch(/"(value|secret|password)"/i);
  });

  it("POST /api/credentials/revoke：走完整事务", async () => {
    const bad = await post("/api/credentials/revoke", JSON.stringify({ ref: "" }), port);
    expect(bad.status).toBe(400);
    const r = await post("/api/credentials/revoke", JSON.stringify({ ref: "vault://bank/login" }), port);
    expect(r.status).toBe(200);
    const d = JSON.parse(r.body);
    expect(d).toMatchObject({ ok: true, policyRemoved: true, keyringCleared: true });
    expect(fs.readFileSync(policyPath, "utf8")).not.toContain("vault://bank/login");
    expect(fs.readFileSync(auditPath, "utf8")).toContain("credential_revoke");
  });

  it("坏 JSON body → 400", async () => {
    const r = await post("/api/credentials/revoke", "{不是json", port);
    expect(r.status).toBe(400);
  });
});
