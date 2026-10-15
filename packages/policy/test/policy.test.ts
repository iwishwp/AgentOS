import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Policy, audit, DEFAULT_AUDIT_PATH } from "../src/index.js";
import { DEFAULT_POLICY_PATH } from "../src/index.js";

describe("Policy 判定顺序", () => {
  it("精确规则 > 通配 > 扩展默认 > 全局默认", () => {
    const p = Policy.fromRules({
      niri: { close_window: "deny", "*": "allow" },
      files: { "*": "deny", read_file: "allow" },
    });
    expect(p.decide("niri", "close_window").decision).toBe("deny");
    expect(p.decide("niri", "list_windows").decision).toBe("allow");
    expect(p.decide("files", "read_file").decision).toBe("allow");
    expect(p.decide("files", "write_file").decision).toBe("deny");
    expect(p.decide("desktop", "notify").decision).toBe("allow"); // 全局默认
  });

  it("fallback=deny 时未覆盖的扩展被拒", () => {
    const p = Policy.fromRules({ niri: { "*": "allow" } }, "deny");
    expect(p.decide("system", "journal").decision).toBe("deny");
  });

  it("verdict 带命中原因", () => {
    const p = Policy.fromRules({ niri: { close_window: "deny" } });
    expect(p.decide("niri", "close_window").reason).toContain("niri.close_window=deny");
  });
});

describe("配置文件加载", () => {
  it("YAML 文件解析", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-policy-"));
    const file = path.join(dir, "policy.yaml");
    fs.writeFileSync(
      file,
      ["version: 1", "rules:", "  niri:", "    close_window: deny"].join("\n"),
    );
    const p = Policy.load(file);
    expect(p.decide("niri", "close_window").decision).toBe("deny");
    expect(p.decide("niri", "focus_window").decision).toBe("allow");
  });

  it("文件缺失回退默认（全 allow）", () => {
    const p = Policy.load("/nonexistent/policy.yaml");
    expect(p.decide("anything", "any").decision).toBe("allow");
  });
});

describe("审计日志", () => {
  it("追加 JSONL 到指定文件", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentos-audit-"));
    const file = path.join(dir, "audit.jsonl");
    audit({ ts: "2026-10-15T00:00:00Z", extension: "niri", tool: "close_window", decision: "deny" }, file);
    audit({ ts: "2026-10-15T00:00:01Z", extension: "files", tool: "read_file", decision: "allow" }, file);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).tool).toBe("close_window");
  });

  it("默认路径在 XDG state 下", () => {
    expect(DEFAULT_AUDIT_PATH).toContain("agentos/audit.jsonl");
    expect(DEFAULT_POLICY_PATH).toContain("agentos/policy.yaml");
  });
});
