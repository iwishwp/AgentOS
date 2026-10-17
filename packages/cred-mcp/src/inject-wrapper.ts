#!/usr/bin/env node
/**
 * 通道 C 的 wrapper（cred-mcp 内部组件，经 CredBroker.inject 拉起，不经 agent 触达）：
 *
 *   node inject-wrapper.js --ttl <秒> [--env-name NAME] -- <command...>
 *
 * - secret 从自身 env（AGENTOS_INJECT_SECRET）读取，透传给目标命令（env 名默认 AGENTOS_SECRET）；
 *   全程不上命令行——`ps`/`/proc/<pid>/cmdline` 看不到明文（env 只在本用户/ root 可读）；
 * - 目标命令放独立进程组（detached），TTL 到点先 SIGTERM、2s 后 SIGKILL 收割整组，
 *   exit 124 + stderr 打 AGENTOS_EXPIRED=1 标记（broker 据此写"过期"审计）；
 * - wrapper 自身收到 SIGTERM/SIGINT 时同样收割子组（不留悬挂进程）。
 */
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
let ttl = 0;
let envName = "AGENTOS_SECRET";
const cmdStart = argv.indexOf("--");
if (cmdStart === -1) {
  console.error("inject-wrapper: 缺少 -- 后的目标命令");
  process.exit(2);
}
for (let i = 0; i < cmdStart; i++) {
  if (argv[i] === "--ttl" && argv[i + 1]) ttl = Number(argv[++i]);
  else if (argv[i] === "--env-name" && argv[i + 1]) envName = String(argv[++i]);
}
const command = argv.slice(cmdStart + 1);
if (!Number.isFinite(ttl) || ttl < 1) {
  console.error("inject-wrapper: --ttl 须为正整数（秒）");
  process.exit(2);
}
if (command.length === 0) {
  console.error("inject-wrapper: 目标命令为空");
  process.exit(2);
}

const secret = process.env["AGENTOS_INJECT_SECRET"];
if (!secret) {
  console.error("inject-wrapper: 环境 AGENTOS_INJECT_SECRET 缺失（应由 broker 注入）");
  process.exit(2);
}

// secret 移出 wrapper 自身环境（子进程拿到改名后的那份，wrapper 进程本身不再持有）
const childEnv = { ...process.env };
delete childEnv["AGENTOS_INJECT_SECRET"];
childEnv[envName] = secret;

const child = spawn(command[0]!, command.slice(1), {
  stdio: ["ignore", "inherit", "inherit"],
  env: childEnv,
  detached: true, // 独立进程组：收割时整组一起（含目标命令再起的孙进程）
});

let killed = false;
function reap(signal: NodeJS.Signals): void {
  if (killed) return;
  killed = true;
  try {
    process.kill(-child.pid!, signal);
  } catch {
    /* 进程组可能已退出 */
  }
}

const killer = setTimeout(() => {
  reap("SIGTERM");
  setTimeout(() => reap("SIGKILL"), 2000);
}, ttl * 1000);
killer.unref();

child.on("error", (e) => {
  console.error(`inject-wrapper: 无法启动 ${command[0]}: ${e.message}`);
  process.exit(2);
});

process.on("SIGTERM", () => {
  clearTimeout(killer);
  reap("SIGTERM");
  process.exit(143);
});
process.on("SIGINT", () => {
  clearTimeout(killer);
  reap("SIGTERM");
  process.exit(130);
});

child.on("close", (code, signal) => {
  if (killed) {
    // TTL 收割或外部信号所致：按约定标记过期
    console.error("AGENTOS_EXPIRED=1");
    process.exit(124);
  }
  process.exit(code ?? (signal ? 128 + 15 : 1));
});
