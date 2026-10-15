import { describe, expect, it } from "vitest";
import { FakeRunner } from "@agentos/proc/testing";
import { SystemClient, SystemError } from "../src/system.js";

const BINS = {
  systemctl: "/fake/systemctl",
  journalctl: "/fake/journalctl",
  rpm: "/fake/rpm",
  pacman: "/fake/pacman",
  dnf: "/fake/dnf",
  ip: "/fake/ip",
  free: "/fake/free",
  df: "/fake/df",
  uptime: "/fake/uptime",
};

function make() {
  const runner = new FakeRunner();
  return { runner, system: new SystemClient(runner, BINS) };
}

describe("资源概况", () => {
  it("聚合 uptime/free/df 三个命令", async () => {
    const { runner, system } = make();
    runner.on(["-p"], { stdout: "up 2 hours" });
    runner.on(["-h"], { stdout: "Mem: 8G" });
    runner.on(["-h", "/"], { stdout: "/dev/vda1 40G" });
    const out = await system.status();
    expect(out).toContain("up 2 hours");
    expect(out).toContain("Mem: 8G");
    expect(runner.calls.map((c) => c.cmd)).toEqual([BINS.uptime, BINS.free, BINS.df]);
  });
});

describe("服务查询", () => {
  it("默认 running 状态过滤", async () => {
    const { runner, system } = make();
    runner.on(["list-units"], { stdout: "sshd loaded active" });
    await system.services();
    expect(runner.lastArgs()).toEqual([
      "list-units",
      "--type=service",
      "--no-pager",
      "--no-legend",
      "--plain",
      "--state=running",
    ]);
  });

  it("all 不带 state 参数", async () => {
    const { runner, system } = make();
    runner.on(["list-units"], { stdout: "x" });
    await system.services("all");
    expect(runner.lastArgs()).not.toContain("--state=running");
  });

  it("service_status 用 systemctl show 拿结构化属性", async () => {
    const { runner, system } = make();
    runner.on(["show"], { stdout: "Id=sshd" });
    await system.serviceStatus("sshd.service");
    expect(runner.lastArgs()?.slice(0, 3)).toEqual(["show", "sshd.service", "--no-pager"]);
  });

  it("服务名只允许安全字符", async () => {
    const { runner, system } = make();
    await expect(system.serviceStatus("a; rm -rf")).rejects.toThrow(SystemError);
    expect(runner.calls).toHaveLength(0);
  });
});

describe("日志", () => {
  it("系统级：-u 单元 -n 行数", async () => {
    const { runner, system } = make();
    runner.on(["-u"], { stdout: "log line" });
    await system.journal("sshd", 30, false);
    expect(runner.lastArgs()).toEqual([
      "-u",
      "sshd",
      "-n",
      "30",
      "--no-pager",
      "--output",
      "short-iso",
    ]);
  });

  it("用户级带 --user；行数截断到 500", async () => {
    const { runner, system } = make();
    runner.on(["--user"], { stdout: "x" });
    await system.journal("niri", 9999, true);
    expect(runner.lastArgs()?.slice(0, 5)).toEqual(["--user", "-u", "niri", "-n", "500"]);
  });
});

describe("包查询", () => {
  it("rpm 全量 + 子串过滤 + 截断", async () => {
    const { runner, system } = make();
    runner.on(["-qa"], { stdout: "niri\t26.04\nnodejs\t22\nvim\t9\n" });
    const out = await system.packages("rpm", undefined, 2);
    expect(out).toContain("匹配 3 个包（显示前 2 个）");
    expect(out).toContain("niri");
    expect(out).not.toContain("vim");
  });

  it("pacman 查询走 pacman -Q", async () => {
    const { runner, system } = make();
    runner.on(["-Q"], { stdout: "niri 26.04\n" });
    await system.packages("pacman", "niri");
    expect(runner.lastArgs()).toEqual(["-Q"]);
  });

  it("包详情：rpm 系用 dnf info", async () => {
    const { runner, system } = make();
    runner.on(["info"], { stdout: "Name : niri" });
    await system.packageInfo("rpm", "niri");
    expect(runner.lastArgs()).toEqual(["info", "niri"]);
  });
});
