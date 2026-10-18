/**
 * cli.ts —— bin `agentos-settings` 的命令分发。
 *   daemon                     前台跑守护（watchers + 五桥 + D-Bus/socket IPC）
 *   apply [--dark|--light|--auto]  一次性应用（默认 auto=读 noctalia settings.json）
 *   status                     状态快照 + 真相映射 + daemon 存活探测
 *   ipc <method> [json]        调 unix socket JSON 通道（调试）
 */
import { ShellRunner } from "@agentos/proc";
import { defaultPaths } from "./paths.js";
import { applyTheme, ApplyError } from "./apply.js";
import { runDaemon } from "./daemon.js";
import { loadState, parseDarkMode } from "./state.js";
import { readTextIfExists, sleep } from "./fsutil.js";
import { socketCall } from "./ipc.js";
import { loadPalette, isLightPalette } from "./palette.js";
import { existsSync } from "node:fs";

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "daemon":
      await runDaemon();
      return 0; // runDaemon 常驻，走到这里即为异常退出
    case "apply": {
      const variant = rest.includes("--dark")
        ? ("dark" as const)
        : rest.includes("--light")
          ? ("light" as const)
          : ("auto" as const);
      return await cmdApply(variant);
    }
    case "status":
      return await cmdStatus();
    case "ipc": {
      const method = rest[0] ?? "Get";
      let params: Record<string, string> | undefined;
      if (rest[1]) {
        try {
          params = JSON.parse(rest[1]) as Record<string, string>;
        } catch {
          console.error("params 必须是 JSON 对象");
          return 2;
        }
      }
      const paths = defaultPaths();
      try {
        console.log(JSON.stringify(await socketCall(paths.socketPath, method, params), null, 2));
        return 0;
      } catch (e) {
        console.error(`socket 调用失败（daemon 未运行？）: ${e instanceof Error ? e.message : e}`);
        return 1;
      }
    }
    default:
      console.error(`用法: agentos-settings <daemon|apply|status|ipc>
  daemon                      前台运行守护进程
  apply [--dark|--light|--auto]  一次性应用主题（默认 auto）
  status                      查看状态/真相映射/daemon 存活
  ipc <method> [json-params]  unix socket 调试（Get/Apply/Reload）`);
      return cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

async function cmdApply(variant: "dark" | "light" | "auto"): Promise<number> {
  const paths = defaultPaths();
  try {
    const r = await applyTheme(
      { paths, runner: new ShellRunner(), logger: (l) => console.log(l) },
      { variant, reason: "cli apply", appliedBy: "cli" },
    );
    console.log("== 桥结果一览 ==");
    for (const b of r.bridges) console.log(`  ${b.ok ? "✓" : "✗"} ${b.name}（${b.detail}）`);
    if (r.ghosttyReload?.attempted) console.log(`  ✓ ghostty 已开窗口热重载（${r.ghosttyReload.reloaded} 个）`);
    console.log("（状态栏/通知/GTK暗亮即时；ghostty 已开窗口已自动热重载；GTK 调色板新进程生效）");
    return 0;
  } catch (e) {
    if (e instanceof ApplyError) {
      console.error(`错误: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

async function cmdStatus(): Promise<number> {
  const paths = defaultPaths();
  const runner = new ShellRunner();

  // 真相映射（真相来自现有文件，daemon 只是读者）
  const darkMode = parseDarkMode(await readTextIfExists(paths.noctaliaSettings));
  const wantVariant = darkMode ? "dark" : "light";
  const palettePath = wantVariant === "light" ? paths.paletteLight : paths.paletteDark;
  const paletteExists = existsSync(palettePath);
  const polarity = paletteExists ? isLightPalette(await loadPalette(palettePath)) : null;

  // 状态快照
  const state = await loadState(paths.stateFile);

  // daemon 存活
  const unit = await runner.run("systemctl", ["--user", "is-active", "agentos-settings"]);
  let socketState = "down";
  try {
    const reply = (await socketCall(paths.socketPath, "Get")) as { ok?: boolean; paletteVariant?: string };
    socketState = `up（socket 应答: paletteVariant=${reply.paletteVariant ?? "?"}）`;
  } catch {
    socketState = "down";
  }
  const busctl = await runner.run("busctl", ["--user", "--no-pager", "status", "org.agentos.Settings"]);

  console.log(`真相源（noctalia）:
  settings.json darkMode = ${darkMode} → 期望变体 ${wantVariant}
  色板 ${palettePath} ${paletteExists ? `存在（内容极性 ${polarity ? "light" : "dark"}）` : "缺失"}
状态快照（daemon 单一状态源 ${paths.stateFile}）:
${state ? JSON.stringify(state, null, 2) : "  （尚无——还没跑过 apply）"}
daemon:
  systemd unit: ${unit.code === 0 ? unit.stdout.trim() : "inactive/不存在"}
  unix socket: ${socketState}
  D-Bus org.agentos.Settings: ${busctl.code === 0 ? "已注册" : "未注册（或 busctl 不可用）"}`);
  await sleep(1); // 让 socket 错误路径的输出先行落盘
  return 0;
}
