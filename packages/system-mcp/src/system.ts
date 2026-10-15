import type { CommandRunner } from "@agentos/proc";

export class SystemError extends Error {}

export type PackageManager = "rpm" | "pacman";

export interface SystemBins {
  systemctl: string;
  journalctl: string;
  rpm: string;
  pacman: string;
  dnf: string;
  ip: string;
  free: string;
  df: string;
  uptime: string;
}

function defaultBins(): SystemBins {
  return {
    systemctl: process.env["SYSTEMCTL_BIN"] ?? "systemctl",
    journalctl: process.env["JOURNALCTL_BIN"] ?? "journalctl",
    rpm: process.env["RPM_BIN"] ?? "rpm",
    pacman: process.env["PACMAN_BIN"] ?? "pacman",
    dnf: process.env["DNF_BIN"] ?? "dnf",
    ip: process.env["IP_BIN"] ?? "ip",
    free: process.env["FREE_BIN"] ?? "free",
    df: process.env["DF_BIN"] ?? "df",
    uptime: process.env["UPTIME_BIN"] ?? "uptime",
  };
}

/** 只读系统查询客户端。M1 后段引入权限模型后再放开白名单动作（装包/重启服务等）。 */
export class SystemClient {
  constructor(
    private readonly runner: CommandRunner,
    private readonly bins: SystemBins = defaultBins(),
  ) {}

  /** 资源概况：开机时长 / 负载 / 内存 / 磁盘 */
  async status(): Promise<string> {
    const [uptime, free, disk] = await Promise.all([
      this.run(this.bins.uptime, ["-p"]),
      this.run(this.bins.free, ["-h"]),
      this.run(this.bins.df, ["-h", "/"]),
    ]);
    return `开机时长: ${uptime.trim()}\n\n内存:\n${free.trim()}\n\n磁盘(/):\n${disk.trim()}`;
  }

  /** 服务列表。state 过滤：running / failed / all */
  async services(state: "running" | "failed" | "all" = "running"): Promise<string> {
    const args = ["list-units", "--type=service", "--no-pager", "--no-legend", "--plain"];
    if (state !== "all") args.push(`--state=${state}`);
    const out = await this.run(this.bins.systemctl, args);
    return out.trim() === "" ? `（没有 ${state} 状态的服务）` : out.trim();
  }

  async serviceStatus(name: string): Promise<string> {
    assertUnitName(name);
    const out = await this.run(this.bins.systemctl, [
      "show",
      name,
      "--no-pager",
      "-p",
      "Id",
      "-p",
      "Description",
      "-p",
      "ActiveState",
      "-p",
      "SubState",
      "-p",
      "MainPID",
      "-p",
      "UnitFileState",
    ]);
    return out.trim();
  }

  /** 读取服务日志。user=true 查用户级服务（systemd --user），否则系统级（受 journal 权限限制）。 */
  async journal(unit: string, lines: number, user: boolean): Promise<string> {
    assertUnitName(unit);
    const n = Math.max(1, Math.min(500, Math.floor(lines)));
    const args = user ? ["--user"] : [];
    args.push("-u", unit, "-n", String(n), "--no-pager", "--output", "short-iso");
    const out = await this.run(this.bins.journalctl, args);
    return out.trim() === "" ? `（${unit} 无可见日志——系统级日志可能需要 journal 权限组）` : out.trim();
  }

  /** 已安装包列表，按 query 子串过滤，limit 截断 */
  async packages(pkg: PackageManager, query?: string, limit = 100): Promise<string> {
    const raw =
      pkg === "rpm"
        ? await this.run(this.bins.rpm, ["-qa", "--qf", "%{NAME}\\t%{VERSION}-%{RELEASE}\\n"])
        : await this.run(this.bins.pacman, ["-Q"]);
    let lines = raw.split("\n").filter((l) => l.trim() !== "");
    if (query) {
      const q = query.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(q));
    }
    const total = lines.length;
    const shown = lines.slice(0, Math.max(1, Math.min(500, limit)));
    return `匹配 ${total} 个包（显示前 ${shown.length} 个）:\n${shown.join("\n")}`;
  }

  async packageInfo(pkg: PackageManager, name: string): Promise<string> {
    assertUnitName(name);
    const out =
      pkg === "rpm"
        ? await this.run(this.bins.dnf, ["info", name])
        : await this.run(this.bins.pacman, ["-Si", name]);
    return out.trim();
  }

  async network(): Promise<string> {
    return (await this.run(this.bins.ip, ["-br", "addr"])).trim();
  }

  private async run(cmd: string, args: string[]): Promise<string> {
    const r = await this.runner.run(cmd, args);
    if (r.code !== 0) {
      throw new SystemError(`${cmd} 失败: ${r.stderr.trim() || `exit ${r.code}`}`);
    }
    return r.stdout;
  }
}

function assertUnitName(name: string): void {
  if (!/^[a-zA-Z0-9@._+-]{1,200}$/.test(name)) {
    throw new SystemError(`非法名称: ${name}（只允许字母数字与 @._+- 字符）`);
  }
}
